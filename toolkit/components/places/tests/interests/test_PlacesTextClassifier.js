/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");

let iServiceObject = Cc["@mozilla.org/places/interests;1"].getService(Ci.nsISupports).wrappedJSObject;
let iServiceApi = Cc["@mozilla.org/InterestsWebAPI;1"].createInstance(Ci.mozIInterestsWebAPI)
let obsereverService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);

let deferEnsureResults;

function run_test() {
  run_next_test();
}

// the test array 
let defaultMatchTests = [
  {
    info: "DefaultTextClassifier Test 1: polygon",
    url:  "http://www.polygon.com/2013/3/5/4066808/thief-screenshots-leak-next-gen",
    title: "Rumored images for new Thief game leak, reportedly in the works on next-gen platforms",
    expectedInterests:  {"video-games": 1}
  }
];

add_task(function test_default_model_match() {
  delete iServiceObject.__worker;
  let worker = iServiceObject._worker;
  // there variables are need to set up array of tests
  let expectedInterests;

  worker.removeEventListener("message", iServiceObject, false); 

  let workerTester = {
    handleEvent: function(aEvent) {
      if (aEvent.type == "message") {
        let msgData = aEvent.data;
        if (msgData.message == "InterestsForDocumentText") {
          // make sure that categorization is correct
          let host = msgData.host;
          let interests = msgData.interests;
          let interestCount = 0;
          for (let interest of interests) {
            do_check_true(expectedInterests[interest] == 1);
            interestCount ++;
          }
          do_check_eq(interestCount, Object.keys(expectedInterests).length);
          deferEnsureResults.resolve();
        }
        else if (msgData.message == "InterestsForDocumentRules") {
          // make sure rule-based classification did not happen
          do_print("interests are: " + msgData.interests);
          do_check_eq(0, msgData.interests.length);
        }
        else if (!(msgData.message in kValidMessages)) {
          // unexpected message
          do_throw("ERROR_UNEXPECTED_MSG: " + msgData.message);
        }
      }
      else {
        do_throw("ERROR_UNEXPECTED_MSG_TYPE" + aEvent.type);
      }
    } // end of handleEvent
  };

  worker.addEventListener("message", workerTester , false);

  for (let test of defaultMatchTests) {
    do_print(test.info);
    let uri = NetUtil.newURI(test.url);
    let title = test.title;
    let host = uri.host;
    let path = uri.path;
    let tld = Services.eTLD.getBaseDomainFromHost(host)

    expectedInterests = test.expectedInterests;
    worker.postMessage({
      message: "getInterestsForDocumentText",
      host: host,
      path: path,
      title: title,
      url: test.url,
      tld: tld
    });
    worker.postMessage({
      message: "getInterestsForDocumentRules",
      host: host,
      path: path,
      title: title,
      url: test.url,
      tld: tld
    });

    deferEnsureResults = Promise.defer();
    yield deferEnsureResults.promise;
  }
});

let riggedMatchTests = [
  {
    interestsClassifierModel: {
      logPriors: [0.5, 0.5].map(Math.log),
      logLikelihoods: {

        foo: [0.8, 0.2].map(Math.log),
        qux: [0.8, 0.2].map(Math.log),
        quux: [0.8, 0.2].map(Math.log),

        bar: [0.2, 0.8].map(Math.log),
        baz: [0.2, 0.8].map(Math.log),
        xyzzy: [0.2, 0.8].map(Math.log),
      },
      classes: {
        0: "foo",
        1: "bar",
      }
    },
    tests: [
      {
        info: "RiggedTextClassifier Test 1: foo",
        url:  "http://example.com/testing/foo/qux",
        title: "biz baz quux",
        expectedInterests:  {"foo": 1}
      },
      {
        info: "RiggedTextClassifier Test 2: bar",
        url:  "http://example.com/testing/bar/baz",
        title: "qux biz xyzzy",
        expectedInterests:  {"bar": 1}
      },
      {
        info: "RiggedTextClassifier Test 3: both equally likely",
        url:  "http://example.com/testing/foo/qux",
        title: "bar baz",
        expectedInterests:  {"foo": 1, "bar": 1}
      },
      {
        info: "RiggedTextClassifier Test 4: no tokens",
        url:  "http://example.com/testing/",
        title: "no significant keyword",
        expectedInterests:  {}
      },
      {
        info: "RiggedTextClassifier Test 5: not enough tokens",
        url:  "http://example.com/testing/foo/bar",
        title: "not enough tokens",
        expectedInterests:  {}
      }
    ]
  }
];

add_task(function test_text_classification() {
  delete iServiceObject.__worker;
  let worker = iServiceObject._worker;

  for (let modelTests of riggedMatchTests) {
    // bootstrap with model
    worker.removeEventListener("message", iServiceObject, false); 
    let verifyBootstrap = {
      handleEvent: function(aEvent) {
        if (aEvent.type == "message") {
          let msgData = aEvent.data;
          if (msgData.message == "bootstrapComplete") {
            do_check_true(true);
            deferEnsureResults.resolve();
          }
        }
        else if (!(msgData.message in kValidMessages)) {
          do_throw("ERROR_UNEXPECTED_MSG_TYPE" + aEvent.type);
        }
      }
    }
    worker.addEventListener("message", verifyBootstrap, false); 
    worker.postMessage({
      message: "bootstrap",
      interestsData: {},
      interestsDataType: "",
      interestsClassifierModel: modelTests.interestsClassifierModel,
      interestsUrlStopwords: {}
    });
    deferEnsureResults = Promise.defer();
    yield deferEnsureResults.promise;
    worker.removeEventListener("message", verifyBootstrap, false); 

    // test classification
    let expectedInterests;

    let workerTester = {
      handleEvent: function(aEvent) {
       if (aEvent.type == "message") {
        let msgData = aEvent.data;
        if (msgData.message == "InterestsForDocumentText") {
          // make sure that categorization is correct 
          let host = msgData.host;
          let interests = msgData.interests;
          let interestCount = 0;
          for (let interest of interests) {
              do_check_eq(1, expectedInterests[interest]);
              interestCount ++;
          } 
          do_check_eq(interestCount, Object.keys(expectedInterests).length);

          deferEnsureResults.resolve();
        }
        else if (!(msgData.message in kValidMessages)) {
            // unexpected message
            do_throw("ERROR_UNEXPECTED_MSG: " + msgData.message);
        }
       }
       else {
        do_throw("ERROR_UNEXPECTED_MSG_TYPE" + aEvent.type);
       }
      } // end of handleEvent
    };
    worker.addEventListener("message", workerTester , false);

    for (let test of modelTests.tests) {
      do_print(test.info);
      let uri = NetUtil.newURI(test.url);
      let title = test.title;
      let host = uri.host;
      let path = uri.path;
      let tld = Services.eTLD.getBaseDomainFromHost(host)

      expectedInterests = test.expectedInterests;

      worker.postMessage({
        message: "getInterestsForDocumentText",
        host: host,
        path: path,
        title: title,
        url: test.url,
        tld: tld
      });

      deferEnsureResults = Promise.defer();
      yield deferEnsureResults.promise;
    }
  }
});
