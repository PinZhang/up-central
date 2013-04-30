/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = [
  "PlacesInterestsStorage",
];

const {classes: Cc, interfaces: Ci, results: Cr, utils: Cu} = Components;

Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PlacesUtils", "resource://gre/modules/PlacesUtils.jsm");

const MS_PER_DAY = 86400000;

/**
 * Store the SQL statements used for this file together for easy reference
 */
const SQL = {
  addInterestHost:
    "INSERT OR IGNORE INTO moz_interests_hosts (interest_id, host_id) " +
    "VALUES((SELECT id " +
            "FROM moz_interests " +
            "WHERE interest = :interest), " +
           "(SELECT id " +
            "FROM (SELECT id, host " +
                  "FROM moz_hosts " +
                  "ORDER BY frecency DESC " +
                  "LIMIT 200) " +
            "WHERE host = :host))",

  addInterestVisit:
    "REPLACE INTO moz_interests_visits " +
    "SELECT id, " +
           "IFNULL(day, :day), " +
           "IFNULL(visits, 0) + IFNULL(:visits, 1) " +
    "FROM moz_interests " +
    "LEFT JOIN moz_interests_visits " +
    "ON interest_id = id AND " +
       "day = :day " +
    "WHERE interest = :interest",

  clearRecentVisits:
    "DELETE FROM moz_interests_visits " +
    "WHERE day > :dayCutoff",

  getBucketsForInterests:
    "SELECT interest, " +
           "SUM(CASE WHEN day > :today - duration THEN visits " +
                    "ELSE 0 END) * " +
             "(NOT IFNULL(:checkSharable, 0) OR sharable) immediate, " +
           "SUM(CASE WHEN day > :today - duration * 2 AND " +
                         "day <= :today - duration THEN visits " +
                    "ELSE 0 END) * " +
             "(NOT IFNULL(:checkSharable, 0) OR sharable) recent, " +
           "SUM(CASE WHEN day <= :today - duration * 2 THEN visits " +
                    "ELSE 0 END) * " +
             "(NOT IFNULL(:checkSharable, 0) OR sharable) past " +
    "FROM moz_interests " +
    "LEFT JOIN moz_interests_visits " +
    "ON interest_id = id " +
    "WHERE interest IN (:interests) " +
    "GROUP BY id",

  getDiversityForInterests:
    "SELECT interest, " +
           "COUNT(interest_id) * 100.0 / " +
             "(SELECT COUNT(DISTINCT host_id) " +
              "FROM moz_interests_hosts) * " +
             "(NOT IFNULL(:checkSharable, 0) OR sharable) diversity " +
    "FROM moz_interests " +
    "LEFT JOIN moz_interests_hosts " +
    "ON interest_id = id " +
    "WHERE interest IN (:interests) " +
    "GROUP BY id",

  getInterests:
    "SELECT * " +
    "FROM moz_interests " +
    "WHERE interest IN (:interests)",

  getRecentHistory:
    "SELECT title, url, visitCount, visitDate " +
    "FROM moz_places " +
    "JOIN (SELECT place_id, " +
                 "COUNT(1) visitCount, " +
                 "visit_date/1000 - visit_date/1000 % :MS_PER_DAY visitDate " +
          "FROM moz_historyvisits " +
          "WHERE visit_date >= (:dayCutoff+1) * :MS_PER_DAY*1000 " +
          "GROUP BY place_id, visitDate) " +
    "ON place_id = id " +
    "WHERE hidden = 0 AND " +
          "visit_count > 0",

  getScoresForInterests:
    "SELECT interest name, " +
           "IFNULL(SUM(visits * (1 - (:today - day) / 29.0)), 0) * " +
             "(NOT IFNULL(:checkSharable, 0) OR sharable) score " +
    "FROM moz_interests " +
    "LEFT JOIN moz_interests_visits " +
    "ON interest_id = id AND " +
       "day >= :today - 28 " +
    "WHERE interest IN (:interests) " +
    "GROUP BY id " +
    "ORDER BY score DESC",

  getScoresForNamespace:
    "SELECT interest name, " +
           "IFNULL(SUM(visits * (1 - (:today - day) / 29.0)), 0) * " +
             "(NOT IFNULL(:checkSharable, 0) OR sharable) score " +
    "FROM moz_interests " +
    "LEFT JOIN moz_interests_visits " +
    "ON interest_id = id AND " +
       "day >= :today - 28 " +
    "WHERE namespace = :namespace " +
    "GROUP BY id " +
    "ORDER BY score DESC " +
    "LIMIT IFNULL(:interestLimit, 5)",

  setInterest:
    "REPLACE INTO moz_interests " +
    "VALUES((SELECT id " +
            "FROM moz_interests " +
            "WHERE interest = :interest), " +
           ":interest, " +
           ":namespace, " +
           "IFNULL(:duration, " +
                  "(SELECT duration " +
                   "FROM moz_interests " +
                   "WHERE interest = :interest)), " +
           "IFNULL(:threshold, " +
                  "(SELECT threshold " +
                   "FROM moz_interests " +
                   "WHERE interest = :interest)), " +
           "IFNULL(:sharable, " +
                  "(SELECT sharable " +
                   "FROM moz_interests " +
                   "WHERE interest = :interest)))",
  addNamespace:
      "INSERT OR REPLACE INTO moz_up_interests_namespaces " +
      "(id,namespace,locale,lastModified) " +
      "VALUES((SELECT id " +
              "FROM moz_up_interests_namespaces " + 
              "WHERE namespace = :namespace AND " +
                    "locale = :locale), " +
             ":namespace, " +
             ":locale, " +
             ":lastModified)",

  getNamespaces:
      "SELECT id,namespace,locale,lastModified " +
      "FROM moz_up_interests_namespaces",

  addInterestIFR:
      "INSERT OR REPLACE INTO moz_up_interests_ifr " +
      "(interest_id,namespace_id,ifr_data,date_updated,server_id) " +
      "VALUES((SELECT id " +
               "FROM moz_interests " +
               "WHERE interest = :interest), "  +
             "(SELECT id " +
               "FROM moz_up_interests_namespaces " + 
               "WHERE namespace = :namespace AND " +
               "locale = :locale)," +
             ":ifrData," +
             ":dateUpdated," +
             ":serverId)",

  deleteInterestIFR:
      "DELETE FROM moz_up_interests_ifr " +
      "WHERE namespace_id = " + 
              "(SELECT id " +
               "FROM moz_up_interests_namespaces " + 
               "WHERE namespace = :namespace AND " +
                     "locale = :locale) AND " +
            "interest_id = " +
              "(SELECT id " +
               "FROM moz_interests " +
               "WHERE interest = :interest)",

  clearNamespace:
      "DELETE FROM moz_up_interests_ifr " +
      "WHERE namespace_id = " +
              "(SELECT id " +
               "FROM moz_up_interests_namespaces " +
               "WHERE namespace = :namespace AND " +
                     "locale = :locale)",

  getAllIFRs:
      "SELECT moz_up_interests_namespaces.namespace, " +
             "locale, " + 
             "interest, " +
             "date_updated as dateUpdated, " +
             "ifr_data as ifr, " +
             "server_id as serverId " +
      "FROM moz_up_interests_ifr, moz_up_interests_namespaces, moz_interests " +
      "WHERE namespace_id = moz_up_interests_namespaces.id AND " +
            "interest_id = moz_interests.id" ,

  updateOutdatedInterests:
      "UPDATE moz_up_interests_ifr " + 
      "SET date_updated = :lastModified " +
      "WHERE date_updated < :lastModified AND " +
            "namespace_id = (SELECT id " +
                            "FROM moz_up_interests_namespaces " +
                            "WHERE namespace = :namespace AND " +
                            "locale = :locale)",

  deleteOutdatedInterests:
      "DELETE FROM moz_up_interests_ifr " +
      "WHERE date_updated < :lastModified AND " +
            "namespace_id = (SELECT id " +
                            "FROM moz_up_interests_namespaces " +
                            "WHERE namespace = :namespace AND " +
                                  "locale = :locale)"
};

let PlacesInterestsStorage = {
  //////////////////////////////////////////////////////////////////////////////
  //// PlacesInterestsStorage

  /**
   * Record the pair of interest and host
   *
   * @param   interest
   *          The full interest string with namespace
   * @param   host
   *          The host string to associate with the interest
   * @returns Promise for when the row is added
   */
  addInterestHost: function PIS_addInterestHost(interest, host) {
    return this._execute(SQL.addInterestHost, {
      params: {
        host: host,
        interest: interest,
      },
    });
  },

  /**
   * Increment or initialize the number of visits for an interest on a day
   *
   * @param   interest
   *          The full interest string with namespace
   * @param   [optional] visitData {see below}
   *          visitCount: Number of visits to add defaulting to 1
   *          visitTime: Date/time to associate with the visit defaulting to now
   * @returns Promise for when the row is added/updated
   */
  addInterestVisit: function PIS_addInterestVisit(interest, visitData={}) {
    let {visitCount, visitTime} = visitData;
    return this._execute(SQL.addInterestVisit, {
      params: {
        day: this._convertDateToDays(visitTime),
        interest: interest,
        visits: visitCount,
      },
    });
  },

  /**
   * Clear recent visits for all interests
   *
   * @param   daysAgo
   *          Number of recent days to be cleared
   * @returns Promise for when the visits are deleted
   */
  clearRecentVisits: function PIS_clearRecentVisits(daysAgo) {
    return this._execute(SQL.clearRecentVisits, {
      params: {
        dayCutoff: this._convertDateToDays() - daysAgo,
      },
    });
  },

  /**
   * Generate buckets data for interests
   *
   * @param   interests
   *          Array of interest strings
   * @param   [optional] options {see below}
   *          checkSharable: Boolean for 0-buckets for unshared defaulting false
   * @returns Promise with each interest as keys on an object with bucket data
   */
  getBucketsForInterests: function PIS_getBucketsForInterests(interests, options={}) {
    let {checkSharable} = options;
    return this._execute(SQL.getBucketsForInterests, {
      columns: ["immediate", "recent", "past"],
      key: "interest",
      listParams: {
        interests: interests,
      },
      params: {
        checkSharable: checkSharable,
        today: this._convertDateToDays(),
      },
    });
  },

  /**
   * Compute diversity values for interests
   *
   * @param   interests
   *          Array of interest strings
   * @param   [optional] options {see below}
   *          checkSharable: Boolean for 0-diversity for unshared defaulting false
   * @returns Promise with each interest as keys on an object with diversity
   */
  getDiversityForInterests: function PIS_getDiversityForInterests(interests, options={}) {
    let {checkSharable} = options;
    return this._execute(SQL.getDiversityForInterests, {
      columns: ["diversity"],
      key: "interest",
      listParams: {
        interests: interests,
      },
      params: {
        checkSharable: checkSharable,
      },
    });
  },

  /**
   * Obtains interest metadata for a list of interests
   * @param   interests
              An array of interest names
   * @returns A promise with the interest metadata for each interest
   */
  getInterests: function PIS_getInterests(interests) {
    return this._execute(SQL.getInterests, {
      columns: ["duration", "sharable", "threshold"],
      key: "interest",
      listParams: {
        interests: interests,
      },
    });
  },

  /**
   * Fetch recent history visits to process by page and day of visit
   *
   * @param   daysAgo
   *          Number of days of recent history to fetch
   * @param   handlePageForDay
   *          Callback handling a day's visits for a page
   * @returns Promise for when all the recent pages have been processed
   */
  getRecentHistory: function PIS_getRecentHistory(daysAgo, handlePageForDay) {
    return this._execute(SQL.getRecentHistory, {
      columns: ["title", "url", "visitCount", "visitDate"],
      onRow: handlePageForDay,
      params: {
        dayCutoff: this._convertDateToDays() - daysAgo,
        MS_PER_DAY: MS_PER_DAY,
      },
    });
  },

  /**
   * Get a sorted array of interests by score
   *
   * @param   interests
   *          Array of interest strings to select
   * @param   [optional] options {see below}
   *          checkSharable: Boolean for 0-score for unshared defaulting false
   * @returns Promise with the array of interest names and scores
   */
  getScoresForInterests: function PIS_getScoresForInterests(interests, options={}) {
    let {checkSharable} = options;
    return this._execute(SQL.getScoresForInterests, {
      columns: ["name", "score"],
      listParams: {
        interests: interests,
      },
      params: {
        checkSharable: checkSharable,
        today: this._convertDateToDays(),
      },
    });
  },

  /**
   * Get a sorted array of top interests for a namespace by score
   *
   * @param   namespace
   *          Namespace string of interests in the namespace to select
   * @param   [optional] options {see below}
   *          checkSharable: Boolean for 0-score for unshared defaulting false
   *          interestLimit: Number of top interests to select defaulting to 5
   * @returns Promise with the array of interest names and scores
   */
  getScoresForNamespace: function PIS_getScoresForNamespace(namespace, options={}) {
    let {checkSharable, interestLimit} = options;
    return this._execute(SQL.getScoresForNamespace, {
      columns: ["name", "score"],
      params: {
        checkSharable: checkSharable,
        interestLimit: interestLimit,
        namespace: namespace,
        today: this._convertDateToDays(),
      },
    });
  },

  /**
   * Set (insert or update) metadata for an interest
   *
   * @param   interest
   *          Full interest name with namespace to set
   * @param   [optional] metadata {see below}
   *          duration: Number of days of visits to include in buckets
   *          sharable: Boolean user preference if the interest can be shared
   *          threshold: Number of visits in a bucket to signal recency interest
   * @returns Promise for when the interest data is set
   */
  setInterest: function PIS_setInterest(interest, metadata={}) {
    let {duration, sharable, threshold} = metadata;
    return this._execute(SQL.setInterest, {
      params: {
        duration: duration,
        interest: interest,
        namespace: this._splitInterestName(interest)[0],
        sharable: sharable,
        threshold: threshold,
      },
    });
  },

  /**
   * insert a namespace,locale
   * @param   namespace
   * @param   locale
   * @param   lastmodifed timestamp received from the server in milliseconds
   * @returns Promise for when the insrtion happens
   */
  addNamespace: function (namespace,locale,lastModified) {
    return this._execute(SQL.addNamespace, {
      params: {
        namespace: namespace,
        locale: locale,
        lastModified: lastModified || 0
      },
    });
  },

  /**
   * selects id,namespace,locale,lastModifed from the table
   * @returns Promise for completion and results are tuple array
   */
  getNamespaces: function () {
    return this._execute(SQL.getNamespaces, {
      columns: ["id","namespace","locale","lastModified"]
    });
  },

  /**
   * insert ifr for an interest+namespace+locale
   * @param   interest
   * @param   namespace
   * @param   locale
   * @param   ifrData
   * @param   dateUpdated timestamp defaulted to now (in miliseconds)
   * @returns Promise for when the insrtion happens
   */
   // TODO put interest behind locale
  addInterestIFR: function (interest,namespace,locale,dateUpdated,ifrData,serverId) {
    return this._execute(SQL.addInterestIFR, {
      params: {
        interest: interest,
        namespace: namespace,
        locale: locale,
        ifrData: JSON.stringify(ifrData),
        dateUpdated: dateUpdated || Date.now(),
        serverId: serverId || 0
      }
    });
  },

  /**
   * deletes  (namespace,locale,interest)
   * @param   namespace
   * @param   locale
   * @param   interest
   * @returns Promise for the deletion
   */
  deleteInterestIFR: function (namespace,locale,interest) {
    return this._execute(SQL.deleteInterestIFR, {
      params: {
        interest: interest,
        namespace: namespace,
        locale: locale
      }
    });
  },

  /**
   * clears namespace and and ifr tables for (namespace,locale) pair
   * @param   namespace
   * @param   locale
   * @returns Promise for the deletion
   */
  clearNamespace: function (namespace,locale) {
    return this._execute(SQL.clearNamespace, {
      params: {
        namespace: namespace,
        locale: locale
      }
    });
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
    promises.push(this._execute("DELETE FROM moz_up_interests_ifr"));
    promises.push(this._execute("DELETE FROM moz_up_interests_namespaces"));
    promises.push(this._execute("DELETE FROM moz_interests_hosts"));
    promises.push(this._execute("DELETE FROM moz_interests_visits"));
    promises.push(this._execute("DELETE FROM moz_interests"));
  },

  /**
   * returns full IFR enchilada for all namesapces
   * @returns Promise for the big select
   */
  getAllIFRs: function() {
    // elete everything
    return this._execute(SQL.getAllIFRs, {
      columns: ["namespace","locale","interest","dateUpdated","ifr","serverId"]
    }).then(results => {
      // walk through results array and parse IFR back into object
      results.forEach(item => {
        item.ifr = item.ifr ? JSON.parse(item.ifr) : "";
      });
      return results;
    });
  },

  /**
   * updates all namesapce rules timestamp
   * @param   namespace
   * @param   locale
   * @param   lastmodifed timestamp received from the server in milliseconds
   * @returns Promise for when the update complets
   */
  updateOutdatedInterests: function (namespace,locale,lastModified) {
    return this._execute(SQL.updateOutdatedInterests, {
      params: {
        namespace: namespace,
        locale: locale,
        lastModified: lastModified
      }
    });
  },

  /**
   * deletes all namesapce rules with outdated timestamp
   * @param   namespace
   * @param   locale
   * @param   lastmodifed timestamp received from the server in milliseconds
   * @returns Promise for when the uber kill complets
   */
  deleteOutdatedInterests: function (namespace,locale,lastModified) {
    return this._execute(SQL.deleteOutdatedInterests, {
      params: {
        namespace: namespace,
        locale: locale,
        lastModified: lastModified
      }
    });
  },

  //////////////////////////////////////////////////////////////////////////////
  //// PlacesInterestsStorage Helpers

  /**
   * Convert a date to days since epoch
   *
   * @param   [optional] time
   *          Reference date/time defaulting to today
   * @returns Number of days since epoch to beginning of today UTC
   */
  _convertDateToDays: function PIS__convertDateToDays(time=null) {
    // Default to today and truncate to an integer number of days
    return Math.floor((time || Date.now()) / MS_PER_DAY);
  },

  /**
   * Execute a SQL statement with various options
   *
   * @param   sql
   *          The SQL statement to execute
   * @param   [optional] optional {see below}
   *          columns: Array of column strings to read for array format result
   *          key: Additional column string to trigger object format result
   *          listParams: Object to expand the key to a SQL list
   *          onRow: Function callback given the columns for each row
   *          params: Object of keys matching SQL :param to bind values
   * @returns Promise for when the statement completes with value dependant on
   *          the optional values passed in.
   */
  _execute: function PIS__execute(sql, optional={}) {
    let {columns, key, listParams, onRow, params} = optional;

    // Convert listParams into params and the desired number of identifiers
    if (listParams != null) {
      params = params || {};
      Object.keys(listParams).forEach(listName => {
        let listIdentifiers = [];
        for (let i = 0; i < listParams[listName].length; i++) {
          let paramName = listName + i;
          params[paramName] = listParams[listName][i];
          listIdentifiers.push(":" + paramName);
        }

        // Replace the list placeholders with comma-separated identifiers
        sql = sql.replace(":" + listName, listIdentifiers, "g");
      });
    }

    // Initialize the statement cache and the callback to clean it up
    if (this._cachedStatements == null) {
      this._cachedStatements = {};
      PlacesUtils.registerShutdownFunction(() => {
        Object.keys(this._cachedStatements).forEach(key => {
          this._cachedStatements[key].finalize();
        });
      });
    }

    // Use a cached version of the statement if handy; otherwise created it
    let statement = this._cachedStatements[sql];
    if (statement == null) {
      statement = this._db.createAsyncStatement(sql);
      this._cachedStatements[sql] = statement;
    }

    // Bind params if we have any
    if (params != null) {
      Object.keys(params).forEach(param => {
        statement.bindByName(param, params[param]);
      });
    }

    // Determine the type of result as nothing, a keyed object or array of columns
    let results;
    if (onRow != null) {}
    else if (key != null) {
      results = {};
    }
    else if (columns != null) {
      results = [];
    }

    // Execute the statement and update the promise accordingly
    let deferred = Promise.defer();
    statement.executeAsync({
      handleCompletion: reason => {
        deferred.resolve(results);
      },

      handleError: error => {
        deferred.reject(new Error(error.message));
      },

      handleResult: resultSet => {
        let row;
        while (row = resultSet.getNextRow()) {
          // Read out the desired columns from the row into an object
          let result;
          if (columns != null) {
            // For just a single column, make the result that column
            if (columns.length == 1) {
              result = row.getResultByName(columns[0]);
            }
            // For multiple columns, put as valyes on an object
            else {
              result = {};
              columns.forEach(column => {
                result[column] = row.getResultByName(column);
              });
            }
          }

          // Give the packaged result to the handler
          if (onRow != null) {
            onRow(result);
          }
          // Store the result keyed on the result key
          else if (key != null) {
            results[row.getResultByName(key)] = result;
          }
          // Append the result in order
          else if (columns != null) {
            results.push(result);
          }
        }
      }
    });

    return deferred.promise;
  },

  /**
   * Extract the namespace from a fully-qualified interest name
   *
   * @param   interest
   *          Interest string in the namespace/name format
   * @returns [Namespace or empty string, interest name]
   */
  _splitInterestName: function PIS__splitInterestName(interest) {
    let tokens = interest.split(":", 2);

    // Add an empty namespace if there was no ":"
    if (tokens.length < 2) {
      tokens.unshift("");
    }

    return tokens;
  }
}

XPCOMUtils.defineLazyGetter(PlacesInterestsStorage, "_db", function() {
  return PlacesUtils.history.QueryInterface(Ci.nsPIPlacesDatabase).DBConnection;
});
