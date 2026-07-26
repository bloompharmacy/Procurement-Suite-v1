/* =====================================================================
 * firebase-config.js — PLUG IN YOUR FIREBASE CREDENTIALS HERE
 * ---------------------------------------------------------------------
 * 1. Firebase console → Project settings → "Your apps" → Web app → Config.
 * 2. Copy the values below.
 * 3. Firebase console → Build → Firestore Database → Create database
 *    (start in *test mode* while developing; lock down with rules before
 *     going public — see SECURITY note at the bottom).
 *
 * NOTE: these web config values are NOT secret. Firebase web apps are meant
 * to ship this in client code; real security comes from Firestore RULES,
 * not from hiding this object. So it is safe to commit to a public repo.
 *
 * Until real values are filled in, the app automatically runs on
 * localStorage (offline mode) so you can develop without an account.
 * ===================================================================== */
window.GPO_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBj1MvL8Y0GW8k54etYBsIkKko7fro4xC0",
  authDomain: "procurement-suite-v1.firebaseapp.com",
  projectId: "procurement-suite-v1",
  storageBucket: "procurement-suite-v1.firebasestorage.app",
  messagingSenderId: "369039619245",
  appId: "1:369039619245:web:ff279e126ea75e01824224"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
