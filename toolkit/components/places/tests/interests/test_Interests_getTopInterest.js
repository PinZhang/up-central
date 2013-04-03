/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");

let iServiceObject = Cc["@mozilla.org/places/interests;1"].getService(Ci.nsISupports).wrappedJSObject;

function run_test() {
  run_next_test();
}

add_task(function test_Interests_getTopInterest()
{
  yield promiseAddVisits(NetUtil.newURI("http://www.cars.com/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.mozilla.org/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.netflix.com/"));
  yield promiseAddVisits(NetUtil.newURI("http://www.samsung.com/"));

  yield PlacesInterestsStorage.addInterest("cars");
  yield PlacesInterestsStorage.addInterest("movies");
  yield PlacesInterestsStorage.addInterest("technology");
  yield PlacesInterestsStorage.addInterest("video-games");
  yield PlacesInterestsStorage.addInterest("history");

  yield PlacesInterestsStorage.setMetaForInterest("cars");
  yield PlacesInterestsStorage.setMetaForInterest("movies");
  yield PlacesInterestsStorage.setMetaForInterest("technology");
  yield PlacesInterestsStorage.setMetaForInterest("video-games");
  yield PlacesInterestsStorage.setMetaForInterest("history");

  function scoreDecay(score, numDays, daysToZero) {
    return score * (1 - numDays/(daysToZero+1));
  }

  // make a bunch of insertions for a number of days
  const MS_PER_DAY = 86400000;
  let now = Date.now();
  let results;

  // no visits, empty results
  results = yield iServiceObject._getTopInterests();
  isIdentical([], results);

  // add visit
  yield PlacesInterestsStorage.addInterestVisit("technology", {visitTime: (now - MS_PER_DAY*0), visitCount: 1});
  yield PlacesInterestsStorage.addInterestForHost("technology", "samsung.com");
  results = yield iServiceObject._getTopInterests();
  isIdentical([{"name":"technology","score":1,"diversity":25,"recency":{"immediate":1,"recent":0,"past":0}}], results);

  // add another visit for the same category, same day
  yield PlacesInterestsStorage.addInterestVisit("technology", {visitTime: (now - MS_PER_DAY*0), visitCount: 1});
  yield PlacesInterestsStorage.addInterestForHost("technology", "mozilla.org");
  results = yield iServiceObject._getTopInterests();
  isIdentical([{"name":"technology","score":2,"diversity":50,"recency":{"immediate":2,"recent":0,"past":0}}], results);

  // add 3 visits for another category, same day, new top interest
  yield PlacesInterestsStorage.addInterestVisit("cars", {visitTime: (now - MS_PER_DAY*0), visitCount: 3});
  yield PlacesInterestsStorage.addInterestForHost("cars", "cars.com");
  results = yield iServiceObject._getTopInterests();
  isIdentical([
      {"name":"cars","score":3,"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
      {"name":"technology","score":2,"diversity":50,"recency":{"immediate":2,"recent":0,"past":0}},
  ], results);

  // add visits for another category, one day ago
  yield PlacesInterestsStorage.addInterestVisit("movies", {visitTime: (now - MS_PER_DAY*1), visitCount: 3});
  yield PlacesInterestsStorage.addInterestForHost("movies", "netflix.com");
  results = yield iServiceObject._getTopInterests();
  isIdentical([
      {"name":"cars","score":3,"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
      {"name":"movies","score":scoreDecay(3, 1, 28),"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
      {"name":"technology","score":2,"diversity":50,"recency":{"immediate":2,"recent":0,"past":0}},
  ], results);

  // get top 2 visits, test result limiting
  results = yield iServiceObject._getTopInterests(2);
  isIdentical([
      {"name":"cars","score":3,"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
      {"name":"movies","score":scoreDecay(3, 1, 28),"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
  ], results);

  // add visits to the same category over multiple days
  yield PlacesInterestsStorage.addInterestVisit("video-games", {visitTime: (now - MS_PER_DAY*0), visitCount: 3});
  yield PlacesInterestsStorage.addInterestVisit("video-games", {visitTime: (now - MS_PER_DAY*1), visitCount: 2});
  yield PlacesInterestsStorage.addInterestVisit("video-games", {visitTime: (now - MS_PER_DAY*2), visitCount: 1});
  results = yield iServiceObject._getTopInterests();
  isIdentical([
      {"name":"video-games","score":3 + scoreDecay(2, 1, 28) + scoreDecay(1, 2, 28),"diversity":0,"recency":{"immediate":6,"recent":0,"past":0}},
      {"name":"cars","score":3,"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
      {"name":"movies","score":scoreDecay(3, 1, 28),"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
      {"name":"technology","score":2,"diversity":50,"recency":{"immediate":2,"recent":0,"past":0}},
  ], results);

  // set ignored for an interest
  yield iServiceObject._setIgnoredForInterest("video-games");
  results = yield iServiceObject._getTopInterests();
  isIdentical([
      {"name":"cars","score":3,"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
      {"name":"movies","score":scoreDecay(3, 1, 28),"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
      {"name":"technology","score":2,"diversity":50,"recency":{"immediate":2,"recent":0,"past":0}},
  ], results);

  // unset ignored for an interest
  yield iServiceObject._unsetIgnoredForInterest("video-games");
  results = yield iServiceObject._getTopInterests();
  isIdentical([
      {"name":"video-games","score":3 + scoreDecay(2, 1, 28) + scoreDecay(1, 2, 28),"diversity":0,"recency":{"immediate":6,"recent":0,"past":0}},
      {"name":"cars","score":3,"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
      {"name":"movies","score":scoreDecay(3, 1, 28),"diversity":25,"recency":{"immediate":3,"recent":0,"past":0}},
      {"name":"technology","score":2,"diversity":50,"recency":{"immediate":2,"recent":0,"past":0}},
  ], results);

  yield PlacesInterestsStorage.clearRecentInterests(100);
  // add visits to a category beyond test threshold, i.e. 29 days and beyond
  // the category should not show up
  yield PlacesInterestsStorage.addInterestVisit("history", {visitTime: (now - MS_PER_DAY*29), visitCount: 2});
  results = yield iServiceObject._getTopInterests();
  isIdentical([], results);

  // add visits within test-threshold, modifying buckets
  // assuming recent is: 14-28 days, past is > 28 days
  yield PlacesInterestsStorage.addInterestVisit("history", {visitTime: (now - MS_PER_DAY*15), visitCount: 3});
  results = yield iServiceObject._getTopInterests();
  isIdentical([
      {"name":"history","score":scoreDecay(3, 15, 28),"diversity":0,"recency":{"immediate":0,"recent":3,"past":2}},
  ], results);
});

