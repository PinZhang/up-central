/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");

function run_test() {
  // Make sure the current time is rounded
  let nowDays = PlacesInterestsStorage._convertDateToDays();
  let roundedDate = new Date(nowDays * MS_PER_DAY);
  do_check_eq(roundedDate.getUTCMilliseconds(), 0);
  do_check_eq(roundedDate.getUTCSeconds(), 0);
  do_check_eq(roundedDate.getUTCMinutes(), 0);
  do_check_eq(roundedDate.getUTCHours(), 0);

  // Add some offset to the date for a sanity check
  let shiftedDate = new Date(nowDays * MS_PER_DAY +
    1 + // 1 millisecond
    2 * 1000 + // 2 seconds
    3 * 1000 * 60 + // 3 minutes
    4 * 1000 * 60 * 60); // 4 hours
  do_check_eq(shiftedDate.getUTCMilliseconds(), 1);
  do_check_eq(shiftedDate.getUTCSeconds(), 2);
  do_check_eq(shiftedDate.getUTCMinutes(), 3);
  do_check_eq(shiftedDate.getUTCHours(), 4);

  // Make sure the shifted date gets rounded correctly
  let shiftedDays = PlacesInterestsStorage._convertDateToDays(shiftedDate);
  let roundedShiftedDate = new Date(shiftedDays * MS_PER_DAY);
  do_check_eq(roundedShiftedDate.getUTCMilliseconds(), 0);
  do_check_eq(roundedShiftedDate.getUTCSeconds(), 0);
  do_check_eq(roundedShiftedDate.getUTCMinutes(), 0);
  do_check_eq(roundedShiftedDate.getUTCHours(), 0);

  // The number of days should match for the two rounded dates
  do_check_eq(nowDays, shiftedDays);

  // Going back one millisecond should result in one day before
  let backDate = new Date(nowDays * MS_PER_DAY - 1);
  let backDays = PlacesInterestsStorage._convertDateToDays(backDate);
  do_check_eq(nowDays - backDays, 1);
}
