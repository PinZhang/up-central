/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");

function run_test() {
  run_next_test();
}

add_task(function test_PlacesInterestsStorage()
{
  yield promiseAddUrlInterestsVisit("http://www.cars.com/", ["cars","movies","shopping"], 2);
  yield promiseAddUrlInterestsVisit("http://www.samsung.com/", "consumer-electronics");
  yield promiseAddUrlInterestsVisit("http://www.mozilla.org/", "computers");

  // test promise returning results functionality
  yield getInterestsForHost("cars.com").then(function(results) {
    do_check_eq(results.length , 3);
    do_check_true(itemsHave(results,"cars"));
    do_check_true(itemsHave(results,"movies"));
    do_check_true(itemsHave(results,"shopping"));
  });

  yield getHostsForInterest("computers").then(function(results) {
    do_check_eq(results.length , 1);
    do_check_true(itemsHave(results,"mozilla.org"));
  });

  // make sure we are getting correct counts in the buckets
  yield PlacesInterestsStorage.getBucketsForInterests(["computers"]).then(function(results) {
    do_check_eq(results.computers.immediate , 1);
  });

  yield PlacesInterestsStorage.getBucketsForInterests(["cars"]).then(function(results) {
    do_check_eq(results.cars.immediate, 2);
  });

});
