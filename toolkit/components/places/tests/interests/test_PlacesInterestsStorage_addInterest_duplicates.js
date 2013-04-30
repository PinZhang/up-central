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

// Test that ids for interests increase by 1
add_task(function checkSequentialIds() {
  // Add some stuff in repeats in various orders
  yield addInterest("cars");
  yield addInterest("cars");
  yield addInterest("sports");
  yield addInterest("cars");
  yield addInterest("sports");
  yield addInterest("shopping");

  // Explicitly query for the id because it's not exposed through APIs
  let stmt = PlacesInterestsStorage._db.createStatement(
    "SELECT id, interest FROM moz_interests ORDER BY id ASC");

  try {
    stmt.executeStep();
    do_check_eq(stmt.row.id, 1);
    do_check_eq(stmt.row.interest, "cars");

    stmt.executeStep();
    do_check_eq(stmt.row.id, 2);
    do_check_eq(stmt.row.interest, "sports");

    stmt.executeStep();
    do_check_eq(stmt.row.id, 3);
    do_check_eq(stmt.row.interest, "shopping");
  }
  finally {
    stmt.finalize();
  }
});
