/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");

function run_test() {
  run_next_test();
}

add_task(function test_ClearRecentVisits()
{
  yield promiseAddUrlInterestsVisit("http://www.cars.com/", ["cars","movies","shopping"], 2);
  yield promiseAddUrlInterestsVisit("http://www.samsung.com/", "consumer-electronics");
  yield promiseAddUrlInterestsVisit("http://www.mozilla.org/", "computers");

  // cleanup the tables
  yield PlacesInterestsStorage.clearRecentVisits(100);
  yield clearInterestsHosts();

  // check that tables are empty
  yield PlacesInterestsStorage.getBucketsForInterests(["computers"]).then(function(results) {
    do_check_eq(results.computers.immediate , 0);
    do_check_eq(results.computers.past , 0);
    do_check_eq(results.computers.recent , 0);
  });

  yield PlacesInterestsStorage.getBucketsForInterests(["cars"]).then(function(results) {
    do_check_eq(results.cars.immediate , 0);
    do_check_eq(results.cars.past , 0);
    do_check_eq(results.cars.recent , 0);
  });

  yield getInterestsForHost("cars.com").then(function(results) {
    do_check_eq(results.length, 0);
  });

  // make a bunch of insertions for a number of days
  for(let i = 0; i < 100; i++) {
    yield promiseAddUrlInterestsVisit("http://www.cars.com/", "cars", 1, i);
  }

  yield PlacesInterestsStorage.getBucketsForInterests(["cars"]).then(function(results) {
    do_check_eq(results.cars.immediate , 14);
    do_check_eq(results.cars.recent , 14);
    do_check_eq(results.cars.past , 72);
  });

  yield getHostsForInterest("cars").then(function(results) {
    do_check_eq(results.length , 1);
    do_check_eq(results[0] , "cars.com");
  });

  // test deletions
  yield PlacesInterestsStorage.clearRecentVisits(14);

  yield PlacesInterestsStorage.getBucketsForInterests(["cars"]).then(function(results) {
    do_check_eq(results.cars.immediate , 0);
    do_check_eq(results.cars.recent , 14);
    do_check_eq(results.cars.past , 72);
  });

  yield getHostsForInterest("cars").then(function(results) {
    do_check_eq(results.length , 1);
    do_check_eq(results[0] , "cars.com");
  });

  yield PlacesInterestsStorage.clearRecentVisits(28);

  yield PlacesInterestsStorage.getBucketsForInterests(["cars"]).then(function(results) {
    do_check_eq(results.cars.immediate , 0);
    do_check_eq(results.cars.recent , 0);
    do_check_eq(results.cars.past , 72);
  });

  yield PlacesInterestsStorage.clearRecentVisits(50);

  yield PlacesInterestsStorage.getBucketsForInterests(["cars"]).then(function(results) {
    do_check_eq(results.cars.immediate , 0);
    do_check_eq(results.cars.recent , 0);
    do_check_eq(results.cars.past , 50);
  });

  yield PlacesInterestsStorage.clearRecentVisits(100);

  yield PlacesInterestsStorage.getBucketsForInterests(["cars"]).then(function(results) {
    do_check_eq(results.cars.immediate , 0);
    do_check_eq(results.cars.recent , 0);
    do_check_eq(results.cars.past , 0);
  });

  yield PlacesInterestsStorage.clearRecentVisits(100);

  // test visitCounts when adding visits

  // add one today
  yield promiseAddInterestVisits("cars");
  yield PlacesInterestsStorage.getBucketsForInterests(["cars"]).then(function(results) {
    do_check_eq(results.cars.immediate , 1);
    do_check_eq(results.cars.recent , 0);
    do_check_eq(results.cars.past , 0);
  });

  // add a couple more yesterday
  yield promiseAddInterestVisits("cars", 4, 1);
  yield PlacesInterestsStorage.getBucketsForInterests(["cars"]).then(function(results) {
    do_check_eq(results.cars.immediate , 5);
    do_check_eq(results.cars.recent , 0);
    do_check_eq(results.cars.past , 0);
  });

  // add some in the recent bucket, some in the past
  // recent assumed to be 14-28 days ago, past > 28 days
  yield promiseAddInterestVisits("cars", 3, 15);
  yield promiseAddInterestVisits("cars", 10, 31);
  yield PlacesInterestsStorage.getBucketsForInterests(["cars"]).then(function(results) {
    do_check_eq(results.cars.immediate , 5);
    do_check_eq(results.cars.recent , 3);
    do_check_eq(results.cars.past , 10);
  });

  yield clearInterestsHosts();
  yield getInterestsForHost("cars.com").then(function(results) {
    do_check_eq(results.length, 0);
  });

});
