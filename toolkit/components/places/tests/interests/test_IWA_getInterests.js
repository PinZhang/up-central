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
let iServiceApi = Cc["@mozilla.org/InterestsWebAPI;1"].createInstance(Ci.mozIInterestsWebAPI)

function run_test() {
  run_next_test();
}

add_task(function test_InterestWebAPI_getInterests()
{
  // make a bunch of insertions for a number of days
  let now = Date.now();
  let results;

  yield promiseAddVisits(NetUtil.newURI("http://www.cars.com/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.mozilla.org/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.netflix.com/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.samsung.com/"));

  // interests set with default values for threshold and duration
  yield addInterest("cars");
  yield addInterest("movies");
  yield addInterest("video-games");
  yield addInterest("history");
  yield addInterest("food");
  yield addInterest("computers");

  // this interest has custom values for duration and threshold
  yield PlacesInterestsStorage.setInterest("technology", {duration: 20, threshold: 10});
  /*
  */

  // no visits, empty results
  results = yield iServiceApi.getInterests([]);
  checkScores([], 0, results);

  // add visit
  yield PlacesInterestsStorage.addInterestVisit("cars", {visitTime: (now - MS_PER_DAY*0), visitCount: 1});
  yield PlacesInterestsStorage.addInterestHost("cars", "cars.com");
  yield PlacesInterestsStorage.addInterestHost("movies", "netflix.com");
  yield PlacesInterestsStorage.addInterestHost("computers", "mozilla.org");
  yield PlacesInterestsStorage.addInterestHost("technology", "samsung.com");

  results = yield iServiceApi.getInterests(["cars", "movies"]);
  unExposeAll(results);
  checkScores([
    {"name":"cars","score":100,"diversity":25,"recency":{"immediate":false,"recent":false,"past":false}},
  ], 1, results);

  // add another visit for the same category, same day. do not cross threshold
  yield PlacesInterestsStorage.addInterestVisit("cars", {visitTime: (now - MS_PER_DAY*0), visitCount: 1});
  yield PlacesInterestsStorage.addInterestHost("cars", "netflix.com");
  results = yield iServiceApi.getInterests(["cars"]);
  unExposeAll(results);
  checkScores([
    {"name":"cars","score":100,"diversity":50,"recency":{"immediate":false,"recent":false,"past":false}},
  ], 0, results);

  // add more visits for the same category, same day. do cross threshold
  yield PlacesInterestsStorage.addInterestVisit("cars", {visitTime: (now - MS_PER_DAY*0), visitCount: 3});
  yield PlacesInterestsStorage.addInterestHost("cars", "samsung.com");
  results = yield iServiceApi.getInterests(["cars"]);
  unExposeAll(results);
  checkScores([
    {"name":"cars","score":100,"diversity":75,"recency":{"immediate":true,"recent":false,"past":false}},
  ], 0, results);

  // add a few visits for another category, same day, new top interest
  yield PlacesInterestsStorage.addInterestVisit("technology", {visitTime: (now - MS_PER_DAY*0), visitCount: 9});

  results = yield iServiceApi.getInterests(["cars", "technology"]);
  unExposeAll(results);
  let scoreMax = 9;
  let calcScore = score => Math.round(score / scoreMax * 100);
  checkScores([
      {"name":"technology","score":calcScore(9),"diversity":25,"recency":{"immediate":false,"recent":false,"past":false}},
      {"name":"cars","score":calcScore(5),"diversity":75,"recency":{"immediate":true,"recent":false,"past":false}},
  ], 0, results);

  // add visits for another category, one day ago

  yield PlacesInterestsStorage.addInterestVisit("movies", {visitTime: (now - MS_PER_DAY*1), visitCount: 3});
  yield PlacesInterestsStorage.addInterestHost("movies", "netflix.com");
  results = yield iServiceApi.getInterests(["technology", "movies", "cars"]);
  unExposeAll(results);
  scoreMax = 9;
  checkScores([
      {"name":"technology","score":calcScore(9),"diversity":25,"recency":{"immediate":false,"recent":false,"past":false}},
      {"name":"cars","score":calcScore(5),"diversity":75,"recency":{"immediate":true,"recent":false,"past":false}},
      {"name":"movies","score": calcScore(scoreDecay(3, 1, 28)),"diversity":25,"recency":{"immediate":false,"recent":false,"past":false}},
  ], 0, results);

  // make interest go beyond custom threshold
  yield PlacesInterestsStorage.addInterestVisit("technology", {visitTime: (now - MS_PER_DAY*0), visitCount: 1});
  results = yield iServiceApi.getInterests(["cars", "technology", "movies"]);
  unExposeAll(results);
  scoreMax = 10;
  checkScores([
      {"name":"technology","score":calcScore(10),"diversity":25,"recency":{"immediate":true,"recent":false,"past":false}},
      {"name":"cars","score":calcScore(5),"diversity":75,"recency":{"immediate":true,"recent":false,"past":false}},
      {"name":"movies","score":calcScore(scoreDecay(3, 1, 28)),"diversity":25,"recency":{"immediate":false,"recent":false,"past":false}},
  ], 0, results);

  // add visits to the same category over multiple days
  yield PlacesInterestsStorage.addInterestVisit("video-games", {visitTime: (now - MS_PER_DAY*0), visitCount: 15});
  yield PlacesInterestsStorage.addInterestVisit("video-games", {visitTime: (now - MS_PER_DAY*1), visitCount: 5});
  yield PlacesInterestsStorage.addInterestVisit("video-games", {visitTime: (now - MS_PER_DAY*2), visitCount: 3});
  yield PlacesInterestsStorage.addInterestHost("video-games", "cars.com");
  results = yield iServiceApi.getInterests(["cars", "movies", "technology", "video-games"]);
  unExposeAll(results);
  scoreMax = 15 + scoreDecay(5, 1, 28) + scoreDecay(3, 2, 28);
  checkScores([
      {"name":"video-games","score":calcScore(15 + scoreDecay(5, 1, 28) + scoreDecay(3, 2, 28)),"diversity":25,"recency":{"immediate":true,"recent":false,"past":false}},
      {"name":"technology","score":calcScore(10),"diversity":25,"recency":{"immediate":true,"recent":false,"past":false}},
      {"name":"cars","score":calcScore(5),"diversity":75,"recency":{"immediate":true,"recent":false,"past":false}},
      {"name":"movies","score":calcScore(scoreDecay(3, 1, 28)),"diversity":25,"recency":{"immediate":false,"recent":false,"past":false}},
  ], 0, results);

  // add a couple more interest visits to get top 5. food will show, history won't show up
  // both are beyond the "immediate" bucket, food will show recent to be true
  yield PlacesInterestsStorage.addInterestVisit("food", {visitTime: (now - MS_PER_DAY*15), visitCount: 5});
  yield PlacesInterestsStorage.addInterestVisit("history", {visitTime: (now - MS_PER_DAY*16), visitCount: 5});
  results = yield iServiceApi.getInterests(["cars", "technology", "movies", "video-games", "food"]);
  unExposeAll(results);
  scoreMax = 15 + scoreDecay(5, 1, 28) + scoreDecay(3, 2, 28);
  checkScores([
      {"name":"video-games","score":calcScore(15 + scoreDecay(5, 1, 28) + scoreDecay(3, 2, 28)),"diversity":25,"recency":{"immediate":true,"recent":false,"past":false}},
      {"name":"technology","score":calcScore(10),"diversity":25,"recency":{"immediate":true,"recent":false,"past":false}},
      {"name":"cars","score":calcScore(5),"diversity":75,"recency":{"immediate":true,"recent":false,"past":false}},
      {"name":"movies","score":calcScore(scoreDecay(3, 1, 28)),"diversity":25,"recency":{"immediate":false,"recent":false,"past":false}},
      {"name":"food","score":calcScore(scoreDecay(5, 15, 28)),"diversity":0,"recency":{"immediate":false,"recent":true,"past":false}},
  ], 0, results);

  yield PlacesInterestsStorage.clearRecentVisits(100);
  // add visits to a category beyond test threshold, i.e. 29 days and beyond
  // the category should not show up
  yield promiseAddVisits(NetUtil.newURI("http://www.site1.com/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.site2.com/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.site3.com/"));
  yield PlacesInterestsStorage.addInterestVisit("history", {visitTime: (now - MS_PER_DAY*29), visitCount: 5});
  yield PlacesInterestsStorage.addInterestHost("history", "site1.com");
  yield PlacesInterestsStorage.addInterestHost("history", "site2.com");
  results = yield iServiceApi.getInterests(["cars", "technology", "video-games"]);
  unExposeAll(results);
  checkScores([], 3, results);

  // add visits within test-threshold, modifying buckets
  // assuming recent is: 14-28 days, past is > 28 days
  yield PlacesInterestsStorage.addInterestVisit("history", {visitTime: (now - MS_PER_DAY*15), visitCount: 5});
  results = yield iServiceApi.getInterests(["cars", "history"]);
  unExposeAll(results);
  checkScores([
      {"name":"history","score":100,"diversity":33,"recency":{"immediate":false,"recent":true,"past":true}},
  ], 1, results);

  yield PlacesInterestsStorage.clearRecentVisits(100);
  // add visits to a category beyond custom threshold, i.e. 40 days and beyond, and 10 in threshold
  // the category should not show up
  yield PlacesInterestsStorage.addInterestVisit("technology", {visitTime: (now - MS_PER_DAY*41), visitCount: 10});
  yield PlacesInterestsStorage.addInterestHost("technology", "site1.com");
  yield PlacesInterestsStorage.addInterestHost("technology", "site2.com");
  results = yield iServiceApi.getInterests(["cars", "technology"]);
  unExposeAll(results);
  checkScores([], 2, results);

  // add visits within test-threshold, modifying buckets
  // recent is: 20-40 days, past is > 40 days
  yield PlacesInterestsStorage.addInterestVisit("technology", {visitTime: (now - MS_PER_DAY*28), visitCount: 5});
  results = yield iServiceApi.getInterests(["cars", "technology"]);
  unExposeAll(results);
  checkScores([
      {"name":"technology","score":100,"diversity":50,"recency":{"immediate":false,"recent":false,"past":true}},
  ], 1, results);

  yield PlacesInterestsStorage.addInterestVisit("technology", {visitTime: (now - MS_PER_DAY*28), visitCount: 5});
  yield PlacesInterestsStorage.addInterestHost("technology", "site3.com");
  results = yield iServiceApi.getInterests(["technology", "cars"]);
  unExposeAll(results);
  checkScores([
      {"name":"technology","score":100,"diversity":57,"recency":{"immediate":false,"recent":true,"past":true}},
  ], 1, results);
});

add_task(function test_sharable() {
  let results;

  // Clear out previous test state
  yield promiseClearHistory();
  yield clearInterestsHosts();
  yield PlacesInterestsStorage.clearRecentVisits(30);

  // Add some hosts
  yield promiseAddVisits(NetUtil.newURI("http://www.cars.com/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.mozilla.org/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.netflix.com/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.samsung.com/"));

  // interests set with default values for threshold and duration
  yield addInterest("cars");
  yield addInterest("movies");
  yield addInterest("video-games");
  yield addInterest("history");
  yield addInterest("food");
  yield addInterest("computers");

  // Add some test visits and hosts
  yield PlacesInterestsStorage.addInterestVisit("cars");
  yield PlacesInterestsStorage.addInterestHost("cars", "cars.com");
  yield PlacesInterestsStorage.addInterestHost("movies", "netflix.com");
  yield PlacesInterestsStorage.addInterestHost("computers", "mozilla.org");
  yield PlacesInterestsStorage.addInterestHost("technology", "samsung.com");

  results = yield iServiceApi.getInterests(["computers", "technology", "cars"]);
  unExposeAll(results);
  checkScores([
    {"name":"cars","score":100,"diversity":25,"recency":{"immediate":false,"recent":false,"past":false}},
  ], 2, results);

  LOG("Unshare the one interest with non-zero score and everything should be 0");
  yield PlacesInterestsStorage.setInterest("cars", {sharable: false});
  results = yield iServiceApi.getInterests(["computers", "technology", "cars"]);
  checkScores([], 3, results);
});
