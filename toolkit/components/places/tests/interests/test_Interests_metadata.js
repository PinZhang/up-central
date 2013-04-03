/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");

const DEFAULT_THRESHOLD = 5;
const DEFAULT_DURATION = 14;

let iServiceObject = Cc["@mozilla.org/places/interests;1"].getService(Ci.nsISupports).wrappedJSObject;

function run_test() {
  run_next_test();
}

add_task(function test_Interests_getMetaForInterests()
{
  yield PlacesInterestsStorage.addInterest("cars");
  yield PlacesInterestsStorage.addInterest("movies");

  let results;

  // empty array
  results = yield iServiceObject._getMetaForInterests([]);
  isIdentical({}, results);

  // non-existent interest cases
  results = yield iServiceObject._getMetaForInterests(["eccentricity"])
  isIdentical({}, results);

  results = yield iServiceObject._getMetaForInterests(["eccentricity", "quixotic"])
  isIdentical({}, results);

  // INSERT works. create meta table entry, with no data given
  // for custom rules, this is what we will use to signal the need to download them
  results = yield iServiceObject._getMetaForInterests(["cars"])
  isIdentical({}, results);
  yield PlacesInterestsStorage.setMetaForInterest("cars");
  results = yield iServiceObject._getMetaForInterests(["cars"])
  isIdentical({"cars": {threshold: DEFAULT_THRESHOLD, duration: DEFAULT_DURATION}}, results);

  // updates work as expected
  yield PlacesInterestsStorage.setMetaForInterest("cars", {threshold: 5, duration: 15});
  results = yield iServiceObject._getMetaForInterests(["cars"])
  isIdentical({"cars": {threshold: 5, duration: 15}}, results);

  // INSERT cases

  // calling with an interest that doesn't exist
  yield PlacesInterestsStorage.setMetaForInterest("idontexist", {});
  results = yield iServiceObject._getMetaForInterests(["idontexist"]);
  isIdentical({}, results);

  // > 1 interests
  yield PlacesInterestsStorage.setMetaForInterest("movies", {threshold:14, duration: 5});
  results = yield iServiceObject._getMetaForInterests(["movies", "cars"]);
  isIdentical({"cars": {threshold: 5, duration: 15}, "movies": {threshold: 14, duration: 5}}, results);

  // multiple interests, one doesn't exist
  results = yield iServiceObject._getMetaForInterests(["movies", "cars", "idontexist"]);
  isIdentical({"cars": {threshold: 5, duration: 15}, "movies": {threshold: 14, duration: 5}}, results);
});
