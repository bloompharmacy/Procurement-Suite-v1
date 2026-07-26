/* =====================================================================
 * rbac.js — Role-Based Access Control (client matrix)  (NEW)
 * ---------------------------------------------------------------------
 * Mirrors the four roles already modelled in the locked PRO-TRACK tool
 * (manager / specialist / warehouse / finance) so the new modules respect
 * the same permissions.
 *
 * IMPORTANT: this is the UX layer only. The AUTHORITATIVE enforcement lives
 * in Firestore Security Rules (firestore.rules), driven by the same role
 * stored as a Firebase Auth CUSTOM CLAIM. A user cannot bypass the rules by
 * editing this file — the server rejects unauthorised writes regardless.
 *
 * Roles come from GPO.Auth.role() (read from the ID-token claim). In offline
 * (localStorage) mode enforcement is OFF so solo development is unblocked.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.RBAC = (function () {
  'use strict';

  var ROLES = ['manager', 'specialist', 'warehouse', 'finance'];

  var LABEL = {
    manager: 'Procurement Manager', specialist: 'Procurement Specialist',
    warehouse: 'Warehouse Operator', finance: 'Finance Analyst'
  };

  // Which roles may WRITE each Firestore collection (must match firestore.rules).
  var WRITE = {
    suppliers: ['manager', 'specialist'],
    branches: ['manager', 'specialist'],
    sellout: ['manager', 'specialist', 'warehouse'],
    orders: ['manager', 'specialist', 'warehouse'],
    contracts: ['manager', 'specialist', 'finance'],
    offers: ['manager', 'specialist'],
    budgets: ['manager', 'finance'],
    meta: ['manager']
  };

  // Non-collection capabilities (feature gates).
  var CAP = {
    manageRoles: ['manager'],
    runBridge: ['manager', 'specialist'],
    exportData: ['manager', 'finance'],
    seedDemo: ['manager']
  };

  // Deny handler (app.js registers a toast). Called when a write is blocked.
  var _onDeny = null;
  function onDeny(fn) { _onDeny = fn; }
  function fireDeny(collection) { if (_onDeny) _onDeny(collection); }

  function enforce() { return !!(GPO.Auth && GPO.Auth.isCloud()); }

  // OPEN TESTING MODE (temporary): any signed-in user is treated as manager.
  // Controlled by window.GPO_OPEN_TESTING in firebase-config.js.
  function openTesting() { return !!window.GPO_OPEN_TESTING; }

  function role() {
    if (openTesting() && GPO.Auth && GPO.Auth.currentUser && GPO.Auth.currentUser()) return 'manager';
    return (GPO.Auth && GPO.Auth.role && GPO.Auth.role()) || null;
  }
  function isKnown() { return ROLES.indexOf(role()) >= 0; }
  function label(r) { return LABEL[r || role()] || 'Unassigned'; }

  function has(list) { var r = role(); return list && list.indexOf(r) >= 0; }

  // canWrite(collection): in offline mode always true; in cloud, per matrix.
  function canWrite(collection) {
    if (!enforce()) return true;
    return has(WRITE[collection] || []);
  }
  function can(capability) {
    if (!enforce()) return true;
    return has(CAP[capability] || []);
  }

  return {
    ROLES: ROLES, LABEL: LABEL, WRITE: WRITE, CAP: CAP,
    enforce: enforce, role: role, isKnown: isKnown, label: label,
    canWrite: canWrite, can: can, onDeny: onDeny, fireDeny: fireDeny,
    openTesting: openTesting
  };
})();
