/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function test() {
  // initialization
  waitForExplicitFinish();
  Services.prefs.setBoolPref("interests.navigator.enabled", true);
  Services.prefs.setBoolPref("interests.enabled", true);

  let windowsToClose = [];
  let initialURL =
    "http://example.com/tests/toolkit/components/places/tests/browser/video-games.html";
  let finalURL =
    "http://example.com/tests/toolkit/components/places/tests/browser/cars.html";

  // This function is called after calling finish() on the test.
  registerCleanupFunction(function() {
    windowsToClose.forEach(function(aWin) {
      aWin.close();
    });
  });

  let observer = {
    observe: function(aSubject, aTopic, aData) {
      // The uri-visit-saved topic should only work on normal mode.
      if (aTopic == "interest-visit-saved") {
        // The expected event should come form finalURL because private mode
        // initialURL should not have registered an interest
        let url = aSubject.wrappedJSObject.url;

        // test that URL is NOT "private" initialURL
        ok(url != initialURL, "private mode url could not have generated interest");

        // otherwise check for finalURL
        is(url,finalURL, "url must be the final URL");

        // remove all observers since the private observer should never fire
        let enumerator = Services.obs.enumerateObservers("interest-visit-saved");
        while (enumerator.hasMoreElements()) {
          Services.obs.removeObserver(enumerator.getNext(), "interest-visit-saved");
        }
        // clear history and finish
        promiseClearHistoryAndInterests().then(finish);
      }
    }
  };

  Services.obs.addObserver(observer, "interest-visit-saved", false);

  // open the first window in private mode and the second in normal mode
  loadURLIntoSeparateWindow({private: true},initialURL).then(aWin => {
    windowsToClose.push(aWin);
    is(aWin.content.location.href, initialURL, "Must be initial url");
    loadURLIntoSeparateWindow({private: false},finalURL).then(aWin => {
      is(aWin.content.location.href, finalURL, "Must be final url");
      windowsToClose.push(aWin);
    });
  });
}
