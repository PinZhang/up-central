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

  yield PlacesInterestsStorage.setServerNamespace("en/foo",0);
  yield PlacesInterestsStorage.setServerNamespace("en/foo",1000);
  yield PlacesInterestsStorage.setServerNamespace("en/foo",2000);

  yield PlacesInterestsStorage.setServerNamespace("de/abs",1000);
  yield PlacesInterestsStorage.setServerNamespace("de/abs",3000);
  // Explicitly query for the id because it's not exposed through APIs
  let stmt = PlacesInterestsStorage._db.createStatement(
    "SELECT id, serverNamespace, lastModified FROM moz_interests_namespaces ORDER BY id ASC");

  try {
    stmt.executeStep();
    do_check_eq(stmt.row.id, 1);
    do_check_eq(stmt.row.serverNamespace, "en/foo");
    do_check_eq(stmt.row.lastModified, 2000);

    stmt.executeStep();
    do_check_eq(stmt.row.id, 2);
    do_check_eq(stmt.row.serverNamespace, "de/abs");
    do_check_eq(stmt.row.lastModified, 3000);
  }
  finally {
    stmt.finalize();
  }

});


add_task(function test_setInterestIFR() {
  yield PlacesInterestsStorage.clearServerNamespaces();

  yield PlacesInterestsStorage.getServerNamespaces().then(results => {
    do_check_eq(results.length,0);
  });

  // add namespace
  yield PlacesInterestsStorage.setServerNamespace("en/foo",1000);
  yield PlacesInterestsStorage.getServerNamespaces().then(results => {
    do_check_eq(results.length,1);
    do_check_eq(results[0].id,1);
    do_check_eq(results[0].serverNamespace,"en/foo");
    do_check_eq(results[0].lastModified,1000);
  });

  yield addInterest("cars");
  yield PlacesInterestsStorage.setInterestIFR("en/foo","cars",2000,{a:1});
  yield PlacesInterestsStorage.getAllInterestIFRs().then(results => {
    do_check_eq(results.length,1);
    do_check_eq(results[0].interest,"cars");
    do_check_eq(results[0].serverNamespace,"en/foo");
    do_check_eq(results[0].dateUpdated,2000);
    do_check_eq(JSON.stringify(results[0].ifr),JSON.stringify({a:1}));
  });

  yield PlacesInterestsStorage.setInterestIFR("en/foo","cars",3000,{b:2});
  yield PlacesInterestsStorage.getAllInterestIFRs().then(results => {
    do_check_eq(results.length,1);
    do_check_eq(results[0].interest,"cars");
    do_check_eq(results[0].serverNamespace,"en/foo");
    do_check_eq(results[0].dateUpdated,3000);
    do_check_eq(JSON.stringify(results[0].ifr),JSON.stringify({b:2}));
  });

  yield PlacesInterestsStorage.setServerNamespace("de/foo",1000);
  yield PlacesInterestsStorage.setInterestIFR("de/foo","cars",null,{a:1});
  yield PlacesInterestsStorage.getAllInterestIFRs().then(results => {
    do_check_eq(results.length,2);
    do_check_eq(results[0].interest,"cars");
    do_check_eq(results[0].serverNamespace,"en/foo");
    do_check_eq(results[0].dateUpdated,3000);
    do_check_eq(JSON.stringify(results[0].ifr),JSON.stringify({b:2}));

    do_check_eq(results[1].interest,"cars");
    do_check_eq(results[1].serverNamespace,"de/foo");
    do_check_true(results[1].dateUpdated - Date.now() > -5000);
    do_check_eq(JSON.stringify(results[1].ifr),JSON.stringify({a:1}));
  });

  yield PlacesInterestsStorage.deleteInterestIFR("de/foo","cars");
  yield PlacesInterestsStorage.getAllInterestIFRs().then(results => {
    do_check_eq(results.length,1);
    do_check_eq(results[0].interest,"cars");
    do_check_eq(results[0].serverNamespace,"en/foo");
    do_check_eq(results[0].dateUpdated,3000);
    do_check_eq(JSON.stringify(results[0].ifr),JSON.stringify({b:2}));
  });
  yield PlacesInterestsStorage.setInterestIFR("de/foo","cars",null,{a:1});
  yield PlacesInterestsStorage.getAllInterestIFRs().then(results => do_check_eq(results.length,2));
  yield PlacesInterestsStorage.clearServerNamespace("de/foo");
  yield PlacesInterestsStorage.getAllInterestIFRs().then(results => do_check_eq(results.length,1));
  yield PlacesInterestsStorage.clearServerNamespaces();

  //all tables must be empty now
  ["moz_interests_ifr",
    "moz_interests_namespaces",
    "moz_interests_hosts",
    "moz_interests_visits",
    "moz_interests" ].forEach(table => do_check_eq(get_rowscount_in_table(table),0));

});

add_task(function test_setInterestIFR() {
});

