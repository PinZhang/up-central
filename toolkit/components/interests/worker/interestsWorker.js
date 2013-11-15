/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

try{
  importScripts("resource://gre/modules/interests/worker/interestsTextClassifier.js");
}catch(ex){dump("ERROR file:" + ex.fileName + " line:" + ex.lineNumber + " message:" + ex.message);}

function InterestsWorkerError(message) {
    this.name = "InterestsWorkerError";
    this.message = message || "InterestsWorker has errored";
}
InterestsWorkerError.prototype = new Error();
InterestsWorkerError.prototype.constructor = InterestsWorkerError;

let gTokenizer = null;
let gClassifier = null;
let gInterestsData = null;
const kSplitter = /[^-\w\xco-\u017f\u0380-\u03ff\u0400-\u04ff]+/;

/**
 * Bootstrap the worker with data and models
 *
 * @param aMessageData
 *        aMessageData is an object with keys as such: {interestsData, interestsDataType, interestsClassifierModel, interestsUrlStopwords}
 * @notifies bootstrapComplete message upon completion
 */
function bootstrap(aMessageData) {
  if (aMessageData.interestsUrlStopwords) {
    gTokenizer = new PlaceTokenizer({
      urlStopwordSet: aMessageData.interestsUrlStopwords,
      model: aMessageData.interestsClassifierModel,
      regionCode: aMessageData.regionCode
    });
  }
  if (aMessageData.interestsClassifierModel) {
    gClassifier = new NaiveBayesClassifier(aMessageData.interestsClassifierModel);
  }

  swapRules(aMessageData, true);

  self.postMessage({
    message: "bootstrapComplete"
  });
}

/**
 * Change the worker's domain classification rules to those provided
 *
 * @param {interestsData, interestsDataType}
 *        interestsData contains domain classification rules
 *        interestsDataType describes the type of rules. Currently, only "dfr" is allowed.
 */
function swapRules({interestsData, interestsDataType}) {
  if (interestsDataType == "dfr") {
    gInterestsData = interestsData;
  }
}

/**
 * classify a page using heuristics. The heuristics are domain rules.
 *
 * @param {host, language, tld, metaData, path, title, url}
 * @returns an array of interests classified
 */
function ruleClassify({host, language, tld, metaData, path, title, url}) {
  if (gInterestsData == null) {
    return [];
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

/**
 * classify a page using text
 *
 * @param {url, title} for a page
 * @returns an array of interests classified
 */
function textClassify({url, title}) {
  if (gTokenizer == null || gClassifier == null) {
    return [];
  }

  let tokens = gTokenizer.tokenize(url, title);
  let interest = gClassifier.classify(tokens);

  if (interest != null) {
    return interest;
  }
  return [];
}

/**
 * Infer interests given a document
 *
 * @param aMessageData is an object with keys: {host, language, tld, metaData, path, title, url}
 * @notifies InterestsForDocument message with classification data
 */
function getInterestsForDocument(aMessageData) {
  let interests = [];
  try {
    interests = ruleClassify(aMessageData);
    if (interests.length == 0 && gClassifier && gTokenizer) {
      // fallback to text classification
      interests = textClassify(aMessageData);
    }

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
    dump(ex + '\n');
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

/**
 * Classify document using a text model only
 *
 * @param aMessageData is an object with keys: {url, title}
 * @notifies InterestsForDocumentText with classification data
 */
function getInterestsForDocumentText(aMessageData) {
  let interests = textClassify(aMessageData);

  // Respond with the interests for the document
  self.postMessage({
    host: aMessageData.host,
    interests: interests,
    message: "InterestsForDocumentText",
    url: aMessageData.url
  });
}

/**
 * Classify document using domain heuristics only
 *
 * @param aMessageData is an object with keys: {host, language, tld, metaData, path, title, url}
 * @notifies InterestsForDocumentRules with classification data
 */
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

// Dispatch a received message to the appropriate function
self.onmessage = function({data}) {
  self[data.message](data);
};
