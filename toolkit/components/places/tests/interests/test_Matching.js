/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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
let matchTests = [
{
  info: "Match Test 1 (Rules): mozilla.org",
  url:  "http://www.mozilla.org",
  title: "Hello World",
  expectedInterests:  {computers: 1}
},
{
  info: "Match Test 2 (Rules): weather gov",
  url:  "http://nws.noaa.gov",
  title: "Hello World",
  expectedInterests:  {government: 1, weather: 1, science: 1}
},
{
  info: "Match Test 3 (Text): polygon",
  url:  "http://www.polygon.com/2013/3/5/4066808/thief-screenshots-leak-next-gen",
  title: "Rumored images for new Thief game leak, reportedly in the works on next-gen platforms",
  expectedInterests:  {"video-games": 1}
},
{
  info: "Match Test 4 (Text): empty title",
  url:  "http://nosuchhost.com",
  title: null,
  expectedInterests: {}
},
{
  info: "Match Test 5 (Rules): mail.google.com exmaple",
  url:  "https://mail.google.com/mail/u/0/?ui=2&shva=1#inbox?compose=13e0005db4a0d0d4",
  title: "",
  expectedInterests: {}
},
{
  info: "Match Test 6 (Text): cars",
  url:  "https://nosuchsite.com/",
  title: "truck car automobile cars auto sedan",
  expectedInterests: {"cars": 1}
}
];
 

add_task(function test_default_matcher() {
  let worker = iServiceObject._worker;
  // there variables are need to set up array of tests
  let expectedInterests;

  worker.removeEventListener("message", iServiceObject, false); 

  let workerTester = {
    handleEvent: function(aEvent) {
     if (aEvent.type == "message") {
      let msgData = aEvent.data;
      if (msgData.message == "InterestsForDocument") {
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

  for (let test of matchTests) {
    do_print(test.info);
    let uri = NetUtil.newURI(test.url);
    let title = test.title;
    let host = uri.host;
    let path = uri.path;
    let tld = Services.eTLD.getBaseDomainFromHost(host)

    expectedInterests = test.expectedInterests;
    worker.postMessage({
      message: "getInterestsForDocument",
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
