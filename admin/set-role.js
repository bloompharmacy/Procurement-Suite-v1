/* =====================================================================
 * admin/set-role.js — bootstrap / assign roles WITHOUT deploying Functions
 * ---------------------------------------------------------------------
 * Runs locally with the Admin SDK and a service-account key. Use it to make
 * yourself the first manager, then manage everyone else from the in-app
 * Users & Roles screen (or keep using this script).
 *
 * SETUP (once):
 *   1. Firebase console → Project settings → Service accounts →
 *      "Generate new private key" → save as admin/serviceAccountKey.json
 *      ⚠ This file IS a secret — it is git-ignored; never commit it.
 *   2. cd admin && npm install
 *
 * USAGE:
 *   node set-role.js you@email.com manager
 *   node set-role.js teammate@email.com specialist
 *   node set-role.js --list            # list all users and their roles
 *
 * The target user must have signed into the app at least once (so their
 * Auth account exists). After assignment they must sign out/in (or click
 * "refresh") to pick up the new role in their ID token.
 * ===================================================================== */
const admin = require('firebase-admin');
const path = require('path');

let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
} catch (e) {
  console.error('Missing admin/serviceAccountKey.json — see the SETUP notes at the top of this file.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const ROLES = ['manager', 'specialist', 'warehouse', 'finance'];

async function list() {
  let next;
  console.log('email\trole\tuid');
  do {
    const res = await admin.auth().listUsers(1000, next);
    res.users.forEach(u => console.log((u.email || '(no email)') + '\t' + ((u.customClaims && u.customClaims.role) || '(none)') + '\t' + u.uid));
    next = res.pageToken;
  } while (next);
}

async function main() {
  const arg1 = process.argv[2];
  if (arg1 === '--list') { await list(); return; }

  const email = arg1;
  const role = process.argv[3];
  if (!email || !ROLES.includes(role)) {
    console.error('Usage: node set-role.js <email> <' + ROLES.join('|') + '>');
    console.error('   or: node set-role.js --list');
    process.exit(1);
  }
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { role: role });
  console.log('✅ ' + email + ' → ' + role + ' (uid ' + user.uid + '). They must sign out/in to refresh the token.');
}

main().then(() => process.exit(0)).catch(e => { console.error('❌ ' + (e.message || e)); process.exit(1); });
