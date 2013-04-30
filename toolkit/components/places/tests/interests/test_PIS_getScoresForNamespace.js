/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");

function run_test() {
  run_next_test();
}

add_task(function test_PlacesInterestsStorage_getTopInterest()
{
  yield addInterest("cars");
  yield addInterest("movies");
  yield addInterest("technology");
  yield addInterest("video-games");
  yield addInterest("history");
  yield PlacesInterestsStorage.setInterest("ignored-interest", {sharable: false, duration: DEFAULT_DURATION, threshold: DEFAULT_THRESHOLD});

  // make a bunch of insertions for a number of days
  let now = Date.now();
  let results;

  // no visits, all results 0 score
  results = yield PlacesInterestsStorage.getScoresForNamespace("");
  checkScores([], 5, results);

  // add visit
  yield PlacesInterestsStorage.addInterestVisit("technology", {visitTime: (now - MS_PER_DAY*0), visitCount: 1});
  results = yield PlacesInterestsStorage.getScoresForNamespace("");
  checkScores([
    {"name":"technology","score":1},
  ], 4, results);

  // add another visit for the same category, same day
  yield PlacesInterestsStorage.addInterestVisit("technology", {visitTime: (now - MS_PER_DAY*0), visitCount: 1});
  results = yield PlacesInterestsStorage.getScoresForNamespace("");
  checkScores([
    {"name":"technology","score":2},
  ], 4, results);

  // add 3 visits for another category, same day, new top interest
  yield PlacesInterestsStorage.addInterestVisit("cars", {visitTime: (now - MS_PER_DAY*0), visitCount: 3});
  results = yield PlacesInterestsStorage.getScoresForNamespace("");
  checkScores([
      {"name":"cars","score":3},
      {"name":"technology","score":2},
  ], 3, results);

  // add visits for another category, one day ago
  yield PlacesInterestsStorage.addInterestVisit("movies", {visitTime: (now - MS_PER_DAY*1), visitCount: 3});
  results = yield PlacesInterestsStorage.getScoresForNamespace("");
  checkScores([
      {"name":"cars","score":3},
      {"name":"movies","score":scoreDecay(3, 1, 28)},
      {"name":"technology","score":2},
  ], 2, results);

  // get top 2 visits, test result limiting
  results = yield PlacesInterestsStorage.getScoresForNamespace("", {interestLimit: 2});
  checkScores([
      {"name":"cars","score":3},
      {"name":"movies","score":scoreDecay(3, 1, 28)},
  ], 0, results);

  // add visits to the same category over multiple days
  yield PlacesInterestsStorage.addInterestVisit("video-games", {visitTime: (now - MS_PER_DAY*0), visitCount: 3});
  yield PlacesInterestsStorage.addInterestVisit("video-games", {visitTime: (now - MS_PER_DAY*1), visitCount: 2});
  yield PlacesInterestsStorage.addInterestVisit("video-games", {visitTime: (now - MS_PER_DAY*2), visitCount: 1});
  results = yield PlacesInterestsStorage.getScoresForNamespace("");
  checkScores([
      {"name":"video-games","score":3 + scoreDecay(2, 1, 28) + scoreDecay(1, 2, 28)},
      {"name":"cars","score":3},
      {"name":"movies","score":scoreDecay(3, 1, 28)},
      {"name":"technology","score":2},
  ], 1, results);

  yield PlacesInterestsStorage.clearRecentVisits(100);
  // add visits to a category beyond test threshold, i.e. 29 days and beyond
  // the category should not show up
  yield PlacesInterestsStorage.addInterestVisit("history", {visitTime: (now - MS_PER_DAY*29), visitCount: 2});
  results = yield PlacesInterestsStorage.getScoresForNamespace("");
  checkScores([], 5, results);

  // add visits within test-threshold, modifying buckets
  // assuming recent is: 14-28 days, past is > 28 days
  yield PlacesInterestsStorage.addInterestVisit("history", {visitTime: (now - MS_PER_DAY*15), visitCount: 3});
  results = yield PlacesInterestsStorage.getScoresForNamespace("");
  checkScores([
      {"name":"history","score":scoreDecay(3, 15, 28)},
  ], 4, results);

  // add unshared interest
  yield PlacesInterestsStorage.clearRecentVisits(100);
  yield PlacesInterestsStorage.addInterestVisit("ignored-interest", {visitTime: (now - MS_PER_DAY*0), visitCount: 1});
  yield PlacesInterestsStorage.setInterest("ignored-interest", {sharable: false});

  // show ignored interests
  results = yield PlacesInterestsStorage.getScoresForNamespace("");
  checkScores([{"name":"ignored-interest","score":1}], 4, results);

  results = yield PlacesInterestsStorage.getScoresForNamespace("", {checkSharable: true});
  checkScores([], 5, results);
});
