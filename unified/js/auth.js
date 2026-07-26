/* =====================================================================
 * auth.js — Firebase Google Authentication + role claims  (NEW)
 * ---------------------------------------------------------------------
 * Gates the cloud app behind Google sign-in and reads the user's ROLE from
 * a Firebase Auth custom claim (set server-side — see functions/ and
 * admin/set-role.js). In localStorage fallback mode auth is skipped so
 * offline development still works.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Auth = (function () {
  'use strict';

  var _user = null, _role = null, _claims = null, _mode = 'local', _cbs = [], _initialised = false;

  function _configUsable() {
    var cfg = window.GPO_FIREBASE_CONFIG;
    return !!(cfg && cfg.apiKey && cfg.projectId &&
      cfg.apiKey.indexOf('YOUR_') !== 0 && cfg.apiKey !== 'PASTE_API_KEY');
  }

  function _fire() { _cbs.forEach(function (cb) { try { cb(_user); } catch (e) {} }); }

  // Resolve the role claim from the current ID token, then notify.
  function _resolveClaims(u, forceRefresh) {
    if (!u) { _user = null; _role = null; _claims = null; _fire(); return; }
    u.getIdTokenResult(!!forceRefresh).then(function (res) {
      _user = u; _claims = res.claims || {}; _role = _claims.role || null; _fire();
    }).catch(function (e) {
      console.error('[GPO.Auth] claim read failed', e);
      _user = u; _claims = {}; _role = null; _fire();
    });
  }

  function init() {
    if (_initialised) return _mode === 'cloud';
    _initialised = true;

    if (_configUsable() && window.firebase && firebase.auth) {
      try {
        if (!firebase.apps.length) firebase.initializeApp(window.GPO_FIREBASE_CONFIG);
        _mode = 'cloud';
        firebase.auth().onAuthStateChanged(function (u) { _resolveClaims(u, false); });
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

  // Force a token refresh to pick up a newly-assigned role without re-login.
  function refreshClaims() {
    var u = firebase.auth().currentUser;
    if (u) _resolveClaims(u, true);
  }

  function onChange(cb) { _cbs.push(cb); }
  function currentUser() { return _user; }
  function role() { return _role; }
  function claims() { return _claims; }
  function isCloud() { return _mode === 'cloud'; }

  return {
    init: init, signIn: signIn, signOut: signOut, refreshClaims: refreshClaims,
    onChange: onChange, currentUser: currentUser, role: role, claims: claims, isCloud: isCloud
  };
})();
