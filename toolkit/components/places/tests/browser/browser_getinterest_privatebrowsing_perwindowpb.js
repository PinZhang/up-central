/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function test() {

  waitForExplicitFinish();
  Services.prefs.setBoolPref("interests.navigator.enabled", true);
  Services.prefs.setBoolPref("interests.enabled", true);


  let windowsToClose = [];
  let tabsToClose = [];
  let initialURL =
    "http://example.com/tests/toolkit/components/places/tests/browser/video-games.html";
  let finalURL =
    "http://example.com/tests/toolkit/components/places/tests/browser/cars.html";

  registerCleanupFunction(function() {
    windowsToClose.forEach(function(aWin) {
      aWin.close();
    });
    tabsToClose.forEach(function(aTab) {
      gBrowser.removeTab(aTab);
    });
  });

  function testGetInterestsAPI() {
    loadURLIntoSeparateWindow({private: true}, initialURL).then(aWindow => {
      windowsToClose.push(aWindow);
      is(aWindow.content.location.href, initialURL, "must be intital url");
      aWindow.content.navigator.interests.getTopInterests(5).then(ints => {
        // if we end up here - it's an error
        of(false, "interests were accessible in private mode");
      },
      error => {
        ok(error != null, "correctly see error when accessing interests in private mode");
      });
    });
    loadURLIntoSeparateWindow({private: false}, finalURL).then(aWindow => {
      windowsToClose.push(aWindow);
      is(aWindow.content.location.href, finalURL, "must be final url");
      aWindow.content.navigator.interests.getTopInterests(5).then(ints => {
        // we should see two interest - "cars" and "video-games"
        is(ints.length,2,"array of ints must be 2 ints");
        ok(ints[0].name == "cars" ||  ints[0].name == "video_games", "first interest must be cars or video-games please");
        ok(ints[1].name == "cars" ||  ints[1].name == "video_games", "second interest must be cars or video-games please");
        promiseClearHistoryAndInterests().then(finish);
      },
      error => {
        of(false, "interests must be accessible in private mode");
      });
    });
  };

  let interestVisitEvent = 0;
  let observer = {
    observe: function(aSubject, aTopic, aData) {
      // The uri-visit-saved topic should only work when on normal mode.
      if (aTopic == "interest-visit-saved") {
        interestVisitEvent ++;
        // if both intersts have been saved
        if (interestVisitEvent == 2) {
          // remove all observers
          let enumerator = Services.obs.enumerateObservers("interest-visit-saved");
          while (enumerator.hasMoreElements()) {
            Services.obs.removeObserver(enumerator.getNext(), "interest-visit-saved");
          }
          // test getting interests in  private and normal modes
          testGetInterestsAPI();
        }
      }
    }
  };

  Services.obs.addObserver(observer, "interest-visit-saved", false);

  // load two tabs with initial and final urls in them
  promiseAddInterest("video_games").then(() =>
    promiseAddInterest("cars").then(() => {
      tabsToClose.push(gBrowser.addTab(initialURL));
      tabsToClose.push(gBrowser.addTab(finalURL));
    }) // end of "cars" then
  ); // end of "video_games then
} // end of test
