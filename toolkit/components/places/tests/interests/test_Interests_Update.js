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
  startHttpServer();
  run_next_test();
}

let httpUpdateObject = {};

function setUpServerResponseForNamespace(serverNamespace) {
  createJSONPathHandler("/api/v0/rules/" + serverNamespace,
    function(request,response) {
      try {
        httpUpdateObject[serverNamespace].ifModifiedSince = request.hasHeader("If-Modified-Since") ?
                                                          request.getHeader("If-Modified-Since") :
                                                          undefined;
        let status = httpUpdateObject[serverNamespace].status || 200;
        let ifr = httpUpdateObject[serverNamespace].ifr || {};
        let lastModified = httpUpdateObject[serverNamespace].lastModified || 0;
        let message = httpUpdateObject[serverNamespace].message || "OK";
        response.setStatusLine("1.1" , status , message);
        // no cache on the client
        response.setHeader("Cache-Control", "no-cache, must-revalidate");
        if (lastModified) {
          response.setHeader("Last-Modified",
                             iServiceObject._miliSecondsToRFC2822(lastModified));
        }
        response.write(ifr);
      } catch (ex) {
        dump( ex + " ERROR in response\n");
      }
  });
}

let enIFR1 = {
  "en/foo:cars": {
    "matches" : [{"domains": ["ford.com"]}],
    "threshold" : 1,
    "duration" : 100,
  },
  "en/foo:pets": {
    "matches" : [{"domains": ["pets.com"]}],
    "threshold" : 20,
    "duration" : 200,
  }
};

add_task(function test_NamespaceUpdate() {

  let lastModifiedMiliSeconds = iServiceObject._RFC2822ToMilliSeconds("Tue, 15 Nov 1994 12:45:26 GMT");
  do_check_eq(lastModifiedMiliSeconds,784903526000);
  do_check_eq(iServiceObject._miliSecondsToRFC2822(784903526000),"Tue, 15 Nov 1994 12:45:26 GMT");
  yield PlacesInterestsStorage.setServerNamespace("en/foo",0);
  setUpServerResponseForNamespace("en/foo");

  httpUpdateObject["en/foo"] = {};
  httpUpdateObject["en/foo"].status = 200;
  httpUpdateObject["en/foo"].ifr = JSON.stringify(enIFR1);
  httpUpdateObject["en/foo"].lastModified = lastModifiedMiliSeconds;

  // make sure that we throw because Server URI has not been set yet
  yield iServiceObject._update().then(results => {
    do_check_true(results == null);
  },
  error => {
    do_check_eq(error,"Empty URI for Interest Update Server");
  });

  Services.prefs.setCharPref("interests.updateServerURI","http://localhost:4444")

  yield iServiceObject._update();

  // make sure If-Modified-Since arrived as expected
  do_check_eq(httpUpdateObject["en/foo"].ifModifiedSince,undefined);

  yield PlacesInterestsStorage.getInterests(["pets", "cars"]).then(results => {
    do_check_eq(results.cars.threshold,1);
    do_check_eq(results.cars.duration,100);
    do_check_eq(results.pets.threshold,20);
    do_check_eq(results.pets.duration,200);
  });

  yield PlacesInterestsStorage.getAllInterestIFRs().then(results => {
    isIdentical(results,[ {
                           "serverNamespace":"en/foo",
                           "interest":"cars",
                           "dateUpdated":784903526000,
                           "ifr":[{"domains":["ford.com"]}],
                          },
                          {
                            "serverNamespace":"en/foo",
                            "interest":"pets",
                            "dateUpdated":784903526000,
                            "ifr":[{"domains":["pets.com"]}],
                           }]);
  });

  delete enIFR1["en/foo:pets"];
  enIFR1["en/foo:cars"].matches = {"a":1};
  enIFR1["en/foo:cars"].threshold = 11;
  enIFR1["en/foo:cars"].duration = 110;

  lastModifiedMiliSeconds = iServiceObject._RFC2822ToMilliSeconds("Wed, 16 Nov 1994 12:45:27 GMT");
  do_check_eq(lastModifiedMiliSeconds,784989927000);
  do_check_eq(iServiceObject._miliSecondsToRFC2822(784989927000),"Wed, 16 Nov 1994 12:45:27 GMT");

  httpUpdateObject["en/foo"].status = 206;
  httpUpdateObject["en/foo"].ifr = JSON.stringify(enIFR1);
  httpUpdateObject["en/foo"].lastModified = lastModifiedMiliSeconds;

  yield iServiceObject._update();

  // make sure the namespace update date is 5000
  yield PlacesInterestsStorage.getServerNamespaces().then(results => {
    do_check_eq(results[0].serverNamespace,"en/foo");
    do_check_eq(results[0].lastModified,784989927000);
  });

  yield PlacesInterestsStorage.
    getInterests(["pets","cars"]).then(results => {
    do_check_eq(results.cars.threshold,11);
    do_check_eq(results.cars.duration,110);
    do_check_eq(results.pets.threshold,20);
    do_check_eq(results.pets.duration,200);
  });

  yield PlacesInterestsStorage.
    getAllInterestIFRs().then(results => {
    isIdentical(results.sort((a,b) => a.interest.localeCompare(b.interest))
                         ,[ {
                           "serverNamespace":"en/foo",
                           "interest":"cars",
                           "dateUpdated":784989927000,
                           "ifr":{"a":1},
                          },
                          {
                            "serverNamespace":"en/foo",
                            "interest":"pets",
                            "dateUpdated":784989927000,
                            "ifr":[{"domains":["pets.com"]}],
                           }],true);
  });

  // test 200 that should cause deletion of non-existent rules
  lastModifiedMiliSeconds = iServiceObject._RFC2822ToMilliSeconds("Wed, 16 Nov 1994 13:45:28 GMT");
  do_check_eq(lastModifiedMiliSeconds,784993528000);
  do_check_eq(iServiceObject._miliSecondsToRFC2822(784993528000),"Wed, 16 Nov 1994 13:45:28 GMT");

  httpUpdateObject["en/foo"].status = 200;
  httpUpdateObject["en/foo"].ifr = JSON.stringify(enIFR1);
  httpUpdateObject["en/foo"].lastModified = lastModifiedMiliSeconds;

  yield iServiceObject._update();

  // try out the deletion of IFRs, this last flag will force deletion of rules
  // no mentioned in IFR, whose timestamp is less 7000
  yield PlacesInterestsStorage.getAllInterestIFRs().then(results => {
    isIdentical(results ,[ {
                           "serverNamespace":"en/foo",
                           "interest":"cars",
                           "dateUpdated":784993528000,
                           "ifr":{"a":1},
                          }]);
  });

  // test 304,400, and 404 codes - they all should be ignored
  [304,400,404].forEach(function(code) {
    httpUpdateObject["en/foo"].status = code;
    yield iServiceObject._update();
    yield PlacesInterestsStorage.getAllInterestIFRs().then(results => {
      isIdentical(results ,[ {
                             "serverNamespace":"en/foo",
                             "interest":"cars",
                             "dateUpdated":784993528000,
                             "ifr":{"a":1},
                            }]);
    });
  });

  // test namespace deletion
  httpUpdateObject["en/foo"].status = 410;
  yield iServiceObject._update();
  // now results should just empty
  yield PlacesInterestsStorage.getAllInterestIFRs().then(results => {
    isIdentical(results ,[]);
  });


});

add_task(function test_common_terminate() {
  // Stop the HTTP server.  this should be the last task registered
  yield stopHttpServer();
});
