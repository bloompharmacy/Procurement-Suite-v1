/* =====================================================================
 * auth.js — Firebase Google Authentication  (NEW)
 * ---------------------------------------------------------------------
 * Gates the cloud app behind Google sign-in so Firestore rules can require
 * an authenticated user. In localStorage fallback mode (no real config)
 * auth is skipped entirely so offline development still works.
 *
 * Pure logic + state; the shell (app.js) owns the login DOM and subscribes
 * via onChange.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Auth = (function () {
  'use strict';

  var _user = null, _mode = 'local', _cbs = [], _initialised = false;

  function _configUsable() {
    var cfg = window.GPO_FIREBASE_CONFIG;
    return !!(cfg && cfg.apiKey && cfg.projectId &&
      cfg.apiKey.indexOf('YOUR_') !== 0 && cfg.apiKey !== 'PASTE_API_KEY');
  }

  // Returns true if running in cloud (auth-enabled) mode.
  function init() {
    if (_initialised) return _mode === 'cloud';
    _initialised = true;

    if (_configUsable() && window.firebase && firebase.auth) {
      try {
        if (!firebase.apps.length) firebase.initializeApp(window.GPO_FIREBASE_CONFIG);
        _mode = 'cloud';
        firebase.auth().onAuthStateChanged(function (u) {
          _user = u;
          _cbs.forEach(function (cb) { try { cb(u); } catch (e) {} });
        });
        return true;
      } catch (e) {
        console.error('[GPO.Auth] init failed, continuing offline', e);
      }
    }
    _mode = 'local';
    return false;
  }

  function signIn() {
    var provider = new firebase.auth.GoogleAuthProvider();
    return firebase.auth().signInWithPopup(provider).catch(function (e) {
      console.error('[GPO.Auth] sign-in error', e);
      alert('Sign-in failed: ' + (e && e.message ? e.message : e));
    });
  }

  function signOut() { return firebase.auth().signOut(); }

  function onChange(cb) { _cbs.push(cb); }
  function currentUser() { return _user; }
  function isCloud() { return _mode === 'cloud'; }

  return { init: init, signIn: signIn, signOut: signOut, onChange: onChange, currentUser: currentUser, isCloud: isCloud };
})();
