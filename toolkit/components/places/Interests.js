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
Cu.import("resource://gre/modules/PrivateBrowsingUtils.jsm");

const gatherPromises = Promise.promised(Array);

// observer event topics
const kStartup = "app-startup";
const kDOMLoaded = "DOMContentLoaded";
const kShutdown = "xpcom-shutdown";
const kPrefChanged = "nsPref:changed";
const kWindowReady = "toplevel-window-ready";

// prefs
const kPrefEnabled = "interests.enabled";
const kPrefWhitelist = "interests.userDomainWhitelist";
const kPrefUpdateServerURI = "interests.updateServerURI";

let gServiceEnabled = Services.prefs.getBoolPref(kPrefEnabled);
let gInterestsService = null;

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

function Interests() {
  gInterestsService = this;
  Services.prefs.addObserver("interests.", this, false);
}
Interests.prototype = {
  //////////////////////////////////////////////////////////////////////////////
  //// Interests API

  /**
   * Package up interest data by names
   *
   * @param   names
   *          Array of interest string names
   * @returns Promise with interests sorted by score
   */
  getInterestsByNames: function I_getInterestsByNames(names, options={}) {
    return this._packageInterests(PlacesInterestsStorage.
      getScoresForInterests(names, options), options);
  },

  /**
   * Package up top interest data by namespace
   *
   * @param   namespace
   *          Namespace of the interests to fetch
   * @returns Promise with interests sorted by score
   */
  getInterestsByNamespace: function I_getInterestsByNamespace(namespace, options={}) {
    return this._packageInterests(PlacesInterestsStorage.
      getScoresForNamespace(namespace, options), options);
  },

  resubmitRecentHistoryVisits: function I_resubmitRecentHistory(daysBack) {
    // check if history is in progress
    if (this._ResubmitRecentHistoryDeferred) {
      return this._ResubmitRecentHistoryDeferred.promise;
    }

    this._ResubmitRecentHistoryDeferred = Promise.defer();
    this._ResubmitRecentHistoryUrlCount = 0;
    // clean interest tables first
    PlacesInterestsStorage.clearRecentVisits(daysBack).then(() => {
      // read moz_places data and massage it
      PlacesInterestsStorage.getRecentHistory(daysBack, item => {
        try {
          let uri = NetUtil.newURI(item.url);
          item["message"] = "getInterestsForDocument";
          item["host"] = this._getPlacesHostForURI(uri);
          item["path"] = uri["path"];
          item["tld"] = Services.eTLD.getBaseDomainFromHost(item["host"]);
          item["metaData"] = {};
          item["language"] = "en";
          item["messageId"] = "resubmit";
          this._callMatchingWorker(item);
          this._ResubmitRecentHistoryUrlCount++;
        }
        catch(ex) {}
      }).then(() => {
        // check if _ResubmitRecentHistoryDeferred exists and url count == 0
        // then the history is empty and we should resolve the promise
        if (this._ResubmitRecentHistoryDeferred && this._ResubmitRecentHistoryUrlCount == 0) {
          this._resolveResubmitHistoryPromise();
        }
      }); // end of getRecentHistory
    }); // end of clearRecentVisits
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
    // Only compute interests on documents with a host
    let host = this._getPlacesHostForURI(aDocument.documentURIObject);
    if (host == "") {
      return;
    }

    // disallow saving of interests for PB windows
    if (PrivateBrowsingUtils.isWindowPrivate(aDocument.defaultView)) {
      return;
    }

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

  /**
   * Extract the host from the URI in the format Places expects
   *
   * @param   uri
   *          nsIURI to get the host
   * @returns Host string or empty if no host
   */
  _getPlacesHostForURI: function I__getPlacesHostForURI(uri) {
    try {
      return uri.host.replace(/^www\./, "");
    }
    catch(ex) {}
    return "";
  },

  _addInterestsForHost: function I__addInterestsForHost(aHost, aInterests, aVisitDate, aVisitCount) {
    let deferred = Promise.defer();

    // execute host and visit additions
    let addVisitPromises = [];
    for (let interest of aInterests) {
      // we need to wait until interest is added to the inerestes table
      addVisitPromises.push(PlacesInterestsStorage.addInterestVisit(interest,{visitTime: aVisitDate, visitCount: aVisitCount}));
      addVisitPromises.push(PlacesInterestsStorage.addInterestHost(interest, aHost));
    }
    Promise.promised(Array)(addVisitPromises).then(results => {
      deferred.resolve(results);
    }, error => deferred.reject(error))
    return deferred.promise;
  },

  /**
   * Add extra data to a sorted array of interests
   *
   * @param   scoresPromise
   *          Promise with an array of interests with name and score
   * @param   [optional] options {see below}
   *          excludeMeta: Boolean true to not include metadata
   *          roundDiversity: Boolean true to round to the closest int
   *          roundScore: Boolean true to normalize scores to the first score
   *          roundRecency: Boolean true to round to the interest's threshold
   * @returns Promise with an array of interests with added data
   */
  _packageInterests: function I__packageInterests(scoresPromise, options={}) {
    // Wait for the scores to come back with interest names
    return scoresPromise.then(sortedInterests => {
      let names = sortedInterests.map(({name}) => name);
      // Pass on the scores and add on interest, diversity and bucket data
      return [
        sortedInterests,
        PlacesInterestsStorage.getInterests(names),
        PlacesInterestsStorage.getDiversityForInterests(names, options),
        PlacesInterestsStorage.getBucketsForInterests(names, options),
      ];
    // Wait for all the promises to finish then combine the data
    }).then(gatherPromises).then(([interests, meta, diversity, buckets]) => {
      let {excludeMeta, roundDiversity, roundRecency, roundScore} = options;

      // Take the first result's score to be the max
      let maxScore = 0;
      if (interests.length > 0) {
        maxScore = interests[0].score;
      }

      // Package up pieces according to options
      interests.forEach(interest => {
        let {name} = interest;

        // Include diversity and round to a percent [0-100] if requested
        interest.diversity = diversity[name];
        if (roundDiversity) {
          interest.diversity = Math.round(interest.diversity);
        }

        // Include meta only if not explictly excluded
        if (!excludeMeta) {
          interest.meta = meta[name];
        }

        // Include recency and round to thresholds if requested
        interest.recency = buckets[name];
        if (roundRecency) {
          // Round each recency bucket to the interest's threshold
          let {recency} = interest;
          Object.keys(recency).forEach(bucket => {
            recency[bucket] = recency[bucket] >= meta[name].threshold;
          });
        }

        // Round the already-included score to a percent [0-100] if requested
        if (roundScore && maxScore != 0) {
          interest.score = Math.round(interest.score / maxScore * 100);
        }
      });

      return interests;
    });
  },

  _setIgnoredForInterest: function I__setIgnoredForInterest(interest) {
    return PlacesInterestsStorage.setInterest(interest, {
      sharable: false
    });
  },

  _unsetIgnoredForInterest: function I__setIgnoredForInterest(interest) {
    return PlacesInterestsStorage.setInterest(interest, {
      sharable: true
    });
  },

  _getInterestsForHost: function I__getInterestsForHost(aHost, aCallback) {
  },

  _handleInterestsResults: function I__handleInterestsResults(aData) {
    this._addInterestsForHost(aData.host,
                              aData.interests,
                              aData.visitDate,
                              aData.visitCount).then(results => {
      // generate "interest-visit-saved" event
      let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      timer.init(timer => {
        // tell the world we have added this interest
        Services.obs.notifyObservers({wrappedJSObject: aData},
                                     "interest-visit-saved",
                                     null);
        // and check if this is the last interest in the resubmit bunch
        if (aData.messageId == "resubmit") {
          // decerement url count and check if we have seen them all
          this._ResubmitRecentHistoryUrlCount--;
          if (this._ResubmitRecentHistoryUrlCount == 0) {
            this._resolveResubmitHistoryPromise();
          }
        }
      }, 0, Ci.nsITimer.TYPE_ONE_SHOT);
    });
  },

  _resolveResubmitHistoryPromise: function I__resolveResubmitHistoryPromise() {
    if (this._ResubmitRecentHistoryDeferred != null) {
      this._ResubmitRecentHistoryDeferred.resolve();
      this._ResubmitRecentHistoryDeferred = null;
      this._ResubmitRecentHistoryUrlCount = 0;
    }
  },

  _getDomainWhitelistedSet: function I__getDomainWhitelist() {
    if (!("__whitelistedSet" in this)) {
      // init with default values
      this.__whitelistedSet = new Set(["mozilla.org", "mozilla.com"]);

      // load from user prefs
      let userWhitelist = Services.prefs.getCharPref(kPrefWhitelist).trim().split(/\s*,\s*/);
      for (let i=0; i<userWhitelist.length; i++) {
        this.__whitelistedSet.add(userWhitelist[i]);
      }
    }

    return this.__whitelistedSet;
  },

  _initInterestMeta: function I__initInterestMeta() {
    const interests = ["arts", "banking", "blogging", "business", "career",
    "cars", "clothes", "computers", "consumer-electronics", "cuisine", "dance",
    "discounts", "drinks", "education", "email", "entertainment", "family",
    "fashion", "finance", "food", "games", "government", "health", "history",
    "hobby", "home", "image-sharing", "law", "maps", "marketing", "men",
    "motorcycles", "movies", "music", "news", "outdoors", "pets", "photography",
    "politics", "radio", "reading", "real-estate", "reference", "relationship",
    "religion", "reviews", "science", "shoes", "shopping", "society", "sports",
    "technology", "travel", "tv", "video-games", "weather", "women", "writing"];

    interests.forEach(item => PlacesInterestsStorage.setInterest(item, {
      duration: 14,
      threshold: 100,
    }));
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Processing Update Server Namespace Data & IFR Rules

  _processInterestIFR: function I___processInterestIFR(serverNamespace,
                                                       interest,
                                                       rule_ifr,
                                                       lastModified) {
    if (!rule_ifr) {
      // this rule must be deleted
      return PlacesInterestsStorage.deleteInterestIFR(serverNamespace,interest);
    }

    let {matches,threshold,duration} = rule_ifr;

    PlacesInterestsStorage.setInterest(interest, {
      threshold: threshold,
      duration: duration,
    }).then(() => {
      return PlacesInterestsStorage.setInterestIFR(
               serverNamespace,
               interest,
               lastModified,
               matches);
    });
  },

  _processServerNamespace: function I__processServerNamespace(serverNamespace,
                                                  lastModified,
                                                  ifrData,
                                                  deleteOutdatedRules) {
    let deferred = Promise.defer();
    let promises = [];

    // we have to update timestamp on the server namespace itself
    promises.push(PlacesInterestsStorage.setServerNamespace(serverNamespace,lastModified));

    // now handle each rule
    Object.keys(ifrData).forEach(key => {
      // parse out rule name to extract server namespace & interest
      let bits = key.split(":");
      let ruleNamespace = bits.shift();
      let interest = bits.shift();
      // make sure rule serverNamespace match the argumets
      if (ruleNamespace != serverNamespace) {
        // TODO: Handle Error
        Cu.reportError(aEvent.message);
        return;
      }
      promises.push(
        this._processInterestIFR(serverNamespace,
                                 interest,
                                 ifrData[key],
                                 lastModified));
    });


    // when all insetions are done, we must do the clean up
    Promise.promised(Array)(promises).then(() => {
      if (deleteOutdatedRules) {
        // delete interests timestemaped before lastModified
        PlacesInterestsStorage.
          deleteOutdatedInterestIFRs(serverNamespace, lastModified).then(() => deferred.resolve());
      }
      else {
        // no deletion - bring all server namespace rules to the given timestamp
        PlacesInterestsStorage.
          updateOutdatedInterestIFRs(serverNamespace, lastModified).then(() => deferred.resolve());
      }
    });
    return deferred.promise;
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Update Server Communication Helpers

  _getNamespaceGetURL: function(serverNamespace) {
    if (this.__updateServerBaseURI == null) {
      Cu.reportError("Empty URI for Interest Update Server");
      throw("Empty URI for Interest Update Server");
    }
    return this.__updateServerBaseURI + "/api/v0/rules/" + serverNamespace;
  },
  
  _resetUpdateServerURI: function() {
    this.__updateServerBaseURI = Services.prefs.getCharPref("interests.updateServerURI");
  },

  _RFC2822ToMilliSeconds: function(rfc2822Date) {
    return Date.parse(rfc2822Date);
  },

  _miliSecondsToRFC2822: function(miliSeconds) {
    let dt = new Date(miliSeconds);
    return dt.toUTCString();
  },

  _update: function() {
    return this._updateServerNamespaces();
  },

  _handleServerNamespaceResponse: function(serverNamespace,xhr) {
    let lastModifiedHeader = xhr.getResponseHeader("Last-Modified");
    let lastModified = this._RFC2822ToMilliSeconds(lastModifiedHeader);
    switch (xhr.status) {
      case 200:
        // full server namespace update, delete outdated rules
        return this._processServerNamespace(serverNamespace,
                                      lastModified,
                                      xhr.response,
                                      true);
        break;

      case 206:
        // partual server namespace update, only update specified rules
        return this._processServerNamespace(serverNamespace,
                                      lastModified,
                                      xhr.response);
        break;

      case 410:  // gone
        return PlacesInterestsStorage.clearServerNamespace(serverNamespace);
        break;

      case 304:  // not modified
      case 400:  // bad request
      case 404:  // not found
      default:   // anything else
        let deferred = Promise.defer();
        deferred.promise.resolve();
        return deferred.promise;
    }
  },

  _makeHttpRequest: function(serverNamespace,deferred) {
    let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xhr.onload = function() {
      try {
        this._handleServerNamespaceResponse(serverNamespace,
                                            xhr).then(() => deferred.resolve());
      } catch(e) {
        //TODO:handle error - what should we do here?
        // for the time being - we still resolve the promise
        // to avoid penalizing all namespaces if one times out
        Cu.reportError(e);
        deferred.resolve();
      }
    }.bind(this);
    xhr.onabort = xhr.onerror = xhr.ontimeout = function handleFail() {
        //TODO:handle error - what should we do here?
        // for the time being - we still resolve the promise
        // to avoid penalizing all namespaces if one times out
        Cu.reportError("error talking to the server");
        deferred.resolve();
    };
    return xhr;
  },

  _updateServerNamespaces: function() {
    let returnDeferred = Promise.defer();
    let promises = [];
    PlacesInterestsStorage.getServerNamespaces().then(results => {
      try {
        results.forEach(nsObject => {
          // create and store a promise
          let deferred = Promise.defer();
          promises.push(deferred.promise);
          // set up HttpResponse
          let {serverNamespace,lastModified} = nsObject;
          let xhr = this._makeHttpRequest(serverNamespace,deferred);
          // setup headers and urls
          xhr.open("GET", this._getNamespaceGetURL(serverNamespace));
          xhr.responseType = "json";
          if (lastModified) {
            xhr.setRequestHeader("If-Modified-Since",
                                 this._miliSecondsToRFC2822(lastModified));
          }
          // now send the request
          xhr.send();
        }); // end of GET of one namespace
        // we have sent requests to download all namespace - promise the world
        Promise.promised(Array)(promises).then(() => returnDeferred.resolve());
      } catch (ex) {
        // if we throw , we should reject the promise right away
        returnDeferred.reject(ex);
      } // end of try/catch
    }); // end of forEach

    return returnDeferred.promise;
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
    }
    else if (eventType == "error") {
      //TODO:handle error
      Cu.reportError(aEvent.message);
    }
  },

  //////////////////////////////////////////////////////////////////////////////
  //// nsIObserver

  observe: function I_observe(aSubject, aTopic, aData) {
    if (aTopic == kStartup) {
      Services.obs.addObserver(this, kWindowReady, false);
      Services.obs.addObserver(this, kShutdown, false);
    }
    else if (aTopic == kWindowReady) {
      // Top level window is the browser window, not the content window(s).
      aSubject.addEventListener(kDOMLoaded, this, true);
    }
    else if (aTopic == kPrefChanged) {
      if (aData == kPrefEnabled) {
        this._prefEnabledHandler();
      }
      else if (aData == kPrefWhitelist) {
        this._resetWhitelistHandler();
      }
      else if (aData == kPrefUpdateServerURI) {
        this._resetUpdateServerURI();
      } 
    }
    else if (aTopic == kShutdown) {
      Services.obs.removeObserver(this, kStartup);
      Services.obs.removeObserver(this, kShutdown);
      Servies.prefs.removeObserver("interests.", this);
    }
    else {
      Cu.reportError("unhandled event: "+aTopic);
    }
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Preference observers

  // Add a pref observer for the enabled state
  _prefEnabledHandler: function I__prefEnabledHandler() {
    let enable = Services.prefs.getBoolPref(kPrefEnabled);
    if (enable && !gServiceEnabled) {
      gServiceEnabled = true;

      // initialize interest metadata if need be
      PlacesInterestsStorage.getInterests(["arts"]).then(results => {
        if (Object.keys(results).length == 0) {
          this._initInterestMeta();
        }
      });
    }
    else if (!enable && gServiceEnabled) {
      delete this.__worker;
      gServiceEnabled = false;
    }
  },

  // pref observer for user-defined whitelist
  _resetWhitelistHandler: function I__resetWhitelistHandler() {
    if (gInterestsService && this.__whitelistedSet) {
      delete this.__whitelistedSet;
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

  /**
   * Get information about specific interests sorted by score
   *
   * @param   interests
   *          An array of interest name strings
   * @param   [optional] interestsData
   * @returns Promise with the sorted array of top interests
   */
  getInterests: function IWA_getInterests(interests, interestsData) {
    let deferred = this._makePromise();

    let whitelistedSet = gInterestsService._getDomainWhitelistedSet();
    if (!whitelistedSet.has(this.currentHost)) {
      deferred.reject("host "+this.currentHost+" does not have enough privileges to access getInterests");
      return deferred.promise;
    }

    // Only allow API access according to the user's permission
    this._checkContentPermission().then(() => {
      return gInterestsService.getInterestsByNames(interests, {
        checkSharable: true,
        excludeMeta: true,
        roundDiversity: true,
        roundRecency: true,
        roundScore: true,
      });
    }).then(sortedInterests => {
      exposeAll(sortedInterests);
      deferred.resolve(sortedInterests);
    }, error => deferred.reject(error));

    return deferred.promise;
  },

  /**
   * Get the user's top interests
   *
   * @param   [optional] topData
   * @returns Promise with the array of top interests
   */
  getTopInterests: function IWA_getTopInterests(topData) {
    let deferred = this._makePromise();
    let aNumber = topData || 5;
    if (aNumber > 5) {
      let whitelistedSet = gInterestsService._getDomainWhitelistedSet();
      if (!whitelistedSet.has(this.currentHost)) {
        deferred.reject("host "+this.currentHost+" does not have enough privileges to access getTopInterests("+aNumber+")");
        return deferred.promise;
      }
    }

    // Only allow API access according to the user's permission
    this._checkContentPermission().then(() => {
      return gInterestsService.getInterestsByNamespace("", {
        checkSharable: true,
        excludeMeta: true,
        interestLimit: aNumber,
        roundDiversity: true,
        roundRecency: true,
        roundScore: true,
      });
    }).then(topInterests => {
      exposeAll(topInterests);
      deferred.resolve(topInterests);
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
    // Also allow higher privileged pages.
    if (this.window == null || this.window.document == null) {
      promptPromise.resolve();
    }
    // For private browsing window - always reject
    else if (PrivateBrowsingUtils.isWindowPrivate(this.window)) {
      promptPromise.reject("Interests Unavailable in Private Browsing mode");
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
    this.window = aWindow;
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
