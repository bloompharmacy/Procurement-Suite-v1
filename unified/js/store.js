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

  // ---- Scoped loading (performance as data grows) -------------------
  // Small, bounded collections are mirrored whole. The two collections that
  // grow without bound (sellout, orders) are subscribed only for an active
  // month WINDOW, so Firestore reads stay proportional to what's in view.
  var SCOPED = ['sellout', 'orders'];
  var _window = null;      // { from:'YYYY-MM', to:'YYYY-MM' } | null = all
  var _unsubs = {};        // active onSnapshot detach fns, keyed by collection

  function _fmtMonth(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function _defaultWindow() {
    var d = new Date();
    return { from: _fmtMonth(new Date(d.getFullYear(), d.getMonth() - 24, 1)),
             to: _fmtMonth(new Date(d.getFullYear(), d.getMonth() + 12, 1)) };
  }

  // Build the query for a collection, applying the month window when scoped.
  function _query(c) {
    var ref = _fs.collection(c);
    if (SCOPED.indexOf(c) >= 0 && _window) {
      ref = ref.where('month', '>=', _window.from).where('month', '<=', _window.to);
    }
    return ref;
  }

  // (Re)subscribe one collection; resolves once first snapshot arrives.
  function _subscribe(c) {
    if (_unsubs[c]) { try { _unsubs[c](); } catch (e) {} }
    return new Promise(function (resolve) {
      var first = true;
      _unsubs[c] = _query(c).onSnapshot(function (snap) {
        _db[c] = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        if (first) { first = false; resolve(); } else notify();
      }, function (err) {
        console.error('[GPO.Store] listen ' + c, err);
        if (first) { first = false; resolve(); }
      });
    });
  }

  function _loadFirestore() {
    _db = emptyDb();
    _window = _defaultWindow();
    var jobs = COLLECTIONS.map(_subscribe);
    jobs.push(_fs.collection('meta').doc('app').get().then(function (d) {
      if (d.exists) _db.meta = Object.assign(_db.meta, d.data());
    }).catch(function () {}));
    return Promise.all(jobs);
  }

  /**
   * setWindow(from,to) — change the active data horizon for scoped
   * collections and re-subscribe. Pass null,null to load everything.
   * In local mode this is a no-op (the full dataset is already in memory).
   */
  function setWindow(from, to) {
    if (_backend !== 'firestore') { notify(); return Promise.resolve(); }
    _window = (from && to) ? { from: from, to: to } : null;
    return Promise.all(SCOPED.map(_subscribe)).then(function () { notify(); });
  }
  function getWindow() { return _window; }

  // Local comparison for pageQuery fallback.
  function _cmp(a, op, b) {
    switch (op) {
      case '==': return a === b; case '>=': return a >= b; case '<=': return a <= b;
      case '>': return a > b; case '<': return a < b; default: return true;
    }
  }

  /**
   * pageQuery(collection, opts) — cursor pagination for browsing large
   * collections WITHOUT loading them into the mirror.
   * opts: { where:[field,op,val], orderBy, dir:'asc'|'desc', limit, cursor, offset }
   * Returns Promise<{ rows, cursor, done }>. In cloud `cursor` is the last
   * doc snapshot (pass it back for the next page); in local it's a numeric
   * offset. Requires a composite index when combining where + orderBy on
   * different fields (see firestore.indexes.json).
   */
  function pageQuery(collection, opts) {
    opts = opts || {};
    var limit = opts.limit || 50;

    if (_backend !== 'firestore') {
      var rows = (load()[collection] || []).slice();
      if (opts.where) rows = rows.filter(function (r) { return _cmp(r[opts.where[0]], opts.where[1], opts.where[2]); });
      if (opts.orderBy) rows.sort(function (a, b) {
        var x = a[opts.orderBy], y = b[opts.orderBy], s = (x > y) - (x < y);
        return opts.dir === 'desc' ? -s : s;
      });
      var start = opts.offset || 0, page = rows.slice(start, start + limit);
      return Promise.resolve({ rows: page, cursor: start + limit, done: start + limit >= rows.length });
    }

    var ref = _fs.collection(collection);
    if (opts.where) ref = ref.where(opts.where[0], opts.where[1], opts.where[2]);
    if (opts.orderBy) ref = ref.orderBy(opts.orderBy, opts.dir || 'asc');
    ref = ref.limit(limit);
    if (opts.cursor) ref = ref.startAfter(opts.cursor);
    return ref.get().then(function (snap) {
      return {
        rows: snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }),
        cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
        done: snap.docs.length < limit
      };
    });
  }

  // ---- RBAC write guard --------------------------------------------
  // Client-side defence-in-depth. The real gate is Firestore Rules.
  function _guard(table) {
    if (window.GPO && GPO.RBAC && GPO.RBAC.enforce() && !GPO.RBAC.canWrite(table)) {
      GPO.RBAC.fireDeny(table);
      console.warn('[GPO.Store] write to "' + table + '" blocked for role: ' + (GPO.RBAC.role() || 'none'));
      return false;
    }
    return true;
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
    if (!_guard(table)) return null;
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
    if (!_guard(table)) return;
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
    if (!_guard(table)) return;
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
  // Manager-only in cloud mode (bulk overwrite is a privileged action).
  function _writeEntireDb(db) {
    if (window.GPO && GPO.RBAC && GPO.RBAC.enforce() && GPO.RBAC.role() !== 'manager') {
      GPO.RBAC.fireDeny('database');
      console.warn('[GPO.Store] bulk DB write blocked — manager role required');
      return;
    }
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
    setWindow: setWindow, getWindow: getWindow, pageQuery: pageQuery,
    uid: uid, supplierName: supplierName, branchName: branchName
  };
})();
