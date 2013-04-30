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

add_task(function test_checkSharable()
{
  yield promiseAddUrlInterestsVisit("http://www.samsung.com/", "computers");
  yield promiseAddUrlInterestsVisit("http://www.netflix.com/", "movies");

  // Sanity check that diversity is computed for both
  yield PlacesInterestsStorage.getDiversityForInterests(["computers","movies"]).then(function(results) {
    do_check_eq(results["computers"] , 50);
    do_check_eq(results["movies"] , 50);
  });
  yield PlacesInterestsStorage.getDiversityForInterests(["computers","movies"], {
    checkSharable: true,
  }).then(function(results) {
    do_check_eq(results["computers"] , 50);
    do_check_eq(results["movies"] , 50);
  });
  yield PlacesInterestsStorage.getDiversityForInterests(["computers","movies"], {
    checkSharable: false,
  }).then(function(results) {
    do_check_eq(results["computers"] , 50);
    do_check_eq(results["movies"] , 50);
  });

  // Unshare one interest with no change
  yield PlacesInterestsStorage.setInterest("movies", {sharable: false});
  yield PlacesInterestsStorage.getDiversityForInterests(["computers","movies"]).then(function(results) {
    do_check_eq(results["computers"] , 50);
    do_check_eq(results["movies"] , 50);
  });

  // Explicitly factor in the sharability
  yield PlacesInterestsStorage.getDiversityForInterests(["computers","movies"], {
    checkSharable: true,
  }).then(function(results) {
    do_check_eq(results["computers"] , 50);
    do_check_eq(results["movies"] , 0);
  });

  // Sanity check with explicit false check
  yield PlacesInterestsStorage.getDiversityForInterests(["computers","movies"], {
    checkSharable: false,
  }).then(function(results) {
    do_check_eq(results["computers"] , 50);
    do_check_eq(results["movies"] , 50);
  });
});

add_task(function test_PlacesInterestsStorageGetDiversity()
{
  yield promiseClearHistory();
  yield clearInterestsHosts();

  yield promiseAddUrlInterestsVisit("http://www.cars.com/", ["cars","shopping"]);
  yield promiseAddUrlInterestsVisit("http://www.samsung.com/", "computers");
  yield promiseAddUrlInterestsVisit("http://www.mozilla.org/", ["cars","computers"]);
  yield promiseAddUrlInterestsVisit("http://www.netflix.com/", "movies");

  yield PlacesInterestsStorage.getDiversityForInterests(["cars","computers","movies","shopping"]).then(function(results) {
    do_check_eq(results["cars"] , 50);
    do_check_eq(results["computers"] , 50);
    do_check_eq(results["movies"] , 25);
    do_check_eq(results["shopping"] , 25);
  });

  yield PlacesInterestsStorage.getDiversityForInterests(["cars"]).then(function(results) {
    do_check_eq(results["cars"] , 50);
  });
});

add_task(function test_PlacesInterestsStorageGetDiversityForManyHosts()
{
  yield promiseClearHistory();
  yield clearInterestsHosts();

  for (let i = 1; i <= 210; i++) {
    let site = "http://" + i + ".site.com";
    if (i<=100) yield addInterestVisitsToSite(site,"cars",2);
    else if (i<=200) yield addInterestVisitsToSite(site,"movies",2);
    else        yield addInterestVisitsToSite(site,"shopping",1);
  }

  // so "cars" and "movies" will have each 100 sites in the interests_hosts tables
  // however, shopping should have no entry, since it's sites frecencies will lower
  // 200 previous sites.  Diversity for cars must be = diversity for movies = 50
  // shopping diversity must be 0
  yield PlacesInterestsStorage.getDiversityForInterests(["cars","computers","movies","shopping"]).then(function(results) {
    do_check_eq(Object.keys(results).length, 4);
    do_check_eq(results["cars"] , 50);
    do_check_eq(results["movies"] , 50);
    do_check_eq(results["computers"], 0);
    do_check_eq(results["shopping"], 0);
  });

});
