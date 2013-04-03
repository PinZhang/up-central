/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = [
  "PlacesInterestsStorage"
]

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PlacesUtils", "resource://gre/modules/PlacesUtils.jsm");

const MS_PER_DAY = 86400000;
const DEFAULT_THRESHOLD = 5;
const DEFAULT_DURATION = 14;
const INTEREST_HOST_QUERY_LIMIT = 100;

/*
 * Generates a string for use with the SQLite client for binding parameters by array indexing
 */
function genSQLParamList(aNumber) {
  let paramStr = "";
  for (let index = 1; index <= aNumber; index++) {
    paramStr += "?" + index;
    if (index < aNumber) {
      paramStr += ",";
    }
  }
  return paramStr
}

function AsyncPromiseHandler(deferred, rowCallback) {
  this.deferred = deferred;
  this.rowCallback = rowCallback;
  this.result = undefined;
};

AsyncPromiseHandler.prototype = {
  initResults: function(value) {
      this.result = value;
  },
  addToResultObject: function(key,value) {
    if (!this.result) {
      this.result = {};
    }
    this.result[key] = value;
  },
  addToResultSet: function(value) {
    if (!this.result) {
      this.result = [];
    }
    this.result.push(value);
  },
  handleError: function (error) {
    this.deferred.reject(error);
  },
  handleResult: function (result) {
    if (this.rowCallback) {
      let row = undefined;
      while (row = result.getNextRow()) {
        this.rowCallback(row);
      }
    }
  },
  handleCompletion: function (reason) {
    switch (reason) {
      case Ci.mozIStorageStatementCallback.REASON_FINISHED:
        this.deferred.resolve(this.result);
        break;

      case Ci.mozIStorageStatementCallback.REASON_CANCELLED:
        this.deferred.reject(new Error("statement cancelled"));
        break;

      case Ci.mozIStorageStatementCallback.REASON_ERROR:
        this.deferred.reject(new Error("execution errors"));
        break;

      default:
        this.deferred.reject(new Error("unknown completion reason"));
        break;
    }
  }
};

let PlacesInterestsStorage = {
  /**
   * Convert a date to the UTC midnight for the date
   *
   * @param   [optional] time
   *          Reference date/time to round defaulting to today
   * @returns Numeric value corresponding to the date's UTC 00:00:00.000
   */
  _getRoundedTime: function(time) {
    // Default to now if no time is provided
    time = time || Date.now();
    // Round to the closest day
    return time - time % MS_PER_DAY;
  },

  addInterest: function (aInterest) {
    let returnDeferred = Promise.defer();
    let stmt = this.db.createAsyncStatement(
      "INSERT OR IGNORE INTO moz_up_interests (interest) VALUES(:interest)");
    stmt.params.interest = aInterest;
    stmt.executeAsync(new AsyncPromiseHandler(returnDeferred));
    stmt.finalize();
    return returnDeferred.promise;
  },

  /**
   * Increments the number of visits for an interest for a day
   * @param   aInterest
   *          The interest string
   * @param   {visitTime, visitCount}
   *          An object with the option names as keys
   *          visitTime: Date/time to associate with the visit, defaulting to today
   *          visitCount: The number of counts to add, defaulting to 1
   * @returns Promise for when the interest's visit is added
   */
  addInterestVisit: function(interest, optional={}){
    let {visitTime, visitCount} = optional;
    visitCount = visitCount || 1;

    let deferred = Promise.defer();
    // Increment or initialize the visit count for the interest for the date
    let stmt = this.db.createAsyncStatement(
      "REPLACE INTO moz_up_interests_visits " +
      "SELECT i.id, IFNULL(v.date_added, :dateAdded), IFNULL(v.visit_count, 0) + :visitCount " +
      "FROM moz_up_interests i " +
      "LEFT JOIN moz_up_interests_visits v " +
        "ON v.interest_id = i.id AND v.date_added = :dateAdded " +
      "WHERE i.interest = :interest");
    stmt.params.interest = interest;
    stmt.params.visitCount = visitCount;
    stmt.params.dateAdded = this._getRoundedTime(visitTime);
    stmt.executeAsync({
      handleResult: function (result) {},
      handleCompletion: function (reason) {
        deferred.resolve();
      },
      handleError: function (error) {
        deferred.reject(error);
      }
    });
    stmt.finalize();

    return deferred.promise;
  },

  /**
   * adds interest,host,date tuple to the moz_up_interests_hosts
   * @param   interest
   *          The interest string
   * @param   host
   *          The host string
   * @param   [optional] visitTime
   *          Date/time to associate with the visit defaulting to today
   * @returns Promise for when the row is added
   */
  addInterestForHost: function (aInterest, aHost) {
    let returnDeferred = Promise.defer();
    Cu.reportError(typeof(aInterest));
    Cu.reportError("aInterest: " + aInterest);
    Cu.reportError("aHost: " + aHost);
    let stmt = this.db.createAsyncStatement(
      "INSERT OR IGNORE INTO moz_up_interests_hosts (interest_id, host_id) " +
      "VALUES((SELECT id FROM moz_up_interests WHERE interest =:interest) " +
      ", (SELECT id FROM moz_hosts WHERE host = :host))" );
    stmt.params.host = aHost;
    stmt.params.interest = aInterest;
    stmt.executeAsync(new AsyncPromiseHandler(returnDeferred));
    stmt.finalize();
    return returnDeferred.promise;
  },

  getInterestsForHost: function(aHost) {
    let returnDeferred = Promise.defer();
    let promiseHandler = new AsyncPromiseHandler(returnDeferred, function(row) {
      let interest = row.getResultByName("interest");
      promiseHandler.addToResultSet(interest);
    });

    let stmt = this.db.createAsyncStatement(
      "SELECT interest FROM moz_up_interests i, moz_up_interests_hosts ih, moz_hosts h " +
      "WHERE h.host = :host AND h.id = ih.host_id AND i.id = ih.interest_id");
    stmt.params.host = aHost;
    stmt.executeAsync(promiseHandler);
    stmt.finalize();
    return returnDeferred.promise;
  },

  getHostsForInterest: function (aInterest) {
    let returnDeferred = Promise.defer();
    let promiseHandler = new AsyncPromiseHandler(returnDeferred, function(row) {
      let host = row.getResultByName("host");
      promiseHandler.addToResultSet(host);
    });

    let stmt = this.db.createStatement(
      "SELECT h.host AS host FROM moz_hosts h , moz_up_interests i, moz_up_interests_hosts ih " +
      "WHERE i.interest = :interest AND h.id = ih.host_id AND i.id = ih.interest_id");
    stmt.params.interest = aInterest;
    stmt.executeAsync(promiseHandler);
    stmt.finalize();
    return returnDeferred.promise;
  },

  /**
   * Given a list of interest names, obtains data about those interests, ordered by score
   * This respects the user's ignore list
   * @param     interests
   *            A list of interests to include in the query
   * @return Promise with the interest data
   */
  getInterests: function checkIntersts(interests) {
    let returnDeferred = Promise.defer();
    let sql = "SELECT i.interest, v.visit_count, (:currentTs-v.date_added)/:MS_PER_DAY 'days_ago' " +
              "FROM moz_up_interests i " +
              "JOIN moz_up_interests_visits v ON v.interest_id = i.id " +
              "JOIN moz_up_interests_meta m ON m.interest_id = i.id " +
              "WHERE i.interest IN (" + genSQLParamList(interests.length) + ") " +
              "AND m.ignored_flag = 0 " +
              "AND m.date_updated != 0 " +
              "ORDERY BY v.date_added DESC";
    let stmt = this.db.createStatement(sql);
    stmt.params.MS_PER_DAY = MS_PER_DAY;
    stmt.params.currentTs = currentTs;
    stmt.params.INTEREST_HOST_QUERY_LIMIT = INTEREST_HOST_QUERY_LIMIT;


    return returnDeferred.promise;
  },

  /**
   * Obtains a list of interests that occured 28 days from query time, ordered by score.
   * @param   interestLimit
   *          The number of interests to limit the result by.
   *          A negative value will not limit the results. Defaults to 5
   * @param   filterIgnores [optional]
   *          Optional parameter that sets whether to filter ignored and to-be downloaded interests. Defaults to true.
   * @returns Promise with the interest and counts for each bucket
   */
  getTopInterests: function getTopInterests(interestLimit, filterIgnores=true) {
    let returnDeferred = Promise.defer();
    interestLimit = interestLimit || 5;

    if (typeof interestLimit != 'number' || interestLimit < 1) {
      return returnDeferred.reject("invalid input");
    }

    // Figure out the cutoff time for computation
    let currentTs = this._getRoundedTime();
    let cutOffDay = currentTs - 28 * MS_PER_DAY;

    let sql = "SELECT i.interest, v.visit_count, (:currentTs-v.date_added)/:MS_PER_DAY 'days_ago' " +
              "FROM moz_up_interests i " +
              "JOIN moz_up_interests_visits v ON v.interest_id = i.id ";
    if (filterIgnores) {
      sql += "JOIN moz_up_interests_meta m ON m.interest_id = i.id " +
             "WHERE v.date_added >= :cutOffDay " +
             "AND m.ignored_flag = 0 " +
             "AND m.date_updated != 0 ";
    } else {
      sql += "WHERE v.date_added >= :cutOffDay ";
    }
    sql += "ORDER BY v.date_added DESC";

    let stmt = this.db.createStatement(sql);
    stmt.params.MS_PER_DAY = MS_PER_DAY;
    stmt.params.currentTs = currentTs;
    stmt.params.cutOffDay = cutOffDay;

    let scores = {};
    let topInterests = [];
    let queryDeferred = Promise.defer();

    let promiseHandler = new AsyncPromiseHandler(queryDeferred,function(row) {
      let interest = row.getResultByName("interest");
      let visitCount = row.getResultByName("visit_count");
      let daysAgo = row.getResultByName("days_ago");

      if (!scores.hasOwnProperty(interest)) {
        scores[interest] = 0;
      }

      scores[interest] += visitCount * (1 - (daysAgo/29))
    });
    stmt.executeAsync(promiseHandler);
    stmt.finalize();

    queryDeferred.promise.then(function() {
      // sort scores and cut off
      let interests = Object.keys(scores);
      for (let interestIndex=0; interestIndex < interests.length; interestIndex++) {
        let interest = interests[interestIndex];
        topInterests.push({name: interest, score: scores[interest]});
      }
      scores = null;

      topInterests.sort(function(x, y){return y.score - x.score});
      if (interestLimit > -1) {
        topInterests = topInterests.slice(0, interestLimit);
      }
      returnDeferred.resolve(topInterests);
    });

    return returnDeferred.promise;
  },

  /**
   * Updates the ignore flag for an interest
   * @param     interest
   *            The interest name to update
   * @param     value
   *            Value is either true or false
   */
  updateIgnoreFlagForInterest: function(interest, value) {
    let returnDeferred = Promise.defer();
    let query = "UPDATE moz_up_interests_meta " +
                "SET ignored_flag = :value " +
                "WHERE interest_id = (" +
                "  SELECT id " +
                "  FROM moz_up_interests " +
                "  WHERE interest = :interest" +
                ")";
    let stmt = this.db.createAsyncStatement(query);
    stmt.params.interest = interest;
    stmt.params.value = value;
    stmt.executeAsync(new AsyncPromiseHandler(returnDeferred));
    stmt.finalize();
    return returnDeferred.promise;
  },

  /**
   * Stores metadata for an interest. If the optional parameters are not passed, existing values will be preserved.
   * @param     interestName
   *            Interest name to store data for
   * @param     {threshold, duration, ignored, dateUpdated}
   *            An object with the option names as keys
   *            threshold: The visit count threshold that counts as a positive signal in bucket computation
   *            duration: The length of the 'immediate' and 'recent' periods in bucket computation
   *            ignored: Whether or not to use this interest when computing interest information
   *            dateUpdated: The timestamp in milliseconds of the day this interest was last updated. 0 means it was never updated. by default dateUpdated is today's date timestamp
   * @returns   promise for when the data is set
   */
  setMetaForInterest: function(interestName, optional={}) {
    let returnDeferred = Promise.defer();

    let {threshold, duration, ignored, dateUpdated} = optional;

    threshold = (typeof threshold == 'number') ? threshold : null;
    duration = (typeof duration == 'number') ? duration : null;
    ignored = (typeof ignored == 'boolean') ? ignored : null;
    dateUpdated = (typeof dateUpdated == 'undefined') ? this._getRoundedTime() : dateUpdated;

    let query = "REPLACE INTO moz_up_interests_meta " +
                "SELECT i.id," +
                "  coalesce(:threshold, m.bucket_visit_count_threshold), " +
                "  coalesce(:duration, m.bucket_duration), " +
                "  coalesce(:ignored, m.ignored_flag), " +
                "  coalesce(:dateUpdated, m.date_updated) " +
                "FROM moz_up_interests i " +
                "LEFT JOIN moz_up_interests_meta m " +
                "  ON m.interest_id = i.id " +
                "WHERE i.interest = :interestName";
    let stmt = this.db.createAsyncStatement(query);
    stmt.params.interestName = interestName;
    stmt.params.threshold = threshold;
    stmt.params.duration = duration;
    stmt.params.ignored = ignored;
    stmt.params.dateUpdated = dateUpdated;
    stmt.executeAsync(new AsyncPromiseHandler(returnDeferred));
    stmt.finalize();
    return returnDeferred.promise;
  },

  /**
   * Obtains interest metadata for a list of interests
   * @param interests
            An array of interest names
   * @returns A promise with the interest metadata for each interest
   */
  getMetaForInterests: function(interests) {
    let returnDeferred = Promise.defer();

    if (!Array.isArray(interests)) {
      return deferred.reject(Error("invalid input"));
    }

    let query = "SELECT m.bucket_visit_count_threshold, " +
                "       m.bucket_duration, " +
                "       m.ignored_flag, " +
                "       m.date_updated, " +
                "       i.interest " +
                "FROM moz_up_interests_meta m " +
                "JOIN moz_up_interests i ON m.interest_id = i.id " +
                "WHERE i.interest IN (" + genSQLParamList(interests.length) + ") ";

    let stmt = this.db.createAsyncStatement(query);


    for (let i = 0; i < interests.length; i++) {
      stmt.bindByIndex(i, interests[i]);
    }
    let results = {};

    let queryDeferred = Promise.defer();
    let promiseHandler = new AsyncPromiseHandler(queryDeferred,function(row) {
      results[row.getResultByName('interest')] = {
        threshold: row.getResultByName('bucket_visit_count_threshold'),
        duration: row.getResultByName('bucket_duration'),
        ignored: row.getResultByName('ignored_flag') ? true : false,
        dateUpdated: row.getResultByName('date_updated'),
      }
    });
    stmt.executeAsync(promiseHandler);
    stmt.finalize();

    queryDeferred.promise.then(function(){
      returnDeferred.resolve(results);
    });

    return returnDeferred.promise;
  },

  /**
   * computes buckets data for an interest
   * @param   interest
   *          The interest name string
   * @returns Promise with the interest and counts for each bucket
   */
  getBucketsForInterest: function(interest) {
    let deferred = Promise.defer();

    // Figure out the cutoff times for each bucket
    let currentTs = this._getRoundedTime();
    this.getMetaForInterests([interest]).then(function(metaData) {

      let duration;

      if (Object.keys(metaData).length == 0) {
        // in case no metadata exists for this interests
        duration = DEFAULT_DURATION;
      } else {
        duration = metaData[interest].duration || DEFAULT_DURATION;
      }

      let immediateBucket = currentTs - duration * MS_PER_DAY;
      let recentBucket = currentTs - duration*2 * MS_PER_DAY;

      // Aggregate the visits into each bucket for the interest
      let stmt = PlacesInterestsStorage.db.createAsyncStatement(
        "SELECT CASE WHEN v.date_added > :immediateBucket THEN 'immediate' " +
                    "WHEN v.date_added > :recentBucket THEN 'recent' " +
                    "ELSE 'past' END AS bucket, " +
                    "v.visit_count " +
        "FROM moz_up_interests i " +
        "JOIN moz_up_interests_visits v ON v.interest_id = i.id " +
        "WHERE i.interest = :interest");
      stmt.params.interest = interest;
      stmt.params.immediateBucket = immediateBucket;
      stmt.params.recentBucket = recentBucket;

      // Initialize the result to have something for each bucket
      let result = {
        immediate: 0,
        interest: interest,
        past: 0,
        recent: 0
      };

      let queryDeferred = Promise.defer();
      let promiseHandler = new AsyncPromiseHandler(queryDeferred, function(row) {
        let bucket = row.getResultByName("bucket");
        let visitCount = row.getResultByName("visit_count");
        result[bucket] += visitCount;
      });
      stmt.executeAsync(promiseHandler);
      stmt.finalize();

      queryDeferred.promise.then(function(){
        deferred.resolve(result);
      });
    });

    return deferred.promise;
  },
  /**
   * computes divercity values for interests
   * @param   interests
   *          array of interest name strings
   * @returns Promise with an object keyed on interest name, valued with diversity
   */
  getDiversityForInterests: function(interests) {
    let deferred = Promise.defer();

    // test if input is correct
    if (!Array.isArray(interests)) {
      return deferred.reject(Error("invalid input"));
    }

    // compute total number of hosts
    let totalHosts = 1;
    let hostsQueryDeferred = Promise.defer();
    let stmt = this.db.createAsyncStatement("SELECT COUNT(1) FROM moz_hosts");
    stmt.executeAsync(new AsyncPromiseHandler(hostsQueryDeferred,function(row) {
      totalHosts = row.getResultByIndex(0) || 1;
    }));
    stmt.finalize();

    hostsQueryDeferred.promise.then(function() {
      // create a list of coma separate interst names
      let nameList = "";
      interests.forEach(function(name) {
        nameList +=  ((nameList == "") ? " '" : " ,'") + name + "'";
      });

      let stmt = PlacesInterestsStorage.db.createAsyncStatement(
        "SELECT i.interest interest, ROUND(count(1) * 100.0 / :total, 2) diversity " +
        "FROM moz_up_interests i " +
        "JOIN moz_up_interests_hosts h ON h.interest_id = i.id " +
        "WHERE i.interest in  ( " + nameList + ") " +
        "GROUP BY  i.interest ");
      stmt.params.total = totalHosts;
      let promiseHandler = new AsyncPromiseHandler(deferred,function(row) {
        promiseHandler.addToResultObject(row.getResultByName("interest"),row.getResultByName("diversity"));
      });
      promiseHandler.initResults({});
      stmt.executeAsync(promiseHandler);
      stmt.finalize();
    });

    return deferred.promise;
  },
  /**
   * Clears interests_visits table from N last days worth of days
   * @param   daysAgo
   *          Number of days to be cleaned
   * @returns Promise for when the table will be cleaned up
   */
   clearRecentInterests: function (daysAgo) {
    let returnDeferred = Promise.defer();
    let timeStamp = this._getRoundedTime() - (daysAgo || 300) * MS_PER_DAY;
    let stmt = this.db.createStatement("DELETE FROM moz_up_interests_visits where date_added > :timeStamp");
    stmt.params.timeStamp = timeStamp;
    stmt.executeAsync(new AsyncPromiseHandler(returnDeferred));
    stmt.finalize();
    return returnDeferred.promise;
  },
  /**
   * Clears interests_hosts table
   * @returns Promise for when the table will be cleaned up
   */
   clearInterestsHosts: function () {
    let returnDeferred = Promise.defer();
    let stmt = this.db.createStatement("DELETE FROM moz_up_interests_hosts");
    stmt.executeAsync(new AsyncPromiseHandler(returnDeferred));
    stmt.finalize();
    return returnDeferred.promise;
  },

  /**
   * returns tuples of (place_id,url,title) visisted between now and daysAgo
   * @param   daysAgo
   *          Number of days to be cleaned
   * @param   interestsCallback
   *          a callback handling url,title,visit_date,count tuple
   * @returns Promise for when the tables will be cleaned up
   */
  reprocessRecentHistoryVisits: function (daysAgo,interestsCallback) {
    let returnDeferred = Promise.defer();

    let microSecondsAgo = (this._getRoundedTime() - ((daysAgo || 0) * MS_PER_DAY)) * 1000; // move to microseconds
    let query = "SELECT p.url url, p.title title, v.visit_day_stamp date, v.count count " +
    "FROM (SELECT place_id, visit_date - (visit_date % :MICROS_PER_DAY) visit_day_stamp, count(1) count " +
    "      FROM moz_historyvisits WHERE visit_date > :microSecondsAgo GROUP BY place_id,visit_day_stamp) v " +
    "JOIN moz_places p ON p.id = v.place_id " +
    "WHERE p.hidden = 0 AND p.visit_count > 0 ";
    let stmt = this.db.createStatement(query);
    stmt.params.MICROS_PER_DAY = MS_PER_DAY * 1000;  // move to microseconds
    stmt.params.microSecondsAgo = microSecondsAgo;

    let promiseHandler = new AsyncPromiseHandler(returnDeferred, function(row) {
        interestsCallback({visitDate: (+ row.getResultByName("date")) / 1000 ,  // this has to be in milliseconds
                           visitCount: row.getResultByName("count"),
                           url: row.getResultByName("url"),
                           title: row.getResultByName("title")});
    });
    stmt.executeAsync(promiseHandler);
    stmt.finalize();
    return returnDeferred.promise;
  },

  /**
   * insert a namespace,locale
   * @param   namespace
   * @param   locale
   * @param   lastmodifed timestamp received from the server in milliseconds
   * @returns Promise for when the insrtion happens
   */
  addNamespace: function (namespace,locale,lastModified) {
    let returnDeferred = Promise.defer();

    let stmt = this.db.createAsyncStatement(
      "INSERT OR REPLACE INTO moz_up_interests_namespaces (id,namespace,locale,lastModified) " +
      "VALUES((SELECT id FROM moz_up_interests_namespaces WHERE namespace = :namespace AND locale = :locale), " +
      ":namespace,:locale,:lastModified)");
    stmt.params.namespace = namespace;
    stmt.params.locale = locale;
    stmt.params.namespace = namespace;
    stmt.params.lastModified = lastModified || 0;
    stmt.executeAsync(new AsyncPromiseHandler(returnDeferred));
    stmt.finalize();
    return returnDeferred.promise;
  },

  /**
   * selects id,namespace,locale,lastModifed from the table
   * @returns Promise for completion and results are tuple array
   */
  getNamespaces: function () {
    let returnDeferred = Promise.defer();

    let promiseHandler = new AsyncPromiseHandler(returnDeferred,function(row) {
      promiseHandler.addToResultSet({id: row.getResultByName("id"),
                                     namespace: row.getResultByName("namespace"),
                                     locale: row.getResultByName("locale"),
                                     lastModified: row.getResultByName("lastModified")
                                    });
    });
    promiseHandler.initResults([]);
    let stmt = this.db.createAsyncStatement("SELECT id,namespace,locale,lastModified FROM moz_up_interests_namespaces");
    stmt.executeAsync(promiseHandler);
    stmt.finalize();
    return returnDeferred.promise;
  },

  /**
   * insert ifr for an interest+namespace+locale
   * @param   interest
   * @param   namespace
   * @param   locale
   * @param   ifr_data
   * @param   date_updated timestamp defaulted to now (in miliseconds)
   * @returns Promise for when the insrtion happens
   */
   // TODO put interest behind locale
  addInterestIFR: function (interest,namespace,locale,date_updated,ifr_data,server_id) {
    let returnDeferred = Promise.defer();

    let stmt = this.db.createAsyncStatement(
      "INSERT OR REPLACE INTO moz_up_interests_ifr (interest_id,namespace_id,ifr_data,date_updated,server_id) " +
      "VALUES((SELECT id FROM moz_up_interests WHERE interest = :interest) "  +
      "       ,(SELECT id FROM moz_up_interests_namespaces WHERE namespace = :namespace AND locale = :locale) " +
      "       ,:ifr_data,:date_updated,:server_id)");
    stmt.params.interest = interest;
    stmt.params.namespace = namespace;
    stmt.params.locale = locale;
    stmt.params.ifr_data = JSON.stringify(ifr_data);
    stmt.params.date_updated = date_updated || Date.now();
    stmt.params.server_id = server_id;
    stmt.executeAsync(new AsyncPromiseHandler(returnDeferred));
    stmt.finalize();
    return returnDeferred.promise;
  },

  /**
   * deletes  (namespace,locale,interest)
   * @param   namespace
   * @param   locale
   * @param   interest
   * @returns Promise for the deletion
   */
  deleteInterestIFR: function (namespace,locale,interest) {
    let returnDeferred = Promise.defer();
    let stmt = this.db.createAsyncStatement(
      "DELETE FROM moz_up_interests_ifr WHERE " +
      "namespace_id = (SELECT id FROM moz_up_interests_namespaces WHERE namespace = :namespace AND locale = :locale) AND " +
      "interest_id = (SELECT id FROM moz_up_interests WHERE interest = :interest)");
    stmt.params.interest = interest;
    stmt.params.namespace = namespace;
    stmt.params.locale = locale;
    stmt.executeAsync(new AsyncPromiseHandler(returnDeferred));
    stmt.finalize();
    return returnDeferred.promise;
  },

  /**
   * clears namespace and and ifr tables for (namespace,locale) pair
   * @param   namespace
   * @param   locale
   * @returns Promise for the deletion
   */
  clearNamespace: function (namespace,locale) {
    let returnDeferred = Promise.defer();
    let deferred = Promise.defer();
    let stmt = this.db.createAsyncStatement(
      "DELETE FROM moz_up_interests_ifr WHERE " +
      "namespace_id = (SELECT id FROM moz_up_interests_namespaces WHERE namespace = :namespace AND locale = :locale)");
    stmt.params.namespace = namespace;
    stmt.params.locale = locale;
    stmt.executeAsync(new AsyncPromiseHandler(deferred));
    stmt.finalize();
    deferred.promise.then(() => {
      let stmt = this.db.createAsyncStatement("DELETE FROM moz_up_interests_namespaces WHERE namespace = :namespace AND locale = :locale");
      stmt.params.namespace = namespace;
      stmt.params.locale = locale;
      stmt.executeAsync(new AsyncPromiseHandler(returnDeferred));
      stmt.finalize();
    });
    return returnDeferred.promise;
  },

  /**
   * clears everything
   * @returns Promise for the uberkill
   */
  clearNamespaces: function() {
    // elete everything
    let returnDeferred = Promise.defer();
    let promises = [];
    let deferred = Promise.defer();
    let stmt = this.db.createAsyncStatement("DELETE FROM moz_up_interests_ifr");
    stmt.executeAsync(new AsyncPromiseHandler(deferred));
    stmt.finalize();
    promises.push(deferred.promise);

    deferred = Promise.defer();
    stmt = this.db.createAsyncStatement("DELETE FROM moz_up_interests_namespaces");
    stmt.executeAsync(new AsyncPromiseHandler(deferred));
    stmt.finalize();
    promises.push(deferred.promise);

    deferred = Promise.defer();
    stmt = this.db.createAsyncStatement("DELETE FROM moz_up_interests_hosts");
    stmt.executeAsync(new AsyncPromiseHandler(deferred));
    stmt.finalize();
    promises.push(deferred.promise);

    deferred = Promise.defer();
    stmt = this.db.createAsyncStatement("DELETE FROM moz_up_interests_visits");
    stmt.executeAsync(new AsyncPromiseHandler(deferred));
    stmt.finalize();
    promises.push(deferred.promise);

    deferred = Promise.defer();
    stmt = this.db.createAsyncStatement("DELETE FROM moz_up_interests");
    stmt.executeAsync(new AsyncPromiseHandler(deferred));
    stmt.finalize();
    promises.push(deferred.promise);

    deferred = Promise.defer();
    stmt = this.db.createAsyncStatement("DELETE FROM moz_up_interests_meta");
    stmt.executeAsync(new AsyncPromiseHandler(deferred));
    stmt.finalize();
    promises.push(deferred.promise);
    Promise.promised(Array)(promises).then(() => returnDeferred.resolve(),
                                           error => returnDeferred.reject(new Error(error)));
    return returnDeferred.promise;
  },

  /**
   * returns full IFR enchilada for all namesapces
   * @returns Promise for the big select
   */
  getAllIFRs: function() {
    // elete everything
    let returnDeferred = Promise.defer();
    let promiseHandler = new AsyncPromiseHandler(returnDeferred,function(row) {
      promiseHandler.addToResultSet({ namespace: row.getResultByName("namespace"),
                                     locale: row.getResultByName("locale"),
                                     interest: row.getResultByName("interest"),
                                     date_updated: row.getResultByName("date_updated"),
                                     ifr: JSON.parse(row.getResultByName("ifr_data")),
                                     server_id: row.getResultByName("server_id")
                                    });
    });
    promiseHandler.initResults([]);
    let stmt = this.db.createAsyncStatement(
      "SELECT namespace,locale,interest,date_updated,ifr_data,server_id " +
      "FROM moz_up_interests_ifr, moz_up_interests_namespaces, moz_up_interests " +
      "WHERE namespace_id = moz_up_interests_namespaces.id AND interest_id = moz_up_interests.id");
    stmt.executeAsync(promiseHandler);
    stmt.finalize();
    return returnDeferred.promise;
  }

}

XPCOMUtils.defineLazyGetter(PlacesInterestsStorage, "db", function() {
  return PlacesUtils.history.QueryInterface(Ci.nsPIPlacesDatabase).DBConnection;
});
