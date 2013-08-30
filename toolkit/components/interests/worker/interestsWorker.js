/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

function InterestsWorkerError(message) {
    this.name = "InterestsWorkerError";
    this.message = message || "InterestsWorker has errored";
}
InterestsWorkerError.prototype = new Error();
InterestsWorkerError.prototype.constructor = InterestsWorkerError;

let gInterestsData = null;
const kSplitter = /[^-\w\xco-\u017f\u0380-\u03ff\u0400-\u04ff]+/;

// bootstrap the worker with data and models
function bootstrap(aMessageData) {
  swapRules(aMessageData, true);

  self.postMessage({
    message: "bootstrapComplete"
  });
}

// swap out rules
function swapRules({interestsData, interestsDataType}, noPostMessage) {
  if (interestsDataType == "dfr") {
    gInterestsData = interestsData;
  }

  if(!noPostMessage) {
    // only post message if value is true, i.e. it was intentionally passed
    self.postMessage({
      message: "swapRulesComplete"
    });
  }
}

// classify a page using rules
function ruleClassify({host, language, tld, metaData, path, title, url}) {
  if (gInterestsData == null) {
    throw new InterestsWorkerError("interestData not loaded");
  }
  let interests = [];
  let hostKeys = (gInterestsData[host]) ? Object.keys(gInterestsData[host]).length : 0;
  let tldKeys = (host != tld && gInterestsData[tld]) ? Object.keys(gInterestsData[tld]).length : 0;

  if (hostKeys || tldKeys) {
    // process __ANY first
    if (hostKeys && gInterestsData[host]["__ANY"]) {
      interests = interests.concat(gInterestsData[host]["__ANY"]);
      hostKeys--;
    }
    if (tldKeys && gInterestsData[tld]["__ANY"]) {
      interests = interests.concat(gInterestsData[tld]["__ANY"]);
      tldKeys--;
    }

    // process keywords
    if (hostKeys || tldKeys) {
      // Split on non-dash, alphanumeric, latin-small, greek, cyrillic
      let words = (url + " " + title).toLowerCase().split(kSplitter);

      let matchedAllTokens = function(tokens) {
        return tokens.every(function(word) {
          return words.indexOf(word) != -1;
        });
      }

      let processDFRKeys = function(hostObject) {
        Object.keys(hostObject).forEach(function(key) {
          if (key != "__ANY" && matchedAllTokens(key.split(kSplitter))) {
            interests = interests.concat(hostObject[key]);
          }
        });
      }

      if (hostKeys) {
        processDFRKeys(gInterestsData[host]);
      }
      if (tldKeys) {
        processDFRKeys(gInterestsData[tld]);
      }
    }
  }
  return interests;
}

// Figure out which interests are associated to the document
function getInterestsForDocument(aMessageData) {
  let interests = [];
  try {
    interests = ruleClassify(aMessageData);

    // remove duplicates
    if (interests.length > 1) {
      // insert interests into hash and reget the keys
      let theHash = {};
      interests.forEach(function(aInterest) {
        if (!theHash[aInterest]) {
          theHash[aInterest]=1;
        }
      });
      interests = Object.keys(theHash);
    }
  }
  catch (ex) {
    Components.utils.reportError(ex);
  }

  // Respond with the interests for the document
  self.postMessage({
    host: aMessageData.host,
    interests: interests,
    message: "InterestsForDocument",
    url: aMessageData.url,
    visitDate: aMessageData.visitDate,
    visitCount: aMessageData.visitCount,
    messageId: aMessageData.messageId
  });
}

// Classify document via rules only
function getInterestsForDocumentRules(aMessageData) {
  let interests = ruleClassify(aMessageData);

  // Respond with the interests for the document
  self.postMessage({
    host: aMessageData.host,
    interests: interests,
    message: "InterestsForDocumentRules",
    url: aMessageData.url
  });
}

// Dispatch the message to the appropriate function
self.onmessage = function({data}) {
  self[data.message](data);
};
