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
Cu.import("resource://gre/modules/interests/InterestsStorage.jsm");
Cu.import("resource://gre/modules/interests/InterestsDatabase.jsm");
Cu.import("resource://gre/modules/PlacesInterestsUtils.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource://gre/modules/PrivateBrowsingUtils.jsm");
Cu.import("resource://gre/modules/Task.jsm");

const gatherPromises = Promise.promised(Array);

// observer event topics
const kDOMLoaded = "DOMContentLoaded";
const kPrefChanged = "nsPref:changed";
const kShutdown = "xpcom-shutdown";
const kStartup = "app-startup";
const kWindowReady = "toplevel-window-ready";

// prefs
const kPrefClassifierEnabled = "interests.enabled";
const kPrefWebAPIEnabled = "interests.navigator.enabled";
const kPrefWhitelist = "interests.userDomainWhitelist";
const kPrefRegionCode = "interests.regionCode";

// constants
const kDaysToResubmit = 31;
const kResubmitChunkSize = 1000;

XPCOMUtils.defineLazyGetter(this, 'kRegionCode', function() {
  let regionCode = Services.prefs.getCharPref(kPrefRegionCode).trim();
  return ['en-US', 'zh-CN'].indexOf(regionCode) == -1 ? 'en-US' : regionCode;
});

XPCOMUtils.defineLazyGetter(this, 'kInterests', function() {
  // Read categories from files
  let scriptLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"].
    getService(Ci.mozIJSSubScriptLoader);
  let model = scriptLoader.loadSubScript("resource://gre/modules/interests/data/" + kRegionCode + "/interestsCategories.js");
  return interestsCategories;
});

let gClassifierEnabled = Services.prefs.getBoolPref(kPrefClassifierEnabled);
let gAPIEnabled = Services.prefs.getBoolPref(kPrefWebAPIEnabled);
let gInterestsService = null;

function exposeAll(obj) {
  // Filter for Objects and Arrays.
  if (typeof obj !== "object" || !obj) {
    return;
  }

  // Recursively expose our children.
  Object.keys(obj).forEach(key => exposeAll(obj[key]));

  // If we're not an Array, generate an __exposedProps__ object for ourselves.
  if (obj instanceof Array) {
    return;
  }

  var exposed = {};
  Object.keys(obj).forEach(key => exposed[key] = "r");
  obj.__exposedProps__ = exposed;
}

function Interests() {
  gInterestsService = this;
  Services.prefs.addObserver("interests.", this, false);

  // Lazily initialize the database/storage then prepare for service usage
  XPCOMUtils.defineLazyGetter(this, "InterestsStoragePromise", () => {
    let deferred = Promise.defer();

    // Async get the database connection then handle initialization
    Task.spawn(function() {
      let connection = yield InterestsDatabase.DBConnectionPromise;
      let interestsStorage = new InterestsStorage(connection);

      // Do additional initialization if the database migrated
      if (connection.isMigrated) {
        // Make sure the interests metadata exists
        yield this._checkMetadataInit(interestsStorage);

        // Clear out some recent interests to reprocess because we migrated
        yield interestsStorage.clearRecentVisits(kDaysToResubmit);
      }

      // Make storage available for general usage at this point
      deferred.resolve(interestsStorage);

      // Additionally populate the migrated database with recent interests
      if (connection.isMigrated) {
        yield this._resubmitRecentHistory(kDaysToResubmit, kResubmitChunkSize, false);
      }
    }.bind(this));

    return deferred.promise;
  });
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
    return this.InterestsStoragePromise.then(interestsStorage => {
      return this._packageInterests(interestsStorage.
        getScoresForInterests(names, options), options);
    });
  },

  /**
   * Package up top interest data by namespace
   *
   * @param   namespace
   *          Namespace of the interests to fetch
   * @returns Promise with interests sorted by score
   */
  getInterestsByNamespace: function I_getInterestsByNamespace(namespace, options={}) {
    return this.InterestsStoragePromise.then(interestsStorage => {
      return this._packageInterests(interestsStorage.
        getScoresForNamespace(namespace, options), options);
    });
  },

  /**
   * Re-submits to interests cliassifier synthetic urls from places history
   *
   * @param   daysBack
   *          A number of days to go back into history
   * @returns Promise when resubmission is complete
   */
  resubmitRecentHistoryVisits: function I_resubmitRecentHistoryVisits(daysBack) {
    return this._resubmitRecentHistory(daysBack,kResubmitChunkSize);
  },

  /**
   * tests if a particular site is blocked
   *
   * @param   site
   * @returns true if site is blocked, false otherwise
   */
  isSiteBlocked: function I_isSiteBlocked(domain) {
    return Services.perms.testExactPermission(NetUtil.newURI("http://" + domain),"interests") ==
           Services.perms.DENY_ACTION;
  },

  /**
   * tests if a particular site is explicitly enabled
   *
   * @param   site
   * @returns true if site is explicitly enabled, false otherwise
   */
  isSiteEnabled: function I_isSiteEnabled(domain) {
    return Services.perms.testExactPermission(NetUtil.newURI("http://" + domain),"interests") ==
           Services.perms.ALLOW_ACTION;
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Interests Helpers

  /**
   * inits and returns worker instance.
   *
   * @returns the worker instance
   */
  get _worker() {
    if (gClassifierEnabled && !("__worker" in this)) {
      // Use a ChromeWorker to workaround Bug 487070.
      this.__worker = new ChromeWorker("resource://gre/modules/interests/worker/interestsWorker.js");
      this.__worker.addEventListener("message", this, false);
      this.__worker.addEventListener("error", this, false);

      // load reference data files and pass them to the worker
      let scriptLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"].
        getService(Ci.mozIJSSubScriptLoader);
      let data = scriptLoader.loadSubScript("resource://gre/modules/interests/data/" + kRegionCode + "/interestsData.js");
      let model = scriptLoader.loadSubScript("resource://gre/modules/interests/data/" + kRegionCode + "/interestsClassifierModel.js");
      let stopwords = scriptLoader.loadSubScript("resource://gre/modules/interests/worker/interestsUrlStopwords.js");

      // bootstrap message makes worker to setup categorization structures
      this.__worker.postMessage({
        message: "bootstrap",
        regionCode: kRegionCode,
        interestsDataType: "dfr",
        interestsData: interestsData,
        interestsClassifierModel: interestsClassifierModel,
        interestsUrlStopwords: interestsUrlStopwords
      });
    }
    return this.__worker;
  },


  /**
   * Package up shared interests by hosts
   *
   * @param   [optional] daysBack
   *          retrieve domains that accessed interests between daysBack and now
   *          if omitted all domains will be returned
   * @returns Promise with domains + corresponding interests
   */
  _getRequestingHosts: function I__getRequestingHosts(daysBack) {
    return this.InterestsStoragePromise.then(interestsStorage => {
      return interestsStorage.getPersonalizedHosts(daysBack).then(results => {
        let hostsData = {};
        let hostsList = [];
        // hosts come in order
        results.forEach(data => {
          let {interest, host} = data;
          if (!hostsData[host]) {
            // create a host object
            let hostObject = {
              name: host,
              interests: [],
              isBlocked: this.isSiteBlocked(host),
              isPrivileged: this._getDomainWhitelistedSet().
                              has(this._normalizeHostName(host)),
            };
            hostsData[host] = hostObject;
            hostsList.push(hostObject);
          }
          // push corresponding host & the interest,date of visit
          hostsData[host].interests.push(interest);
        });
        return hostsList;
      });
    });
  },

  /**
   * Handles a new page load
   */
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

    // send relevant page info to the worker for interests matching
    this._callMatchingWorker({
      message: "getInterestsForDocument",
      url: aDocument.documentURI,
      host: host,
      path: aDocument.documentURIObject.path,
      title: aDocument.title,
      tld: this._getBaseDomain(host),
      metaData: {} ,
      language: "en"
    });
  },

  _callMatchingWorker: function I__callMatchingWorker(callObject) {
    this._worker.postMessage(callObject);
  },

  /**
   * Normalize host name
   *
   * @param   host
   * @returns normalized Host string
   */
  _normalizeHostName: function I__normalizeHostName(host) {
     return host.replace(/^www\./, "");
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
      return this._normalizeHostName(uri.host);
    }
    catch(ex) {}
    return "";
  },

  /**
   * Record potentially multiple interests for a given host for a visit
   *
   * @param   interests
   *          Array of interests to save
   * @param   host
   *          Host triggering the interests
   * @param   visitDate
   *          Date to associate with the interest visit
   * @param   visitCount
   *          Number of visits on the date
   * @returns Promise when interests are added
   */
  _addInterestsForHost: function I__addInterestsForHost(interests, host, visitDate, visitCount) {
    return this.InterestsStoragePromise.then(interestsStorage => {
      // execute host and visit additions
      let addVisitPromises = [];
      for (let interest of interests) {
        addVisitPromises.push(interestsStorage.addInterestHostVisit(interest, host, {
          visitCount: visitCount,
          visitTime: visitDate,
        }));
      }
      return gatherPromises(addVisitPromises);
    });
  },

  /**
   * Add extra data to a sorted array of interests
   *
   * @param   scoresPromise
   *          Promise with an array of interests with name and score
   * @param   [optional] options {see below}
   *          excludeMeta: Boolean true to not include metadata
   *          roundDiversity: Boolean true to normalize to the max host count
   *          roundScore: Boolean true to normalize scores to the first score
   * @returns Promise with an array of interests with added data
   */
  _packageInterests: function I__packageInterests(scoresPromise, options={}) {
    return this.InterestsStoragePromise.then(interestsStorage => {
      // Wait for the scores to come back with interest names
      return scoresPromise.then(sortedInterests => {
        let names = sortedInterests.map(({name}) => name);
        // Pass on the scores and add on interest and host counts
        return [
          sortedInterests,
          interestsStorage.getInterests(names),
          interestsStorage.getHostCountsForInterests(names, options),
        ];
      // Wait for all the promises to finish then combine the data
      }).then(gatherPromises).then(([interests, meta, hostCounts]) => {
        let {excludeMeta, roundDiversity, roundScore} = options;

        // Take the first result's score to be the max
        let maxScore = 0;
        if (interests.length > 0) {
          maxScore = interests[0].score;
        }

        // Find the largest host count for these interests
        let maxHosts = 0;
        Object.keys(hostCounts).forEach(interest => {
          maxHosts = Math.max(maxHosts, hostCounts[interest]);
        });

        // Package up pieces according to options
        interests.forEach(interest => {
          let {name} = interest;

          // Include diversity and round to a percent [0-100] if requested
          interest.diversity = hostCounts[name];
          if (roundDiversity && maxHosts != 0) {
            interest.diversity = Math.round(interest.diversity / maxHosts * 100);
          }

          // Include meta only if not explictly excluded
          if (!excludeMeta) {
            interest.meta = meta[name];
          }

          // Round the already-included score to a percent [0-100] if requested
          if (roundScore && maxScore != 0) {
            interest.score = Math.round(interest.score / maxScore * 100);
          }
        });

        return interests;
      }).then(interests => {
        let {requestingHost} = options;

        // if requestingHost is null, return interests right away
        if (!requestingHost) {
          return interests;
        }

        // otherwise we have to store what we share with this host
        // call setSharedInterest for each interest being returned to caller
        let promises = [];
        interests.forEach(interest => {
          promises.push(interestsStorage.setSharedInterest(interest.name,requestingHost));
        });

        // return promise to wait until insertions complete, and resolve it to the interests
        return gatherPromises(promises).then(() => {
          return interests;
        });
      });
    });
  },

  /**
   * Handle data from interest matching worker
   *  when worker finds categories for a url it
   *  sends matched interests back to the main-thread
   *  this function will call _addInterestsForHost
   *  and also will check if the resubmit url count went to 0
   *  in which case, it will resolve ResubmitHistoryPromise
   */
  _handleInterestsResults: function I__handleInterestsResults(aData) {
    this._addInterestsForHost(aData.interests,
                              aData.host,
                              aData.visitDate,
                              aData.visitCount).then(results => {
      // generate "interest-visit-saved" event
      this._setupOneTimeTimer(() => {
        // tell the world we have added this interest
        Services.obs.notifyObservers({wrappedJSObject: aData},
                                     "interest-visit-saved",
                                     null);
        // and check if this is the last interest in the resubmit bunch
        if (aData.messageId == "resubmit") {
          // decerement url count and check if we have seen them all
          this._ResubmitRecentHistoryUrlCount--;
          if (this._ResubmitRecentHistoryUrlCount == 0) {
            // one chunked resubmission is finished - start another
            this._setupOneTimeTimer(() => {
              this._resubmitRecentHistoryChunk();
            });
          }
        }
      });
    });
  },

  _resolveResubmitHistoryPromise: function I__resolveResubmitHistoryPromise() {
    if (this._ResubmitRecentHistoryDeferred != null) {
      this._ResubmitRecentHistoryDeferred.resolve();
      this._ResubmitRecentHistoryDeferred = null;
    }
  },

  /**
   * inits and returns domains allowed full access to interests
   *
   * @returns list of domains
   */
  _getDomainWhitelistedSet: function I__getDomainWhitelist() {
    if (!("__whitelistedSet" in this)) {
      // init with default values
      this.__whitelistedSet = new Set(["mozilla.org", "mozilla.com", "people.mozilla.com", "people.mozilla.org"]);

      // load from user prefs
      let userWhitelist = Services.prefs.getCharPref(kPrefWhitelist).trim().split(/\s*,\s*/);
      for (let i=0; i<userWhitelist.length; i++) {
        this.__whitelistedSet.add(userWhitelist[i]);
      }
    }

    return this.__whitelistedSet;
  },

  /**
   * Initializes hardcoded interests
   *
   * @returns A promise for all interests being initialized
   */
  _initInterestMeta: function I__initInterestMeta(interestsStorage) {
    let promises = [];

    kInterests.forEach(item => {
      promises.push(interestsStorage.setInterest(item));
    });

    return gatherPromises(promises);
  },

  /**
   * sets up a one time timer
   *
   * @param   callback
   *          callback to call
   */
  _setupOneTimeTimer: function I__setupOneTimeTimer(callback) {
    let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.init(timer => callback(timer), 0, Ci.nsITimer.TYPE_ONE_SHOT);
  },

  /**
   * inits interest metadata if interests don't exist
   *
   * @param   interestsStorage
   *          A storage instance
   * @returns completion promise
   */
  _checkMetadataInit: function I__checkMetadataInit(interestsStorage) {
    let metadataPromise = Promise.defer();
    interestsStorage.getInterests([kInterests[0]]).then(results => {
      if (Object.keys(results).length == 0) {
        this._initInterestMeta(interestsStorage).then(() => {
          metadataPromise.resolve();
        });
      }
      else {
          metadataPromise.resolve();
      }
    });
    return metadataPromise.promise;
  },

  /**
   * returns base domain or "" if unable to resolve
   *
   * @param   host
   * @returns base domain of the host or "" on error
   */
  _getBaseDomain: function I__getBaseDomain(host) {
    try {
      return Services.eTLD.getBaseDomainFromHost(host);
    }
    catch (ex) {
      return "";
    }
  },

  /**
   * Re-submits to interests cliassifier synthetic urls from places history
   *
   * @param   interestsStorage
   *          A storage instance
   * @param   daysBack
   *          A number of days to go back into history
   * @param   chunkSize
   *          A number of raws to return in one query
   * @param   doClearDatabase
   *          A flag to clear database before submit (true by default)
   * @returns Promise when resubmission is complete
   */
  _resubmitRecentHistory: function I__resubmitRecentHistory(daysBack, chunkSize, doClearDatabase = true) {
    return this.InterestsStoragePromise.then(interestsStorage => {
      // check if history is in progress
      if (this._ResubmitRecentHistoryDeferred) {
        return this._ResubmitRecentHistoryDeferred.promise;
      }
      this._ResubmitRecentHistoryDeferred = Promise.defer();
      this._ResubmitRecentHistoryLargestId = 0;
      this._ResubmitRecentHistoryDaysBack = daysBack;
      this._ResubmitRecentHistoryChunkSize = chunkSize;
      // spawn a Task to resubmit history
      Task.spawn(function() {
        // clear history if needed
        if (doClearDatabase) {
          yield interestsStorage.clearRecentVisits(daysBack);
        }
        // run the first chunk of history resubmission
        yield this._resubmitRecentHistoryChunk();
      }.bind(this));  // end of Task.spawn
      return this._ResubmitRecentHistoryDeferred.promise;
    });
  },

  /**
   * Runs a single instance of a chunked history resubmission
   *
   * @returns Promise when instance of chunked resubmission is complete
   */
  _resubmitRecentHistoryChunk: function I__ResubmitRecentHistoryChunk() {
    // clear out url count
    this._ResubmitRecentHistoryUrlCount = 0;
    // read moz_places data and message it to the worker
    return PlacesInterestsUtils.getRecentHistory(this._ResubmitRecentHistoryDaysBack, item => {
      try {
        let uri = NetUtil.newURI(item.url);
        item["message"] = "getInterestsForDocument";
        item["host"] = this._getPlacesHostForURI(uri);
        item["path"] = uri["path"];
        item["tld"] = this._getBaseDomain(item["host"]);
        item["metaData"] = {};
        item["language"] = "en";
        item["messageId"] = "resubmit";
        this._callMatchingWorker(item);
        this._ResubmitRecentHistoryUrlCount++;
        // keep track of the largest Id for this resubmission chunk
        if (this._ResubmitRecentHistoryLargestId < item["id"]) {
          this._ResubmitRecentHistoryLargestId = item["id"];
        }
      }
      catch(ex) {}
    },
    {
      chunkSize: this._ResubmitRecentHistoryChunkSize,
      lastPlacesId: this._ResubmitRecentHistoryLargestId,
    }).then(() => {
       // check if _ResubmitRecentHistoryDeferred exists and url count == 0
       // then if the history returns nothing for the this query, we can resolve
       // the resubmit promise
       if (this._ResubmitRecentHistoryDeferred && this._ResubmitRecentHistoryUrlCount == 0) {
         this._resolveResubmitHistoryPromise();
       }
   }); // end of getRecentHistory
 },

  //////////////////////////////////////////////////////////////////////////////
  //// nsIDOMEventListener

  handleEvent: function I_handleEvent(aEvent) {
    let eventType = aEvent.type;
    if (eventType == "DOMContentLoaded") {
      if (gClassifierEnabled) {
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
      Services.obs.addObserver(this, kShutdown, false);
      Services.obs.addObserver(this, kWindowReady, false);
    }
    else if (aTopic == kWindowReady) {
      // Top level window is the browser window, not the content window(s).
      aSubject.addEventListener(kDOMLoaded, this, true);
    }
    else if (aTopic == kPrefChanged) {
      if (aData == kPrefClassifierEnabled) {
        this._prefClassifierHandler();
      }
      else if (aData == kPrefWebAPIEnabled) {
        this._prefAPIHandler();
      }
      else if (aData == kPrefWhitelist) {
        this._resetWhitelistHandler();
      }
    }
    else if (aTopic == kShutdown) {
      Services.obs.removeObserver(this, kShutdown);
      Services.obs.removeObserver(this, kWindowReady);
      Services.prefs.removeObserver("interests.", this);
    }
    else {
      Cu.reportError("unhandled event: "+aTopic);
    }
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Preference observers

  // Add a pref observer for the enabled state
  _prefClassifierHandler: function I__prefClassifierHandler() {
    let enable = Services.prefs.getBoolPref(kPrefClassifierEnabled);
    if (enable && !gClassifierEnabled) {
      gClassifierEnabled = true;
    }
    else if (!enable && gClassifierEnabled) {
      delete this.__worker;
      gClassifierEnabled = false;
    }
  },

  _prefAPIHandler: function I__prefAPIHandler() {
    let enable = Services.prefs.getBoolPref(kPrefWebAPIEnabled);
    if (enable && !gAPIEnabled) {
      gAPIEnabled = true;
    }
    else if (!enable && gAPIEnabled) {
      gAPIEnabled = false;
    }
  },

  // pref observer for user-defined whitelist
  _resetWhitelistHandler: function I__resetWhitelistHandler() {
    if (gInterestsService && this.__whitelistedSet) {
      delete this.__whitelistedSet;
    }
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Dashboard utility functions

  /**
   * Collects info for a dashboard
   *
   * @returns data to fully populate a dashboard page
   */
  getPagePayload: function I_getPagePayload(aInterestProfileLimit) {
    let promises = [];

    aInterestProfileLimit = aInterestProfileLimit || kInterests.length;

    // obtain interests ordered by score
    let interestPromise = this.getInterestsByNamespace("", {
      checkSharable: false,
      excludeMeta: false,
      interestLimit: aInterestProfileLimit,
      roundDiversity: true,
      roundScore: true,
    });

    // obtain host info for selected interests
    let interestHostPromise = interestPromise.then(interests => {
      let interestList = [];
      for(let i=0; i < interests.length; i++) {
        interestList.push(interests[i].name);
      }

      return this.InterestsStoragePromise.then(interestsStorage => {
        return interestsStorage.getRecentHostsForInterests(interestList, Infinity);
      });
    });

    // gather and package the data promises
    promises.push(interestPromise);
    promises.push(interestHostPromise);
    promises.push(this._getRequestingHosts());
    return gatherPromises(promises).then(results => {
      let output = {};
      output.interestsProfile = results[0];
      output.requestingSites = results[2];

      let hostData = results[1];
      output.interestsHosts = {};
      for(let i=0; i < hostData.length; i++) {
        let item = hostData[i];
        if (!output.interestsHosts.hasOwnProperty(item.interest)) {
          output.interestsHosts[item.interest] = [];
        }
        output.interestsHosts[item.interest].push({
          days: item.days,
          host: item.host,
          visits: item.visits,
        });
      }

      return output;
    });
  },

  /**
   * Set Interest Sharability metadata
   *
   */
  setInterestSharable: function I_setInterestSharable(interest, value) {
    value = value ? 1 : 0;
    return this.InterestsStoragePromise.then(interestsStorage => {
      return interestsStorage.setInterest(interest, {sharable: value});
    });
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
        roundScore: true,
        requestingHost: this.realHost,
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
        roundScore: true,
        requestingHost: this.realHost,
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
    // Always reject for private browsing window
    else if (PrivateBrowsingUtils.isWindowPrivate(this.window)) {
      promptPromise.reject("blocked");
    }
    // For content documents, check the user's permission
    else {
      let host = gInterestsService._getPlacesHostForURI(this.window.document.documentURIObject);
      if (!gAPIEnabled && !gInterestsService.isSiteEnabled(host)) {
        // reject if web api is not enabled and if site is not explicitly enabled
        promptPromise.reject("blocked");
      }

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
    this.realHost = uriObj.host;
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
