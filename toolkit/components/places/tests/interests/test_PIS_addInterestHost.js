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


add_task(function test_AddInterestForHost() {
  yield promiseClearHistory();
  yield clearInterestsHosts();
  yield promiseAddUrlInterestsVisit("http://www.cars.com/", "cars");
  yield promiseAddUrlInterestsVisit("http://www.samsung.com/", "computers");
  yield promiseAddUrlInterestsVisit("http://www.netflix.com/", "movies");

  yield getHostsForInterest("cars").then(function(results) {
    do_check_eq(results.length, 1);
    do_check_eq(results[0], "cars.com");
  });

  yield getHostsForInterest("computers").then(function(results) {
    do_check_eq(results.length, 1);
    do_check_eq(results[0], "samsung.com");
  });

  yield getHostsForInterest("movies").then(function(results) {
    do_check_eq(results.length, 1);
    do_check_eq(results[0], "netflix.com");
  });

  // attmept to add non-existent site
  yield PlacesInterestsStorage.addInterestHost("cars","nosuchsite.com").then(function(results) {
    // we should do not have any results
    do_check_true(results == null);
  },
  function(error) {
    // we should do not come here
    do_check_false("sql statement should have failed without promise rejection");
  });

  // attmept to add non-existent interest
  yield PlacesInterestsStorage.addInterestHost("foobar","cars.com").then(function(results) {
    // we should do not have any results
    do_check_true(results == null);
  },
  function(error) {
    // we should do not come here
    do_check_false("sql statement should have failed without promise rejection");
  });

});

add_task(function test_PlacesInterestsStorageMostFrecentHosts() {
  yield promiseClearHistory();
  yield clearInterestsHosts();

  for (let i = 1; i <= 210; i++) {
    let site = "http://" + i + ".site.com";
    if (i<=200) yield addInterestVisitsToSite(site,"cars",2);
    else        yield addInterestVisitsToSite(site,"cars",1);
  }

  // moz_hosts table now looks like this
  // id|name|frecency
  // 1|1.site.com|200
  // 2|2.site.com|200
  // ....
  // 200|200.site.com|200
  // 201|201.site.com|100
  // ...
  // 210|210.site.com|100
  yield getHostsForInterest("cars").then(function(results) {
    do_check_eq(results.length , 200);
    for (let i = 1; i <= 200; i++ ) {
      do_check_true(itemsHave(results, i + ".site.com"));
    }
  });

  // attempt to directly add a host that is IN 200 most frrecent
  yield PlacesInterestsStorage.addInterestHost("cars","1.site.com").then(function(results) {
    // we should do not have any results
    do_check_true(results == null);
  },
  function(error) {
    // we should do not come here
    do_check_false("sql statement should have succeeded rejection");
  });

  yield getInterestsForHost("1.site.com").then(results => {
    do_check_eq(results.length, 1);
    do_check_eq(results[0], "cars");
  });

  // attempt to directly add a host that is NOT IN 200 most frrecent
  yield PlacesInterestsStorage.addInterestHost("cars","209.site.com").then(function(results) {
    // we should do not have any results
    do_check_true(results == null);
  },
  function(error) {
    // we should do not come here
    do_check_false("sql statement should have failed without promise rejection");
  });

  yield getInterestsForHost("209.site.com").then(results => {
    // we should do not have any results
    do_check_eq(results.length, 0);
  });

});
