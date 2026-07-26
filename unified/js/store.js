/* =====================================================================
 * store.js — Unified Data Layer  (Firestore-backed + localStorage fallback)
 * ---------------------------------------------------------------------
 * Cloud database for the General Procurement Suite.
 *
 * DESIGN: every other module reads GPO.Store.all(...) SYNCHRONOUSLY, but
 * Firestore is async. So Store keeps a synchronous in-memory MIRROR of the
 * whole DB. init() loads all collections into the mirror and subscribes to
 * realtime onSnapshot updates; reads hit the mirror, writes go to Firestore
 * and optimistically update the mirror. => no other module needs changing.
 *
 * If Firebase config is absent/placeholder, Store transparently falls back
 * to localStorage so the app still runs before you plug in credentials.
 *
 * Tables (Firestore collections): suppliers, branches, sellout, orders,
 * contracts, offers, budgets. Plus a single meta doc: meta/app.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Store = (function () {
  'use strict';

  var LS_KEY = 'gpo_db';
  var COLLECTIONS = ['suppliers', 'branches', 'sellout', 'orders', 'contracts', 'offers', 'budgets'];
  var LISTENERS = [];

  var _db = null;          // synchronous in-memory mirror
  var _backend = 'local';  // 'local' | 'firestore'
  var _fs = null;          // firebase.firestore() handle
  var _ready = false;

  // ---- Canonical empty schema ---------------------------------------
  function emptyDb() {
    return {
      meta: { version: 2, currency: 'EGP', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      suppliers: [], branches: [], sellout: [], orders: [], contracts: [], offers: [], budgets: []
    };
  }

  // ---- Init ----------------------------------------------------------
  // Returns a Promise that resolves once the mirror is populated.
  function init() {
    var cfg = window.GPO_FIREBASE_CONFIG;
    var usable = cfg && cfg.apiKey && cfg.projectId &&
      cfg.apiKey.indexOf('YOUR_') !== 0 && cfg.apiKey !== 'PASTE_API_KEY';

    if (usable && window.firebase && firebase.firestore) {
      try {
        if (!firebase.apps.length) firebase.initializeApp(cfg);
        _fs = firebase.firestore();
        _backend = 'firestore';
        return _loadFirestore().then(function () { _ready = true; return _db; });
      } catch (e) {
        console.error('[GPO.Store] Firestore init failed, falling back to localStorage', e);
      }
    }
    // ---- localStorage fallback ----
    _backend = 'local';
    _loadLocal();
    _ready = true;
    return Promise.resolve(_db);
  }

  function _loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      _db = raw ? JSON.parse(raw) : emptyDb();
    } catch (e) { _db = emptyDb(); }
    // guarantee all tables exist
    var base = emptyDb();
    Object.keys(base).forEach(function (k) { if (_db[k] == null) _db[k] = base[k]; });
  }

  // Populate mirror from Firestore + keep it live via realtime listeners.
  function _loadFirestore() {
    _db = emptyDb();
    var jobs = COLLECTIONS.map(function (c) {
      return new Promise(function (resolve) {
        var first = true;
        _fs.collection(c).onSnapshot(function (snap) {
          _db[c] = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
          if (first) { first = false; resolve(); }
          else notify(); // realtime change after initial load -> refresh UI
        }, function (err) { console.error('[GPO.Store] listen ' + c, err); if (first) { first = false; resolve(); } });
      });
    });
    // meta doc
    jobs.push(_fs.collection('meta').doc('app').get().then(function (d) {
      if (d.exists) _db.meta = Object.assign(_db.meta, d.data());
    }).catch(function () {}));
    return Promise.all(jobs);
  }

  function isCloud() { return _backend === 'firestore'; }
  function ready() { return _ready; }

  // ---- Persistence helpers ------------------------------------------
  function _touchMeta() { _db.meta.updatedAt = new Date().toISOString(); }

  function _saveLocal() {
    _touchMeta();
    try { localStorage.setItem(LS_KEY, JSON.stringify(_db)); }
    catch (e) { console.error('[GPO.Store] localStorage save failed', e); alert('Local storage full — connect Firebase to remove the 5MB cap.'); }
  }

  // Write one row to the active backend.
  function _persistUpsert(table, row) {
    if (_backend === 'firestore') {
      var data = Object.assign({}, row); delete data.id;
      _fs.collection(table).doc(row.id).set(data, { merge: true }).catch(function (e) { console.error('upsert', e); });
      _fs.collection('meta').doc('app').set({ updatedAt: new Date().toISOString() }, { merge: true });
    } else { _saveLocal(); }
  }
  function _persistRemove(table, id) {
    if (_backend === 'firestore') _fs.collection(table).doc(id).delete().catch(function (e) { console.error('remove', e); });
    else _saveLocal();
  }

  // Chunked batch write (Firestore caps a batch at 500 ops).
  function _batchWrite(ops) {
    if (_backend !== 'firestore') { _saveLocal(); return Promise.resolve(); }
    var chunks = [];
    for (var i = 0; i < ops.length; i += 450) chunks.push(ops.slice(i, i + 450));
    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        var b = _fs.batch();
        chunk.forEach(function (op) {
          var ref = _fs.collection(op.table).doc(op.id);
          if (op.type === 'set') { var d = Object.assign({}, op.row); delete d.id; b.set(ref, d); }
          else b.delete(ref);
        });
        return b.commit();
      });
    }, Promise.resolve());
  }

  function notify() { LISTENERS.forEach(function (fn) { try { fn(_db); } catch (e) {} }); }
  function onChange(fn) { LISTENERS.push(fn); }

  // ---- Generic table API (unchanged signatures) ---------------------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function load() { if (!_db) _loadLocal(); return _db; }
  function all(table) { return load()[table] || []; }
  function get(table, id) { return all(table).find(function (r) { return r.id === id; }) || null; }

  function upsert(table, row) {
    load();
    _db[table] = _db[table] || [];
    if (!row.id) row.id = uid();
    var i = _db[table].findIndex(function (r) { return r.id === row.id; });
    if (i >= 0) _db[table][i] = Object.assign({}, _db[table][i], row);
    else _db[table].push(row);
    _persistUpsert(table, row);
    notify();
    return row;
  }

  function remove(table, id) {
    load();
    _db[table] = (_db[table] || []).filter(function (r) { return r.id !== id; });
    _persistRemove(table, id);
    notify();
  }

  /**
   * replaceWhere — remove rows matching predicate, then add newRows.
   * Firestore-friendly: only the DELTA is written (no full-collection rewrite).
   * Used by the sellout importer for idempotent per-supplier-per-month loads.
   */
  function replaceWhere(table, predicate, newRows) {
    load();
    var current = _db[table] || [];
    var removed = current.filter(predicate);
    var kept = current.filter(function (r) { return !predicate(r); });
    (newRows || []).forEach(function (r) { if (!r.id) r.id = uid(); });
    _db[table] = kept.concat(newRows || []);

    var ops = removed.map(function (r) { return { type: 'delete', table: table, id: r.id }; })
      .concat((newRows || []).map(function (r) { return { type: 'set', table: table, id: r.id, row: r }; }));
    _batchWrite(ops);
    notify();
  }

  // Full-table swap (kept for compatibility; prefer replaceWhere for Firestore).
  function replaceTable(table, rows) {
    replaceWhere(table, function () { return true; }, rows);
  }

  // ---- Whole-DB operations (seed / import / reset) ------------------
  function _writeEntireDb(db) {
    _db = db;
    if (_backend === 'firestore') {
      // Clear then write every collection in batches.
      var clears = COLLECTIONS.map(function (c) {
        return _fs.collection(c).get().then(function (snap) {
          return snap.docs.map(function (d) { return { type: 'delete', table: c, id: d.id }; });
        });
      });
      Promise.all(clears).then(function (delSets) {
        var ops = [];
        delSets.forEach(function (s) { ops = ops.concat(s); });
        COLLECTIONS.forEach(function (c) {
          (db[c] || []).forEach(function (r) { if (!r.id) r.id = uid(); ops.push({ type: 'set', table: c, id: r.id, row: r }); });
        });
        return _batchWrite(ops);
      }).then(function () {
        _fs.collection('meta').doc('app').set(db.meta, { merge: true });
      }).catch(function (e) { console.error('[GPO.Store] writeEntireDb', e); });
    } else { _saveLocal(); }
    notify();
  }

  function exportJson() { return JSON.stringify(load(), null, 2); }
  function importJson(text) { _writeEntireDb(typeof text === 'string' ? JSON.parse(text) : text); }
  function reset() { _writeEntireDb(emptyDb()); }

  // ---- Convenience lookups ------------------------------------------
  function supplierName(id) { var s = get('suppliers', id); return s ? s.name : '(unknown supplier)'; }
  function branchName(id) { var b = get('branches', id); return b ? b.name : '(unknown branch)'; }

  return {
    init: init, isCloud: isCloud, ready: ready,
    emptyDb: emptyDb, load: load, onChange: onChange,
    all: all, get: get, upsert: upsert, remove: remove,
    replaceWhere: replaceWhere, replaceTable: replaceTable,
    exportJson: exportJson, importJson: importJson, reset: reset,
    uid: uid, supplierName: supplierName, branchName: branchName
  };
})();
