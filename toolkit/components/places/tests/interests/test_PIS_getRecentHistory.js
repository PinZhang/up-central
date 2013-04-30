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

add_task(function test_GetRecentHistory()
{
  let now = Date.now();
  let today = PlacesInterestsStorage._convertDateToDays(now);
  let microNow = now * 1000;
  yield promiseClearHistory();
  yield promiseAddVisits({uri: NetUtil.newURI("http://www.cars.com/"), visitDate: microNow});
  yield promiseAddVisits({uri: NetUtil.newURI("http://www.cars.com/"), visitDate: microNow - 1000});
  yield promiseAddVisits({uri: NetUtil.newURI("http://www.cars.com/"), visitDate: microNow - 2000});
  yield promiseAddVisits({uri: NetUtil.newURI("http://www.cars.com/"), visitDate: microNow - MICROS_PER_DAY + 1000});
  yield promiseAddVisits({uri: NetUtil.newURI("http://www.cars.com/"), visitDate: microNow - MICROS_PER_DAY + 10000});
  yield promiseAddVisits({uri: NetUtil.newURI("http://www.cars.com/"), visitDate: microNow - 2*MICROS_PER_DAY});
  yield promiseAddVisits({uri: NetUtil.newURI("http://www.cars.com/"), visitDate: microNow - 2*MICROS_PER_DAY});
  yield promiseAddVisits({uri: NetUtil.newURI("http://www.cars.com/"), visitDate: microNow - 2*MICROS_PER_DAY});

  let results = {};

  yield PlacesInterestsStorage.getRecentHistory(3, function(oneRecord) {
    // make sure oneRecord looks kosher
    do_check_eq(oneRecord.url, "http://www.cars.com/");
    do_check_eq(oneRecord.title, "test visit for http://www.cars.com/");
    do_check_true(oneRecord.visitDate != null);
    do_check_true(oneRecord.visitCount != null);
    let day = PlacesInterestsStorage._convertDateToDays(oneRecord.visitDate);
    results[day] = oneRecord.visitCount;
  }).then(function() {
    // make sure we have:
    // 3 visits for 2 days ago
    // 2 visits for 1 day ago
    // 1 visit for today
    do_check_eq(Object.keys(results).length, 3);
    do_check_eq(results[today], 3);
    do_check_eq(results[today - 1], 2);
    do_check_eq(results[today - 2], 3);
  });

  yield PlacesInterestsStorage.getRecentHistory(1, function(oneRecord) {
    //we should only see
    dump(JSON.stringify(oneRecord) + " <<<==== \n");
    do_check_eq(oneRecord.url, "http://www.cars.com/");
    do_check_eq(oneRecord.title, "test visit for http://www.cars.com/");
    do_check_eq(oneRecord.visitCount,3);
    do_check_eq(oneRecord.visitDate,today*MS_PER_DAY);
  });

  let haveSeenRecords = false;
  yield PlacesInterestsStorage.getRecentHistory(0, function(oneRecord) {
    haveSeenRecords = true;
  });

  do_check_true(haveSeenRecords == false);

});
