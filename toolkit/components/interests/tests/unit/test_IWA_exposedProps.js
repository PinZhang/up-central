/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let iServiceApi = Cc["@mozilla.org/InterestsWebAPI;1"].createInstance(Ci.mozIInterestsWebAPI);

add_task(function test_getTopInterests_exposedProps() {
  yield addInterest("cars");
  let interestsStorage = yield iServiceObject.InterestsStoragePromise;
  yield interestsStorage.setInterest("cars");
  yield interestsStorage.addInterestHostVisit("cars","cars.com");

  // Create a content sandbox and a helper to evaluate in the sandbox
  let sandbox = Cu.Sandbox("http://www.example.com");
  sandbox.interests = iServiceApi;
  function doIt(statement) Cu.evalInSandbox(statement, sandbox);

  // Make sure promises accept callbacks
  let then = doIt("then = interests.getTopInterests().then");
  do_check_eq(typeof then, "function");

  // Wait for then to finish from within the sandbox
  yield doIt("then(function(_ret) { ret = _ret; })");

  // Have the sandbox read out certain values
  do_check_eq(doIt("ret[0].diversity"), 100);
  do_check_eq(doIt("ret[0].name"), "cars");
  do_check_eq(doIt("ret[0].score"), 100);
});
