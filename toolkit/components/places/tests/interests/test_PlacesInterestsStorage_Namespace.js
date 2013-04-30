/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");

function run_test() {
  run_next_test();
}

add_task(function test_NamespaceLocaleInsert() {

  yield PlacesInterestsStorage.addNamespace("foo","en",0);
  yield PlacesInterestsStorage.addNamespace("foo","en",1000);
  yield PlacesInterestsStorage.addNamespace("foo","en",2000);

  yield PlacesInterestsStorage.addNamespace("abs","de",1000);
  yield PlacesInterestsStorage.addNamespace("abs","de",3000);
  // Explicitly query for the id because it's not exposed through APIs
  let stmt = PlacesInterestsStorage._db.createStatement(
    "SELECT id, namespace, locale, lastModified FROM moz_interests_namespaces ORDER BY id ASC");

  try {
    stmt.executeStep();
    do_check_eq(stmt.row.id, 1);
    do_check_eq(stmt.row.namespace, "foo");
    do_check_eq(stmt.row.locale, "en");
    do_check_eq(stmt.row.lastModified, 2000);

    stmt.executeStep();
    do_check_eq(stmt.row.id, 2);
    do_check_eq(stmt.row.namespace, "abs");
    do_check_eq(stmt.row.locale, "de");
    do_check_eq(stmt.row.lastModified, 3000);
  }
  finally {
    stmt.finalize();
  }

});


add_task(function test_addInterestIFR() {
  yield PlacesInterestsStorage.clearNamespaces();

  yield PlacesInterestsStorage.getNamespaces().then(results => {
    do_check_eq(results.length,0);
  });

  // add namespace
  yield PlacesInterestsStorage.addNamespace("foo","en",1000);
  yield PlacesInterestsStorage.getNamespaces().then(results => {
    do_check_eq(results.length,1);
    do_check_eq(results[0].id,1);
    do_check_eq(results[0].namespace,"foo");
    do_check_eq(results[0].locale,"en");
    do_check_eq(results[0].lastModified,1000);
  });

  yield addInterest("cars");
  yield PlacesInterestsStorage.addInterestIFR("cars","foo","en",2000,{a:1},61);
  yield PlacesInterestsStorage.getAllIFRs().then(results => {
    do_check_eq(results.length,1);
    do_check_eq(results[0].interest,"cars");
    do_check_eq(results[0].namespace,"foo");
    do_check_eq(results[0].locale,"en");
    do_check_eq(results[0].dateUpdated,2000);
    do_check_eq(JSON.stringify(results[0].ifr),JSON.stringify({a:1}));
    do_check_eq(results[0].serverId,61);
  });

  yield PlacesInterestsStorage.addInterestIFR("cars","foo","en",3000,{b:2},62);
  yield PlacesInterestsStorage.getAllIFRs().then(results => {
    do_check_eq(results.length,1);
    do_check_eq(results[0].interest,"cars");
    do_check_eq(results[0].namespace,"foo");
    do_check_eq(results[0].locale,"en");
    do_check_eq(results[0].dateUpdated,3000);
    do_check_eq(JSON.stringify(results[0].ifr),JSON.stringify({b:2}));
    do_check_eq(results[0].serverId,62);
  });

  yield PlacesInterestsStorage.addNamespace("foo","de",1000);
  yield PlacesInterestsStorage.addInterestIFR("cars","foo","de",null,{a:1},63);
  yield PlacesInterestsStorage.getAllIFRs().then(results => {
    do_check_eq(results.length,2);
    do_check_eq(results[0].interest,"cars");
    do_check_eq(results[0].namespace,"foo");
    do_check_eq(results[0].locale,"en");
    do_check_eq(results[0].dateUpdated,3000);
    do_check_eq(JSON.stringify(results[0].ifr),JSON.stringify({b:2}));
    do_check_eq(results[0].serverId,62);

    do_check_eq(results[1].interest,"cars");
    do_check_eq(results[1].namespace,"foo");
    do_check_eq(results[1].locale,"de");
    do_check_true(results[1].dateUpdated - Date.now() > -5000);
    do_check_eq(JSON.stringify(results[1].ifr),JSON.stringify({a:1}));
    do_check_eq(results[1].serverId,63);
  });

  yield PlacesInterestsStorage.deleteInterestIFR("foo","de","cars");
  yield PlacesInterestsStorage.getAllIFRs().then(results => {
    do_check_eq(results.length,1);
    do_check_eq(results[0].interest,"cars");
    do_check_eq(results[0].namespace,"foo");
    do_check_eq(results[0].locale,"en");
    do_check_eq(results[0].dateUpdated,3000);
    do_check_eq(JSON.stringify(results[0].ifr),JSON.stringify({b:2}));
    do_check_eq(results[0].serverId,62);
  });
  yield PlacesInterestsStorage.addInterestIFR("cars","foo","de",null,{a:1},63);
  yield PlacesInterestsStorage.getAllIFRs().then(results => do_check_eq(results.length,2));
  yield PlacesInterestsStorage.clearNamespace("foo","de");
  yield PlacesInterestsStorage.getAllIFRs().then(results => do_check_eq(results.length,1));
  yield PlacesInterestsStorage.clearNamespaces();

  //all tables must be empty now
  ["moz_interests_ifr",
    "moz_interests_namespaces",
    "moz_interests_hosts",
    "moz_interests_visits",
    "moz_interests" ].forEach(table => do_check_eq(get_rowscount_in_table(table),0));

});

add_task(function test_addInterestIFR() {
});

