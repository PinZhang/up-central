/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");
Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");

let iServiceObject = Cc["@mozilla.org/places/interests;1"].getService(Ci.nsISupports).wrappedJSObject;
let iServiceApi = Cc["@mozilla.org/InterestsWebAPI;1"].createInstance(Ci.mozIInterestsWebAPI)
let obsereverService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);

function run_test() {
  run_next_test();
}

let enIFR1 = {
  "en/foo:cars": {
    "matches" : [{"domains": ["ford.com"]}],
    "threshold" : 1,
    "duration" : 100,
    "serverId": 1
  },
  "en/foo:pets": {
    "matches" : [{"domains": ["pets.com"]}],
    "threshold" : 20,
    "duration" : 200,
    "serverId": 2
  }
};

add_task(function test_processNamespace() {

  yield iServiceObject._processServerNamespace("en/foo",1000,enIFR1);
  yield PlacesInterestsStorage.addNamespace("en/foo",1000);
  yield PlacesInterestsStorage.getInterests(["pets", "cars"]).then(results => {
    do_check_eq(results.cars.threshold,1);
    do_check_eq(results.cars.duration,100);
    do_check_eq(results.pets.threshold,20);
    do_check_eq(results.pets.duration,200);
  });

  yield PlacesInterestsStorage.getAllIFRs().then(results => {
    dumpObject(results);
    isIdentical(results,[ {
                           "serverNamespace":"en/foo",
                           "interest":"cars",
                           "dateUpdated":1000,
                           "ifr":[{"domains":["ford.com"]}],
                           "serverId":1
                          },
                          {
                            "serverNamespace":"en/foo",
                            "interest":"pets",
                            "dateUpdated":1000,
                            "ifr":[{"domains":["pets.com"]}],
                            "serverId":2
                           }]);
  });

  delete enIFR1["en/foo:pets"];
  enIFR1["en/foo:cars"].matches = {"a":1};
  enIFR1["en/foo:cars"].threshold = 11;
  enIFR1["en/foo:cars"].duration = 110;

  yield iServiceObject._processServerNamespace("en/foo",5000,enIFR1);

  // make sure the namespace update date is 5000
  yield PlacesInterestsStorage.getNamespaces().then(results => {
    do_check_eq(results[0].serverNamespace,"en/foo");
    do_check_eq(results[0].lastModified,5000);
  });

  yield PlacesInterestsStorage.getInterests(["pets","cars"]).then(results => {
    do_check_eq(results.cars.threshold,11);
    do_check_eq(results.cars.duration,110);
    do_check_eq(results.pets.threshold,20);
    do_check_eq(results.pets.duration,200);
  });

  yield PlacesInterestsStorage.getAllIFRs().then(results => {
    isIdentical(results.sort((a,b) => a.interest.localeCompare(b.interest))
                         ,[ {
                           "serverNamespace":"en/foo",
                           "interest":"cars",
                           "dateUpdated":5000,
                           "ifr":{"a":1},
                           "serverId":1
                          },
                          {
                            "serverNamespace":"en/foo",
                            "interest":"pets",
                            "dateUpdated":5000,
                            "ifr":[{"domains":["pets.com"]}],
                            "serverId":2
                           }],true);
  });

  // try out the deletion of IFRs, this last flag will force deletion of rules
  // no mentioned in IFR, whose timestamp is less 7000
  yield iServiceObject._processServerNamespace("en/foo",7000,enIFR1,true);

  yield PlacesInterestsStorage.getAllIFRs().then(results => {
    isIdentical(results ,[ {
                           "serverNamespace":"en/foo",
                           "interest":"cars",
                           "dateUpdated":7000,
                           "ifr":{"a":1},
                           "serverId":1
                          }]);
  });
});
