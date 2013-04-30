/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");

let dbConn = PlacesInterestsStorage.db;

let iServiceObject = Cc["@mozilla.org/places/interests;1"].getService(Ci.nsISupports).wrappedJSObject;
let apiInstance = Cc["@mozilla.org/InterestsWebAPI;1"].createInstance(Ci.mozIInterestsWebAPI)
apiInstance.QueryInterface(Ci.nsIDOMGlobalPropertyInitializer);

function run_test() {
  run_next_test();
}

add_task(function test_InterestWebAPI_whitelist()
{
  let now = Date.now();
  let results;

  // data setup
  yield addInterest("technology");
  yield PlacesInterestsStorage.addInterestVisit("technology", {visitTime: (now - MS_PER_DAY*10), visitCount: 10});
  results = yield apiInstance.getTopInterests();
  unExposeAll(results);
  checkScores([
      {"name":"technology","score":100,"diversity":0,"recency":{"immediate":true,"recent":false,"past":false}},
  ], 0, results);

  // whitelist permission setup
  let sandbox = Cu.Sandbox("http://www.example.com");
  sandbox.interests = apiInstance;
  function doIt(statement) Cu.evalInSandbox(statement, sandbox);

  function checkFails(command) {
    doIt("then = " + command + ".then");
    try {
      yield doIt("then(function(_ret) { ret = _ret; })");
    } catch(e) {
      // exception is thrown
      do_check_true(true);
    }
  }

  function checkSucceeds(command, expected, numZero) {
    doIt("then = " + command + ".then");
    yield doIt("then(function(_ret) { ret = _ret; })");
    results = doIt("ret");
    unExposeAll(results);
    checkScores(expected, numZero, results);
  }

  // getTopInterests with param < 5 is authorized for every interest
  // about:config is in the default whitelist

  // test: unauthorized
  apiInstance.init({location: {hostname: "realtor.com"}});

  checkFails("interests.getTopInterests(6)");
  checkFails("interests.getInterests(['technology'])");

  // test: authorized

  // site in defaults
  apiInstance.init({location: {hostname: "mozilla.com"}});

  checkSucceeds("interests.getTopInterests(6)", [
      {"name":"technology","score":100,"diversity":0,"recency":{"immediate":true,"recent":false,"past":false}},
  ], 0);
  checkSucceeds("interests.getInterests(['technology'])", [
      {"name":"technology","score":100,"diversity":0,"recency":{"immediate":true,"recent":false,"past":false}},
  ], 0);

  // site added to user-defined whitelist in prefs
  Services.prefs.setCharPref("interests.userDomainWhitelist", "testsite.com");
  apiInstance.init({location: {hostname: "testsite.com"}});

  checkSucceeds("interests.getTopInterests(6)", [
      {"name":"technology","score":100,"diversity":0,"recency":{"immediate":true,"recent":false,"past":false}},
  ], 0);
  checkSucceeds("interests.getInterests(['technology'])", [
      {"name":"technology","score":100,"diversity":0,"recency":{"immediate":true,"recent":false,"past":false}},
  ], 0);
});

