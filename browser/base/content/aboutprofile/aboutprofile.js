/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

const interestService = Cc["@mozilla.org/interests;1"].getService(Ci.nsISupports).wrappedJSObject;
const prefs = new Preferences("interests.");
const kPrefWebAPIEnabled = "interests.navigator.enabled";
const kPermChanged = "perm-changed";
const kPermInterestType = "interests";

let userProfileWrapper = {
  init: function () {
    userProfileWrapper.refreshPagePayload();

    let iframe = document.getElementById("remote-dashboard");
    iframe.addEventListener("load", userProfileWrapper.initRemotePage, false);
    let dashboard = this._getReportURI();
    iframe.src = dashboard.spec;
    prefs.observe("enabled", this.updatePrefState, userProfileWrapper);
    Services.obs.addObserver(this,kPermChanged,false);
  },

  uninit: function () {
    prefs.ignore("enabled", this.updatePrefState, userProfileWrapper);
    Services.obs.removeObserver(this, kPermChanged);
  },

  observe: function I_observe(aSubject, aTopic, aData) {
    if (aTopic == kPermChanged) {
      let permission = aSubject.QueryInterface(Ci.nsIPermission)
      if (permission.type == kPermInterestType) {
        this.injectData("sitePref",
          {
            site: permission.host,
            isBlocked: interestService.isSiteBlocked(permission.host),
          }
        );
      }
    }

  },

  _getReportURI: function () {
    let url = Services.urlFormatter.formatURLPref("interests.about.dashboardUrl");
    return Services.io.newURI(url, null, null);
  },

  setAPIPref: function (value) {
    //Services.prefs.setBoolPref(kPrefWebAPIEnabled, value);
    this.updatePrefState();
  },

  updatePrefState: function () {
    let enabled = false;

    this.injectData("prefs", {
      enabled: enabled
    });
  },

  refreshPagePayload: function (numInterestsProfile) {
    interestService.getPagePayload(numInterestsProfile).then(data => {
      userProfileWrapper.updatePayload("pageload", data);
    },
      userProfileWrapper.handlePayloadFailure);
  },

  /*
   * Update Interest sharable metadata
   * @param
   */
  setInterestSharable: function AP_setInterestSharable(data) {
    let [interest, value] = data;
    interestService.setInterestSharable(interest, value).then(
        x => {},
        e => {this.reportFailure(this.ERROR_METADATA_FAILED)}
    );
  },

  enableSite: function (site) {
    Services.perms.remove(site,"interests");
  },

  disableSite: function (site) {
    Services.perms.add(NetUtil.newURI("http://" + site),"interests",Services.perms.DENY_ACTION);
  },

  /*
   * Prepares and sends the data payload to the remote application
   *
   * @param     subtype
   *            Payload subtype for the application to handle appropriately
   * @param     data
   *            Data to be serialized and sent to the application
   */
  updatePayload: function AP_updatePayload(subtype, data) {
    let payload = {};
    payload.type = subtype;
    payload.content = data;
    userProfileWrapper.injectData("payload", payload);
  },

  /*
   * Injects data inside the remote application
   *
   * @param     type
   *            The type of message to send, e.g. "prefs" or "payload"
   * @param     content
   *            String data to be sent to the browser
   */
  injectData: function AP_injectData(type, content) {
    let report = this._getReportURI();

    // file URIs can't be used for targetOrigin, so we use "*" for this special case
    // in all other cases, pass in the URL to the report so we properly restrict the message dispatch
    let reportUrl = report.scheme == "file" ? "*" : report.spec;

    let data = {
      type: type,
      content: content
    }

    let iframe = document.getElementById("remote-dashboard");
    iframe.contentWindow.postMessage(data, reportUrl);
  },

  handleRemoteCommand: function handleRemoteCommand(evt) {
    switch (evt.detail.command) {
      case "DisableAPI":
        this.setAPIPref(false);
        break;
      case "EnableAPI":
        this.setAPIPref(true);
        break;
      case "RequestCurrentPrefs":
        this.updatePrefState();
        break;
      case "RequestCurrentPagePayload":
        this.refreshPagePayload(evt.detail.data);
        break;
      case "EnableSite":
        this.enableSite(evt.detail.data);
        break;
      case "DisableSite":
        this.disableSite(evt.detail.data);
        break;
      case "SetInterestSharable":
        this.setInterestSharable(evt.detail.data);
      default:
        Cu.reportError("Unexpected remote command received: " + evt.detail.command + ". Ignoring command.");
        break;
    }
  },

  initRemotePage: function () {
    let iframe = document.getElementById("remote-dashboard").contentDocument;
    iframe.addEventListener("RemoteUserProfileCommand",
                            function onCommand(e) {userProfileWrapper.handleRemoteCommand(e);},
                            false);
    userProfileWrapper.updatePrefState();
  },

  // error handling
  ERROR_INIT_FAILED: 1,
  ERROR_PAYLOAD_FAILED: 2,
  ERROR_PREFS_FAILED: 3,
  ERROR_METADATA_FAILED: 4,

  reportFailure: function (error) {
    let details = {
      errorType: error,
    }
    userProfileWrapper.injectData("error", details);
  },

  handleInitFailure: function () {
    userProfileWrapper.reportFailure(userProfileWrapper.ERROR_INIT_FAILED);
  },

  handlePayloadFailure: function () {
    userProfileWrapper.reportFailure(userProfileWrapper.ERROR_PAYLOAD_FAILED);
  },
}
