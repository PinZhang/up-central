/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");
Cu.import("resource://testing-common/httpd.js");

// Import common head.
let (commonFile = do_get_file("../head_common.js", false)) {
  let uri = Services.io.newFileURI(commonFile);
  Services.scriptloader.loadSubScript(uri.spec, this);
}

// Put any other stuff relative to this test folder below.

const kValidMessages = {
  "bootstrapComplete": true,
  "swapRulesComplete": true,
  "InterestsForDocumentRules": true,
  "InterestsForDocumentText": true,
  "InterestsForDocument": true
}
Services.prefs.setBoolPref("interests.enabled", true);

const MS_PER_DAY = 86400000;
const MICROS_PER_DAY = 86400000000;

// Wrapper around setInterest that puts in some default duration and threshold
const DEFAULT_DURATION = 14;
const DEFAULT_THRESHOLD = 5;
function addInterest(interest) {
  return PlacesInterestsStorage.setInterest(interest, {
    duration: DEFAULT_DURATION,
    threshold: DEFAULT_THRESHOLD,
  });
}

function clearInterestsHosts() {
  return PlacesInterestsStorage._execute(
    "DELETE FROM moz_interests_hosts"
  );
}

function getHostsForInterest(interest) {
  return PlacesInterestsStorage._execute(
    "SELECT h.host AS host FROM moz_hosts h, moz_interests i, moz_interests_hosts ih " +
    "WHERE i.interest = :interest AND h.id = ih.host_id AND i.id = ih.interest_id", {
    columns: ["host"],
    params: {
      interest: interest,
    },
  });
}

function getInterestsForHost(host) {
  return PlacesInterestsStorage._execute(
    "SELECT interest FROM moz_interests i, moz_interests_hosts ih, moz_hosts h " +
    "WHERE h.host = :host AND h.id = ih.host_id AND i.id = ih.interest_id", {
    columns: ["interest"],
    params: {
      host: host,
    },
  });
}

function promiseClearHistoryAndVisits() {
  let promises = [];
  promises.push(PlacesInterestsStorage._execute("DELETE FROM moz_interests"));
  promises.push(PlacesInterestsStorage._execute("DELETE FROM moz_interests_hosts"));
  promises.push(PlacesInterestsStorage._execute("DELETE FROM moz_interests_visits"));
  promises.push(promiseClearHistory());
  return Promise.promised(Array)(promises).then();
}

function promiseAddMultipleUrlInterestsVisits(aVisitInfo) {
  let visits = [];
  if (Array.isArray(aVisitInfo)) {
    visits = visits.concat(aVisitInfo);
  } else {
    visits.push(aVisitInfo)
  }

  let visitPromises = [];
  let now = Date.now();
  visits.forEach(function(visit) {
    let uri = NetUtil.newURI(visit.url);
    visitPromises.push(promiseAddVisits(uri));

    let host = uri.host.replace(/^www\./, "");
    let visitTime = now - MS_PER_DAY*(visit.daysAgo || 0);
    let visitCount = visit.count || 1;
    let interests = (Array.isArray(visit.interests)) ? visit.interests : [visit.interests];

    interests.forEach(function(interest) {
      visitPromises.push(addInterest(interest));
      visitPromises.push(PlacesInterestsStorage.addInterestVisit(interest, {visitTime: visitTime, visitCount: visitCount}));
      visitPromises.push(PlacesInterestsStorage.addInterestHost(interest, host));
    });
  });

  return Promise.promised(Array)(visitPromises).then();
}

function promiseAddUrlInterestsVisit(url,interests,count,daysAgo) {
  return promiseAddMultipleUrlInterestsVisits(
    { url: url,
      interests: interests,
      count: count || 1,
      daysAgo: daysAgo || 0
    });
}

function promiseAddInterestVisits(interest,count,daysAgo) {
  let visitPromises = [];
  let now = Date.now();
  visitPromises.push(addInterest(interest));
  visitPromises.push(PlacesInterestsStorage.addInterestVisit(interest, {visitTime: now - MS_PER_DAY*(daysAgo || 0), visitCount: count || 1}));
  return Promise.promised(Array)(visitPromises).then();
}

function addInterestVisitsToSite(site,interest,count) {
  let promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(promiseAddUrlInterestsVisit(site,interest));
  }
  return Promise.promised(Array)(promises).then();
}

function itemsHave(items,data) {
  for (let i in items) {
    if(items[i] == data) return true;
  }
  return false;
}

const HTTP_SERVER_PORT = 4444;
const HTTP_BASE = "http://localhost:" + HTTP_SERVER_PORT;
const MOZILLA_GENERAL_LAST_MODIFIED = "Tue, 15 Nov 1994 12:45:26 GMT";

let gHttpServer = new HttpServer();

function startHttpServer() {
  gHttpServer.start(HTTP_SERVER_PORT);
}

function stopHttpServer() {
  // Stop the HTTP server.  this should be the last task registered
  let deferred = Promise.defer();
  gHttpServer.stop(deferred.resolve);
  return deferred.promise;
}

function createPathHandler(path, ctype, callback) {
  gHttpServer.registerPathHandler(path, function(request, response) {
    response.setStatusLine( "1.1" , 200 , "OK" );
    response.setHeader("Content-Type", ctype , false);
    callback(request, response);
  });
}

function createJSONPathHandler(path, callback) {
  return createPathHandler(path,"application/json",callback);
}

function createJSONStringHandler(path,stringGenerator) {
  return createJSONPathHandler(path,function(request, response) {
    let content = (typeof stringGenerator == "function") ? stringGenerator(request, response) : stringGenerator;
    response.write(content);
  });
};

function createReadJSONFileHandler(path,fileName) {
  return createJSONStringHandler(path,readFileText(fileName));
}

function setUpInterestAPIHandlers(path) {
  createJSONPathHandler("/api/v0/rules/en/mozilla_general",function(request , response) {
    response.setStatusLine( "1.1" , 200 , "OK");
    response.setHeader("Last-Modified", MOZILLA_GENERAL_LAST_MODIFIED);
    response.write(readFileText("mozilla_general.js"));
 });
}

function duplicateObject(object) {
  return JSON.parse(JSON.stringify(object));
}

function dumpObject(object,pointer) {
  let pointer = pointer || " <--------\n";
  dump(JSON.stringify(object) + pointer);
}

function isIdentical(expected, actual) {
  if (expected == null) {
    do_check_eq(expected, actual);
  }
  else if (typeof expected == "object") {
    // Make sure all the keys match up
    do_check_eq(Object.keys(expected).sort() + "", Object.keys(actual).sort());

    // Recursively check each value individually
    Object.keys(expected).forEach(key => {
      dump("Checking key " + key);
      isIdentical(actual[key], expected[key]);
    });
  }
  else {
    do_check_eq(expected, actual);
  }
}

function checkScores(expected, expectedZeros, interests) {
  let withScores = interests.slice(0, expected.length);
  isIdentical(expected, withScores);

  let zeroScores = interests.slice(expected.length);
  zeroScores.forEach(({name, score}) => {
    LOG("Checking 0 score for " + name);
    do_check_eq(score, 0);
  });
  do_check_eq(zeroScores.length, expectedZeros);
}

function unExposeAll(obj) {
  // Filter for Objects and Arrays.
  if (typeof obj !== "object" || !obj)
    return;

  // Recursively unexpose our children.
  Object.keys(obj).forEach(function(key) {
    unExposeAll(obj[key]);
  });

  if (obj instanceof Array)
    return;
  delete obj.__exposedProps__;
}

function scoreDecay(score, numDays, daysToZero) {
  return score * (1 - numDays/(daysToZero+1));
}
