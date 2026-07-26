/* =====================================================================
 * functions/index.js — Cloud Functions for role management
 * ---------------------------------------------------------------------
 * setUserRole: manager-only callable that sets the `role` custom claim on
 * a user (looked up by email). Called from the in-app Users & Roles screen.
 *
 * Custom claims CANNOT be set from client code — they require the Admin SDK,
 * which is why this runs as a Cloud Function (or the admin/ script).
 *
 * Deploy:  firebase deploy --only functions
 * (Requires the Blaze pay-as-you-go plan for outbound Admin SDK usage.)
 * ===================================================================== */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const ROLES = ['manager', 'specialist', 'warehouse', 'finance'];

exports.setUserRole = functions.https.onCall(async (data, context) => {
  // Only an authenticated manager may assign roles.
  if (!context.auth || context.auth.token.role !== 'manager') {
    throw new functions.https.HttpsError('permission-denied', 'Only a Procurement Manager can assign roles.');
  }
  const email = (data && data.email || '').trim();
  const role = data && data.role;
  if (!email) throw new functions.https.HttpsError('invalid-argument', 'email is required.');
  if (!ROLES.includes(role)) throw new functions.https.HttpsError('invalid-argument', 'Unknown role: ' + role);

  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch (e) {
    throw new functions.https.HttpsError('not-found', 'No user with email ' + email + ' (they must sign in once first).');
  }

  await admin.auth().setCustomUserClaims(user.uid, { role: role });
  // Optional: keep a mirror doc for auditing / listing (rules restrict to manager).
  await admin.firestore().collection('meta').doc('roles_' + user.uid).set({
    email: email, role: role, uid: user.uid, updatedAt: new Date().toISOString(),
    updatedBy: context.auth.token.email || context.auth.uid
  }, { merge: true });

  return { message: 'Assigned "' + role + '" to ' + email + '. They must refresh their token (sign out/in or click refresh).' };
});
