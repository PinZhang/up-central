/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function test() {

  waitForExplicitFinish();
  Services.prefs.setBoolPref("interests.navigator.enabled", true);
  Services.prefs.setBoolPref("interests.enabled", true);
  Services.prefs.setCharPref("interests.userDomainWhitelist", "mochi.test");


  let windowsToClose = [];
  let tabsToClose = [];
  let unPrivilegedPage =
    "http://example.com/tests/toolkit/components/places/tests/browser/video-games.html";
  let whitelistedPage =
    "http://mochi.test:8888/tests/toolkit/components/places/tests/browser/cars.html";

  registerCleanupFunction(function() {
    windowsToClose.forEach(function(aWin) {
      aWin.close();
    });
    tabsToClose.forEach(function(aTab) {
      gBrowser.removeTab(aTab);
    });
  });

  function loadURLIntoWindow(aOptions,aURL,aWin,aWindowLoadedCallback) {
    let deferred = Promise.defer();
    executeSoon(function() {
      aWin.gBrowser.selectedBrowser.addEventListener("DOMContentLoaded", function onDOMLoad() {
        aWin.gBrowser.selectedBrowser.removeEventListener("DOMContentLoaded", onDOMLoad, true);
        deferred.resolve(aWin);
      });
      if (aWindowLoadedCallback) {
        aWindowLoadedCallback(aWin);
      }
      aWin.content.location.href = aURL;
      //aWin.gBrowser.selectedBrowser.loadURI(aURL);
    });
    return deferred.promise;
  }

  function testGetInterestsAPI() {
    // things that should happen in a non-whitelisted page
    loadURLIntoSeparateWindow({private: false}, unPrivilegedPage).then(aWindow => {
      windowsToClose.push(aWindow);
      is(aWindow.content.location.href, unPrivilegedPage, "must be unprivileged page");
      aWindow.content.navigator.interests.getInterests(["cars"]).then(ints => {
        // if we end up here - it's an error
        of(false, "getInterests were accessible on an unprivileged page");
      },
      error => {
        ok(error != null, "correctly see error when accessing getInterests from an unprivileged page");
      });
      aWindow.content.navigator.interests.getTopInterests(5).then(ints => {
        // we should see two interest - "cars" and "video-games"
        is(ints.length,2,"array of ints must be 2 ints");
        ok(ints[0].name == "cars" ||  ints[0].name == "video_games", "first interest must be cars or video-games please");
        ok(ints[1].name == "cars" ||  ints[1].name == "video_games", "second interest must be cars or video-games please");
        promiseClearHistoryAndInterests().then(finish);
      },
      error => {
        of(false, "interests must be accessible in whitelisted page");
      });
      aWindow.content.navigator.interests.getTopInterests(6).then(ints => {
        // if we end up here - it's an error
        of(false, "getTopInterests > 5 were accessible on an unprivileged page");
      },
      error => {
        ok(error != null, "correctly see error when accessing getTopInterests > 5 from an unprivileged page");
      });
    });

    // things that should happen in a whitelisted page
    loadURLIntoSeparateWindow({private: false}, whitelistedPage).then(aWindow => {
      windowsToClose.push(aWindow);
      is(aWindow.content.location.href, whitelistedPage, "must be a whitelisted page");
      aWindow.content.navigator.interests.getInterests(["cars"]).then(ints => {
        is(ints.length,1,"array of ints must be 1 int");
        ok(ints[0].name == "cars", "interest must be cars");
        promiseClearHistoryAndInterests().then(finish);
      },
      error => {
        of(false, "interests must be accessible in whitelisted page");
      });
      aWindow.content.navigator.interests.getTopInterests(6).then(ints => {
        // we should see two interest - "video-games" and "cars"
        is(ints.length,2,"array of ints must be 2 ints");
        ok(ints[0].name == "cars" || ints[0].name == "video_games", "first interest must be cars or video-games please");
        ok(ints[1].name == "cars" ||  ints[1].name == "video_games", "second interest must be cars or video-games please");
        promiseClearHistoryAndInterests().then(finish);
      },
      error => {
        of(false, "interests must be accessible in whitelisted page");
      });
    });

    // behavior when switching pages in the same tab
    loadURLIntoSeparateWindow({private: false}, whitelistedPage).then(aWindow => {
      windowsToClose.push(aWindow);
      is(aWindow.content.location.href, whitelistedPage, "must be a whitelisted page");
      aWindow.content.navigator.interests.getInterests(["cars"]).then(ints => {
        promiseClearHistoryAndInterests().then(finish);
      },
      error => {
        of(false, "interests must be accessible in whitelisted page");

      }).then(loadURLIntoWindow({}, unPrivilegedPage, aWindow)).then(() => {
        // switched to a non-whitelisted page
        is(aWindow.content.location.href, unPrivilegedPage, "must be unprivileged page");
        aWindow.content.navigator.interests.getInterests(["cars"]).then(ints => {
          // if we end up here - it's an error
          of(false, "getInterests were accessible on an unprivileged page");
        },
        error => {
          ok(error != null, "correctly see error when accessing getInterests from an unprivileged page");
        });
      }).then(loadURLIntoWindow({}, whitelistedPage, aWindow)).then(() => {
        // switched back to whitelisted page
        is(aWindow.content.location.href, whitelistedPage, "must be a whitelisted page");
        aWindow.content.navigator.interests.getInterests(["cars"]).then(ints => {
          promiseClearHistoryAndInterests().then(finish);
        },
        error => {
          of(false, "interests must be accessible in whitelisted page");
        });
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
      tabsToClose.push(gBrowser.addTab(unPrivilegedPage));
      tabsToClose.push(gBrowser.addTab(whitelistedPage));
    }) // end of "cars" then
  ); // end of "video_games then
} // end of test
