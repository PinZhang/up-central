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

add_task(function test_promise() {
  LOG("Check promises work for async queries");
  yield PlacesInterestsStorage._execute("CREATE TABLE tmp(col)");
  yield PlacesInterestsStorage._execute("INSERT INTO tmp VALUES(5)");
  yield PlacesInterestsStorage._execute("DROP TABLE tmp");
});

add_task(function test_column() {
  LOG("Check reading out a single column as a value");
  let ret = yield PlacesInterestsStorage._execute("SELECT 2 a", {
    columns: ["a"],
  });
  do_check_eq(ret.length, 1);
  do_check_eq(ret[0], 2);
});

add_task(function test_columns() {
  LOG("Check reading out multiple columns as objects");
  let ret = yield PlacesInterestsStorage._execute("SELECT 2 a, 3 b", {
    columns: ["a", "b"],
  });
  do_check_eq(ret.length, 1);
  do_check_eq(ret[0].a, 2);
  do_check_eq(ret[0].b, 3);
});

add_task(function test_columns_order() {
  LOG("Check reading out columns in any order as objects");
  let ret = yield PlacesInterestsStorage._execute("SELECT 2 a, 3 b", {
    columns: ["b", "a"],
  });
  do_check_eq(ret.length, 1);
  do_check_eq(ret[0].a, 2);
  do_check_eq(ret[0].b, 3);

  let ret = yield PlacesInterestsStorage._execute("SELECT 2 b, 3 a", {
    columns: ["a", "b"],
  });
  do_check_eq(ret.length, 1);
  do_check_eq(ret[0].a, 3);
  do_check_eq(ret[0].b, 2);
});

add_task(function test_key() {
  LOG("Check reading out a column as a key");
  let ret = yield PlacesInterestsStorage._execute("SELECT 'hi' k", {
    key: "k",
  });
  do_check_eq(Object.keys(ret).length, 1);
  do_check_eq(Object.keys(ret)[0], "hi");
});

add_task(function test_key_column() {
  LOG("Check reading out a key and column");
  let ret = yield PlacesInterestsStorage._execute("SELECT 'hi' k, 2 a", {
    columns: ["a"],
    key: "k",
  });
  do_check_eq(ret.hi, 2);
});

add_task(function test_key_columns() {
  LOG("Check reading out a key and columns");
  let ret = yield PlacesInterestsStorage._execute("SELECT 'hi' k, 2 a, 3 b", {
    columns: ["a", "b"],
    key: "k",
  });
  do_check_eq(ret.hi.a, 2);
  do_check_eq(ret.hi.b, 3);
});

add_task(function test_params() {
  LOG("Check passing in params");
  let ret = yield PlacesInterestsStorage._execute("SELECT :x a, :x + :y b", {
    columns: ["a", "b"],
    params: {
      x: 1,
      y: 2,
    },
  });
  do_check_eq(ret[0].a, 1);
  do_check_eq(ret[0].b, 3);
});

add_task(function test_listParams() {
  LOG("Check passing in list params");
  let ret = yield PlacesInterestsStorage._execute("SELECT 2 IN (:list) a, 3 IN (:list) b", {
    columns: ["a", "b"],
    listParams: {
      list: [1, 2],
    },
  });
  do_check_eq(ret[0].a, 1);
  do_check_eq(ret[0].b, 0);
});

add_task(function test_onRow() {
  LOG("Check passing in onRow callback");
  let rows = [];
  let ret = yield PlacesInterestsStorage._execute("SELECT 2 a", {
    columns: ["a"],
    onRow: v => {
      rows.push(v);
    }
  });
  do_check_eq(ret, null);
  do_check_eq(rows.length, 1);
  do_check_eq(rows[0], 2);
});
