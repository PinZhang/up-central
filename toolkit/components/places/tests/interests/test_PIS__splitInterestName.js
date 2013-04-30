/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");

function check(interest, expected) {
  let namespace = PlacesInterestsStorage._splitInterestName(interest);
  do_check_eq(JSON.stringify(namespace), JSON.stringify(expected));
}

function run_test() {
  check("foo", ["", "foo"]);
  check(":bar", ["", "bar"]);
  check("foo:", ["foo", ""]);
  check("foo:bar", ["foo", "bar"]);
  check("foo:bar/baz", ["foo", "bar/baz"]);

  // not valid input, but checking for expected behavior
  check("foo:bar:baz", ["foo", "bar"]);
}
