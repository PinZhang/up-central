/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

const DEFAULT_THRESHOLD = 5;
const DEFAULT_DURATION = 14;

let gServiceEnabled = Services.prefs.getBoolPref("interests.enabled");
let gInterestsService = null;

// Add a pref observer for the enabled state
function prefObserver(subject, topic, data) {
  let enable = Services.prefs.getBoolPref("interests.enabled");
  if (enable && !gServiceEnabled) {
    gServiceEnabled = true;
  }
  else if (!enable && gServiceEnabled) {
    delete gInterestsService.__worker;
    gServiceEnabled = false;
  }
}

function exposeAll(obj) {
  // Filter for Objects and Arrays.
  if (typeof obj !== "object" || !obj)
    return;

  // Recursively expose our children.
  Object.keys(obj).forEach(key => exposeAll(obj[key]));

  // If we're not an Array, generate an __exposedProps__ object for ourselves.
  if (obj instanceof Array)
    return;
  var exposed = {};
  Object.keys(obj).forEach(key => exposed[key] = "r");
  obj.__exposedProps__ = exposed;
}

Services.prefs.addObserver("interests.enabled", prefObserver, false);
Services.obs.addObserver(function xpcomShutdown() {
  Services.obs.removeObserver(xpcomShutdown, "xpcom-shutdown");
  Services.prefs.removeObserver("interests.enabled", prefObserver);
}, "xpcom-shutdown", false);

function Interests() {
  gInterestsService = this;
}
Interests.prototype = {
  //////////////////////////////////////////////////////////////////////////////
  //// Interests API

  resubmitRecentHistoryVisits: function I_resubmitRecentHistory(daysBack) {
    // check if history is in progress
    if (this._ResubmitRecentHistoryDeferred) {
      return this._ResubmitRecentHistoryDeferred.promise;
    }

    this._ResubmitRecentHistoryDeferred = Promise.defer();
    // clean interest tables first
    this._clearRecentInterests(daysBack).then(() => {
      // read moz_places data and massage it
      PlacesInterestsStorage.reprocessRecentHistoryVisits(daysBack, item => {
        let uri = NetUtil.newURI(item.url);
        item["message"] = "getInterestsForDocument";
        item["host"] = this._getPlacesHostForURI(uri);
        item["path"] = uri["path"];
        item["tld"] = Services.eTLD.getBaseDomainFromHost(item["host"]);
        item["metaData"] = {};
        item["language"] = "en";
        this._callMatchingWorker(item);
      }).then(() => {
        // we are done sending recent visits to the worker
        // hence, we can send an echo message to the worker
        // to indicate completion of the history re-processing
        this._callMatchingWorker({
          message: "echoMessage",
          type: "resubmitRecentHistory"
        });
      });
    });
    return this._ResubmitRecentHistoryDeferred.promise;
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Interests Helpers

  get _worker() {
    if (gServiceEnabled && !("__worker" in this)) {
      // Use a ChromeWorker to workaround Bug 487070.
      this.__worker = new ChromeWorker("chrome://global/content/interestsWorker.js");
      this.__worker.addEventListener("message", this, false);
      this.__worker.addEventListener("error", this, false);

      let scriptLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"].
        getService(Ci.mozIJSSubScriptLoader);
      let data = scriptLoader.loadSubScript("chrome://global/content/interestsData.js");
      let model = scriptLoader.loadSubScript("chrome://global/content/interestsClassifierModel.js");
      let stopwords = scriptLoader.loadSubScript("chrome://global/content/interestsUrlStopwords.js");

      this.__worker.postMessage({
        message: "bootstrap",
        interestsDataType: "dfr",
        interestsData: interestsData,
        interestsClassifierModel: interestsClassifierModel,
        interestsUrlStopwords: interestsUrlStopwords
      });
    }
    return this.__worker;
  },

  _handleNewDocument: function I__handleNewDocument(aDocument) {
    let host = this._getPlacesHostForURI(aDocument.documentURIObject);

    this._callMatchingWorker({
      message: "getInterestsForDocument",
      url: aDocument.documentURI,
      host: host,
      path: aDocument.documentURIObject.path,
      title: aDocument.title,
      tld: Services.eTLD.getBaseDomainFromHost(host) ,
      metaData: {} ,
      language: "en"
    });
  },

  _callMatchingWorker: function I__callMatchingWorker(callObject) {
    this._worker.postMessage(callObject);
  },

  _getPlacesHostForURI: function(aURI) {
    return aURI.host.replace(/^www\./, "");
  },

  _addInterestsForHost: function I__addInterestsForHost(aHost, aInterests, aVisitDate, aVisitCount) {
    let deferred = Promise.defer();
    let addInterestPromises = [];

    // TODO - this is a hack - we do not need to keep inserting into interests table
    // we should do it ones on startup or update
    for (let interest of aInterests) {
      // add all addInterest promisses to the array 
      addInterestPromises.push(PlacesInterestsStorage.addInterest(interest));
    }
    // now wait for all the promisses to resolve and execute host and visit additions
    Promise.promised(Array)(addInterestPromises).then(results => {
      let addVisitPromises = [];
      for (let interest of aInterests) {
        // we need to wait until interest is added to the inerestes table
        addVisitPromises.push(PlacesInterestsStorage.addInterestVisit(interest,{visitTime: aVisitDate, visitCount: aVisitCount}));
        addVisitPromises.push(PlacesInterestsStorage.addInterestForHost(interest, aHost));
      }
      Promise.promised(Array)(addVisitPromises).then(results => {
        deferred.resolve(results);
        // test if resubmitRecentHistory echo message arrrived
        // if so, we have added all resubmitted interests and
        // need to resolve _ResubmitRecentHistoryDeferred promise
        if (this._ResubmitRecentHistoryEchoReceived) {
          this._ResubmitRecentHistoryDeferred.resolve();
          this._ResubmitRecentHistoryDeferred = null;
          this._ResubmitRecentHistoryEchoReceived = false;
        }
      }, error => deferred.reject(error))
    }, error => deferred.reject(error));
    return deferred.promise;
  },

  _getTopInterests: function I__getTopInterests(aNumber) {
    let returnDeferred = Promise.defer();
    PlacesInterestsStorage.getTopInterests(aNumber).then(topInterests => {
      // compute diversity first
      PlacesInterestsStorage.getDiversityForInterests(topInterests.map(({name}) => name)).then(diversityResults => {
        // augment with diversity data and start buckets queries
        let bucketPromises = [];
        for (let index=0; index < topInterests.length; index++) {
          let interest = topInterests[index];
          interest.diversity = diversityResults[interest.name] || 0;
          bucketPromises.push(PlacesInterestsStorage.getBucketsForInterest(interest.name));
        }
        // augment with bucket data
        Promise.promised(Array)(bucketPromises).then(buckets => {
          for (let index=0; index < buckets.length; index++) {
            let bucket = buckets[index];
            topInterests[index].recency = {
              immediate: bucket.immediate,
              recent: bucket.recent,
              past: bucket.past,
            }
          }
          returnDeferred.resolve(topInterests);
        }, error => returnDeferred.reject(error));
      }, error => returnDeferred.reject(error));
    }); // end of getTopInterests then
    return returnDeferred.promise;
  },

  _getMetaForInterests: function I__getMetaForInterests(interestNames) {
    let deferred = Promise.defer();
    PlacesInterestsStorage.getMetaForInterests(interestNames).then(metaData => {
      for (let index=0; index < interestNames.length; index++) {
        let interest = interestNames[index];
        if (metaData[interest]) {
          let threshold = metaData[interest].threshold;
          let duration = metaData[interest].duration;
          metaData[interest].threshold = threshold ? threshold : DEFAULT_THRESHOLD;
          metaData[interest].duration = duration ? duration : DEFAULT_DURATION;
          delete metaData[interest].ignored;
          delete metaData[interest].dateUpdated;
        }
      }
      deferred.resolve(metaData);
    }, error => deferred.reject(error));
    return deferred.promise;
  },

  _setIgnoredForInterest: function I__setIgnoredForInterest(interest) {
    return PlacesInterestsStorage.updateIgnoreFlagForInterest(interest, true);
  },

  _unsetIgnoredForInterest: function I__setIgnoredForInterest(interest) {
    return PlacesInterestsStorage.updateIgnoreFlagForInterest(interest, false);
  },

  _getInterestsForHost: function I__getInterestsForHost(aHost, aCallback) {
  },

  _getBucketsForInterests: function I__getBucketsForInterests(aInterests) {
    let rv = {};
    let promiseArray = [];
    let deferred = Promise.defer();
    for (let interest of aInterests) {
      promiseArray.push(PlacesInterestsStorage.getBucketsForInterest(interest))
    }

    let group = Promise.promised(Array);
    let groupPromise = group(promiseArray).then(allInterestsBuckets => {
      allInterestsBuckets.forEach(interestBuckets => {
        rv[interestBuckets.interest] = interestBuckets;
      });
      deferred.resolve(rv);
    }, error => deferred.reject(error));
    return deferred.promise;
  },

  _clearRecentInterests: function I__clearRecentInterests(daysBack) {
    return PlacesInterestsStorage.clearRecentInterests(daysBack);
  },

  _handleInterestsResults: function I__handleInterestsResults(aData) {
    this._addInterestsForHost(aData.host, aData.interests, aData.visitDate, aData.visitCount);
  },

  _handleEchoMessage: function I__handleInterestsResults(aData) {
    if (aData.type == "resubmitRecentHistory") {
      this._ResubmitRecentHistoryEchoReceived = true;
    }
  },

  _getDomainWhitelistedSet: function I__getDomainWhitelist() {
    let whitelistedSet = new Set();
    let userWhitelist = Services.prefs.getCharPref('interests.userDomainWhitelist').trim().split(/\s*,\s*/);
    for (let i=0; i<userWhitelist.length; i++) {
      whitelistedSet.add(userWhitelist[i]);
    }

    return whitelistedSet;
  },

  //////////////////////////////////////////////////////////////////////////////
  //// nsIDOMEventListener

  handleEvent: function I_handleEvent(aEvent) {
    let eventType = aEvent.type;
    if (eventType == "DOMContentLoaded") {
      if (gServiceEnabled) {
        let doc = aEvent.target;
        if (doc instanceof Ci.nsIDOMHTMLDocument && doc.defaultView == doc.defaultView.top) {
          this._handleNewDocument(doc);
        }
      }
    }
    else if (eventType == "message") {
      let msgData = aEvent.data;
      if (msgData.message == "InterestsForDocument") {
        this._handleInterestsResults(msgData);
      }
      else if (msgData.message == "echoMessage") {
        this._handleEchoMessage(msgData);
      }
    }
    else if (eventType == "error") {
      //TODO:handle error
      Cu.reportError(aEvent.message);
    }
  },

  //////////////////////////////////////////////////////////////////////////////
  //// nsIObserver

  observe: function I_observe(aSubject, aTopic, aData) {
    if (aTopic == "app-startup") {
      Services.obs.addObserver(this, "toplevel-window-ready", false);
    }
    else if (aTopic == "toplevel-window-ready") {
      // Top level window is the browser window, not the content window(s).
      aSubject.addEventListener("DOMContentLoaded", this, true);
    }
  },

  //////////////////////////////////////////////////////////////////////////////
  //// nsISupports

  classID: Components.ID("{DFB46031-8F05-4577-80A4-F4E5D492881F}"),

  QueryInterface: XPCOMUtils.generateQI([
  , Ci.nsIDOMEventListener
  , Ci.nsIObserver
  ]),

  get wrappedJSObject() this,

  _xpcom_factory: XPCOMUtils.generateSingletonFactory(Interests),
};

function InterestsWebAPI() {
  this.currentHost = "";
}
InterestsWebAPI.prototype = {
  //////////////////////////////////////////////////////////////////////////////
  //// mozIInterestsWebAPI

  checkInterests: function(aInterests) {
    let deferred = this._makePromise();

    // Only allow API access according to the user's permission
    this._checkContentPermission().then(() => {
      return gInterestsService._getBucketsForInterests(aInterests);
    }).then(results => {
      results = JSON.parse(JSON.stringify(results));

      results["__exposedProps__"] = {};
      // decorate results before sending it back to the caller
      Object.keys(results).forEach(interest => {
        if (interest == "__exposedProps__") {
          return;
        }
        results["__exposedProps__"][interest] = "r";
        results[interest]["__exposedProps__"] = {};
        results[interest]["__exposedProps__"]["immediate"] = "r";
        results[interest]["__exposedProps__"]["recent"] = "r";
        results[interest]["__exposedProps__"]["past"] = "r";
      });
      delete results.interest;
      deferred.resolve(results);
    }, error => deferred.reject(error));

    return deferred.promise;
  },

  getTop5Interests: function() {
    return this.getTopInterests(5);
  },

  getTopInterests: function(aNumber) {
    let deferred = this._makePromise();
    
    let aNumber = aNumber || 5;
    if (aNumber > 5) {
      let whitelistedSet = gInterestsService._getDomainWhitelistedSet();
      if (!whitelistedSet.has(this.currentHost)) { 
        deferred.reject("host "+this.currentHost+" does not have enough privileges to access getTopInterests("+aNumber+")");
        return deferred.promise;
      }
    }
    // Only allow API access according to the user's permission
    this._checkContentPermission().then(() => {
      return gInterestsService._getTopInterests(aNumber);
    }).then(topInterests => {
      topInterests = JSON.parse(JSON.stringify(topInterests));

      let interestNames = [];
      let scoreTotal = 0;
      for (let index=0; index < topInterests.length; index++) {
        interestNames.push(topInterests[index].name);
        scoreTotal += topInterests[index].score;
      }
      gInterestsService._getMetaForInterests(interestNames).then(metaData => {
        for (let index=0; index < interestNames.length; index++) {
          let interest = interestNames[index];
          // obtain metadata and apply thresholds
          topInterests[index].recency.immediate = topInterests[index].recency.immediate >= metaData[interest].threshold;
          topInterests[index].recency.recent = topInterests[index].recency.recent >= metaData[interest].threshold;
          topInterests[index].recency.past = topInterests[index].recency.past >= metaData[interest].threshold;
          
          // normalize scores
          topInterests[index].score /= scoreTotal;
          // round up diversity to closest number divisible by 5
          topInterests[index].diversity = 5*Math.round(topInterests[index].diversity/5);
        }
        exposeAll(topInterests);
        deferred.resolve(topInterests);
      });
    }, error => deferred.reject(error));

    return deferred.promise;
  },

  //////////////////////////////////////////////////////////////////////////////
  //// mozIInterestsWebAPI Helpers

  /**
   * Make a promise that exposes "then" to allow callbacks
   *
   * @returns Promise usable from content
   */
  _makePromise: function IWA__makePromise() {
    let deferred = Promise.defer();
    deferred.promise.__exposedProps__ = {
      then: "r"
    };
    return deferred;
  },

  /**
   * Check if the user has allowed API access
   *
   * @returns Promise for when the content access is allowed or canceled
   */
  _checkContentPermission: function IWA__checkContentPermission() {
    let promptPromise = Promise.defer();

    // APIs created by tests don't have a principal, so just allow them
    if (this.window == null) {
      promptPromise.resolve();
    }
    // For content documents, check the user's permission
    else {
      let prompt = Cc["@mozilla.org/content-permission/prompt;1"].
        createInstance(Ci.nsIContentPermissionPrompt);
      prompt.prompt({
        type: "interests",
        window: this.window,
        principal: this.window.document.nodePrincipal,
        allow: () => promptPromise.resolve(),
        cancel: () => promptPromise.reject(),
      });
    }

    return promptPromise.promise;
  },

  //////////////////////////////////////////////////////////////////////////////
  //// nsIDOMGlobalPropertyInitializer

  init: function IWA__init(aWindow) {
    let uriObj = {host: aWindow.location.hostname || aWindow.location.href};
    this.currentHost = gInterestsService._getPlacesHostForURI(uriObj);
  },

  //////////////////////////////////////////////////////////////////////////////
  //// nsISupports

  classID: Components.ID("{7E7F2263-E356-4B2F-B32B-4238240CD7F9}"),

  classInfo: XPCOMUtils.generateCI({
    "classID": Components.ID("{7E7F2263-E356-4B2F-B32B-4238240CD7F9}"),
    "contractID": "@mozilla.org/InterestsWebAPI;1",
    "interfaces": [Ci.mozIInterestsWebAPI],
    "flags": Ci.nsIClassInfo.DOM_OBJECT,
    "classDescription": "Interests Web API"
  }),

  QueryInterface: XPCOMUtils.generateQI([
  , Ci.mozIInterestsWebAPI
  , Ci.nsIDOMGlobalPropertyInitializer
  ]),
};

let components = [Interests, InterestsWebAPI];
this.NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
