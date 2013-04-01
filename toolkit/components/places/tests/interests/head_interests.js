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
      visitPromises.push(PlacesInterestsStorage.addInterest(interest));
      visitPromises.push(PlacesInterestsStorage.addInterestVisit(interest, {visitTime: visitTime, visitCount: visitCount}));
      visitPromises.push(PlacesInterestsStorage.addInterestForHost(interest,host));
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
  visitPromises.push(PlacesInterestsStorage.addInterest(interest));
  visitPromises.push(PlacesInterestsStorage.addInterestVisit(interest, {visitTime: now - MS_PER_DAY*(daysAgo || 0), visitCount: count || 1}));
  return Promise.promised(Array)(visitPromises).then();
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
gHttpServer.start(HTTP_SERVER_PORT);

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

function setUpInterestAPIHandlers() {
  createJSONPathHandler("/api/v0/rules/de/mozilla_general",function(request , response) {
    response.setStatusLine( "1.1" , 200 , "OK");
    response.setHeader("Last-Modified", MOZILLA_GENERAL_LAST_MODIFIED);
    response.write(readFileText("mozilla_general.js"));
  });


}

function terminateServer() {
  // Stop the HTTP server.  this should be the last task registered
  let deferred = Promise.defer();
  gHttpServer.stop(deferred.resolve);
  return deferred.promise;
}
