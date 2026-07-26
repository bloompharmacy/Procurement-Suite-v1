/* =====================================================================
 * firebase-config.js — Firebase project credentials
 * ---------------------------------------------------------------------
 * These web config values are NOT secret — Firebase web apps are meant to
 * ship this in client code. Real security comes from Firestore Rules +
 * Auth custom claims (see firestore.rules and functions/). Safe to commit.
 *
 * The app reads ONLY `window.GPO_FIREBASE_CONFIG`. The SDK is initialised
 * with the compat build inside store.js / auth.js — do NOT add ES-module
 * `import` statements here (this file is loaded as a classic <script>, so
 * an `import` would be a parse error and silently drop the whole config,
 * forcing the app into offline mode).
 *
 * If the values below are left as placeholders, the app runs on
 * localStorage (offline) so you can develop without an account.
 * ===================================================================== */
window.GPO_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBj1MvL8Y0GW8k54etYBsIkKko7fro4xC0",
  authDomain: "procurement-suite-v1.firebaseapp.com",
  projectId: "procurement-suite-v1",
  storageBucket: "procurement-suite-v1.firebasestorage.app",
  messagingSenderId: "369039619245",
  appId: "1:369039619245:web:ff279e126ea75e01824224"
};

/* =====================================================================
 * ⚠  OPEN TESTING MODE  —  TEMPORARY, REMOVE BEFORE PRODUCTION  ⚠
 * ---------------------------------------------------------------------
 * When true, ANY user who signs in with Google is treated as a full
 * "manager" in the app UI (no manual role assignment needed), and the
 * "Awaiting access" screen is bypassed. A red banner is shown so it's
 * obvious this is on.
 *
 * This ONLY relaxes the client. You MUST ALSO publish the matching open
 * rules (firestore.rules.testing) in the Firebase console, or writes will
 * still be rejected by the strict rules.
 *
 * TO REVERT to strict RBAC after testing:
 *   1. set this flag to false (or delete the line), and
 *   2. re-publish firestore.rules (the strict version) in the console.
 * ===================================================================== */
window.GPO_OPEN_TESTING = true;
