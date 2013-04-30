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

// Test adding interest visits going older in time
add_task(function addGoingOlder() {
  let interest = "cars";
  yield addInterest(interest);

  // Add one visit for now and make sure there's only one
  yield PlacesInterestsStorage.addInterestVisit(interest);
  yield PlacesInterestsStorage.getBucketsForInterests([interest]).then(function(result) {
    do_check_eq(result.cars.immediate, 1);
    do_check_eq(result.cars.recent, 0);
    do_check_eq(result.cars.past, 0);
  });

  // Add a couple visits from 3 weeks ago for recent
  let recentTime = Date.now() - 3 * 7 * 24 * 60 * 60 * 1000;
  yield PlacesInterestsStorage.addInterestVisit(interest, {visitTime: recentTime});
  yield PlacesInterestsStorage.addInterestVisit(interest, {visitTime: recentTime});

  yield PlacesInterestsStorage.getBucketsForInterests([interest]).then(function(result) {
    do_check_eq(result.cars.immediate, 1);
    do_check_eq(result.cars.recent, 2);
    do_check_eq(result.cars.past, 0);
  });

  // Add a few visits from 5 weeks ago for past
  let pastTime = Date.now() - 5 * 7 * 24 * 60 * 60 * 1000;
  yield PlacesInterestsStorage.addInterestVisit(interest, {visitTime: pastTime});
  yield PlacesInterestsStorage.addInterestVisit(interest, {visitTime: pastTime});
  yield PlacesInterestsStorage.addInterestVisit(interest, {visitTime: pastTime});

  yield PlacesInterestsStorage.getBucketsForInterests([interest]).then(function(result) {
    do_check_eq(result.cars.immediate, 1);
    do_check_eq(result.cars.recent, 2);
    do_check_eq(result.cars.past, 3);
  });
});

// Test adding interest visits going more recent in time
add_task(function addGoingNewer() {
  let interest = "sports";
  yield addInterest(interest);

  // Add a visit from 5 weeks ago for past
  let pastTime = Date.now() - 5 * 7 * 24 * 60 * 60 * 1000;
  yield PlacesInterestsStorage.addInterestVisit(interest, {visitTime: pastTime});

  yield PlacesInterestsStorage.getBucketsForInterests([interest]).then(function(result) {
    do_check_eq(result.sports.immediate, 0);
    do_check_eq(result.sports.recent, 0);
    do_check_eq(result.sports.past, 1);
  });

  // Add a couple visits from 3 weeks ago for recent
  let recentTime = Date.now() - 3 * 7 * 24 * 60 * 60 * 1000;
  yield PlacesInterestsStorage.addInterestVisit(interest, {visitTime: recentTime});
  yield PlacesInterestsStorage.addInterestVisit(interest, {visitTime: recentTime});

  yield PlacesInterestsStorage.getBucketsForInterests([interest]).then(function(result) {
    do_check_eq(result.sports.immediate, 0);
    do_check_eq(result.sports.recent, 2);
    do_check_eq(result.sports.past, 1);
  });

  // Add a few visits for now
  yield PlacesInterestsStorage.addInterestVisit(interest);
  yield PlacesInterestsStorage.addInterestVisit(interest);
  yield PlacesInterestsStorage.addInterestVisit(interest);
  yield PlacesInterestsStorage.getBucketsForInterests([interest]).then(function(result) {
    do_check_eq(result.sports.immediate, 3);
    do_check_eq(result.sports.recent, 2);
    do_check_eq(result.sports.past, 1);
  });
});
