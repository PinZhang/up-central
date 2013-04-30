/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Cu.import("resource://gre/modules/Services.jsm");

let iServiceObject = Cc["@mozilla.org/places/interests;1"].getService(Ci.nsISupports).wrappedJSObject;

function checkHost(spec, host) {
  let uri = Services.io.newURI(spec, null, null);
  do_check_eq(iServiceObject._getPlacesHostForURI(uri), host);
}

function run_test() {
  // Check plain domains
  checkHost("http://mozilla.com", "mozilla.com");
  checkHost("https://mozilla.com", "mozilla.com");

  // Check www. domains
  checkHost("http://www.mozilla.org", "mozilla.org");
  checkHost("https://www.mozilla.org", "mozilla.org");

  // Check subdomain
  checkHost("http://support.mozilla.org", "support.mozilla.org");
  checkHost("https://support.mozilla.org", "support.mozilla.org");

  // Check domains with path
  checkHost("http://mozilla.com/plugincheck", "mozilla.com");
  checkHost("https://mozilla.com/plugincheck", "mozilla.com");

  // Check non-hosts
  checkHost("about:profile", "");
  checkHost("about:config", "");
}
