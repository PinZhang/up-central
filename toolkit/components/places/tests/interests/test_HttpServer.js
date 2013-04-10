/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesInterestsStorage.jsm");
Cu.import("resource://testing-common/httpd.js");

function run_test() {
  startHttpServer();
  run_next_test();
}

function sendAndValidate(path,responseType,response,deferred) {
  let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
  xhr.onload = (function onload() {
      try {
        dump(path + " " + typeof xhr.response + " " + xhr.response + " " + xhr.responseType + "<---- \n");
        do_check_eq(xhr.responseType,responseType);
        if (xhr.responseType == "text") {
          do_check_eq(xhr.response,response);
        }
        else if (xhr.responseType == "json")  {
          do_check_eq(JSON.stringify(xhr.response),response);
        }
        deferred.resolve(xhr);
      } catch(e) {
        do_check_false(e);
        deferred.reject(e);
        throw e;
      }
  });
  xhr.onabort = xhr.onerror = xhr.ontimeout = (function handleFail() {
    deferred.reject(new Error("xmlhttprequest failed"));
  });
  try {
    xhr.open("GET", HTTP_BASE + path);
    xhr.responseType = responseType;
    //xhr.overrideMimeType("application/json");
    xhr.send();
  } catch (e) {
    do_check_false(e);
    deferred.reject(e);
  }
  return deferred.promise;
}

add_task(function test_BasicHttpServer() {
  createPathHandler("/hello","text/plain",function(request, response) {
    response.write("hello");
  });
  yield sendAndValidate("/hello","text","hello",Promise.defer());

  let jsonString = JSON.stringify({a:1});
  createJSONStringHandler("/jsonString",jsonString);
  yield sendAndValidate("/jsonString","json",jsonString,Promise.defer());

  createJSONStringHandler("/jsonCallback",function(request,response) jsonString);
  yield sendAndValidate("/jsonCallback","json",jsonString,Promise.defer());

  createJSONStringHandler("/readJsFile",function() {
    let binArray = readFileData(do_get_file("testdata_json.js"));
    jsonString = String.fromCharCode.apply(null, new Uint16Array(binArray));
    return jsonString;
  });
  yield sendAndValidate("/readJsFile","json",jsonString,Promise.defer());

  createReadJSONFileHandler("/readTestFile","testdata_json.js");
  yield sendAndValidate("/readTestFile","json",jsonString,Promise.defer());
});

add_task(function test_MultipleGetRequests() {
  let count = 1;
  createPathHandler("/getitPlain","text/plain",function(request, response) {
    response.write("hello " + count);
  });
  yield sendAndValidate("/getitPlain","text","hello 1",Promise.defer());
  count++;
  yield sendAndValidate("/getitPlain","text","hello 2",Promise.defer());
  count++;
  yield sendAndValidate("/getitPlain","text","hello 3",Promise.defer());

  let jsonString = JSON.stringify({a:1});
  createJSONStringHandler("/getitJSON",function(request,response) JSON.stringify({a:count}));
  yield sendAndValidate("/getitJSON","json",JSON.stringify({a:count}),Promise.defer());
  count++;
  yield sendAndValidate("/getitJSON","json",JSON.stringify({a:count}),Promise.defer());
  count++;
  yield sendAndValidate("/getitJSON","json",JSON.stringify({a:count}),Promise.defer());
});

add_task(function test_InterestServerAPI() {
  setUpInterestAPIHandlers();

  let jsonString = JSON.stringify(JSON.parse(readFileText("mozilla_general.js")));
  yield sendAndValidate("/api/v0/rules/en/mozilla_general","json",jsonString,Promise.defer());

});


add_task(function test_common_terminate() {
  // Stop the HTTP server.  this should be the last task registered
  yield stopHttpServer();
});
