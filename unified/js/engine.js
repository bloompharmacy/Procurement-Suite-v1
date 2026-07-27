/* =====================================================================
 * engine.js — Active integration with the LOCKED tools  (NEW)
 * ---------------------------------------------------------------------
 * Replaces the old one-way "Data Bridge". The shell OWNS the data (gpo_db)
 * and actively CALLS the original tools' functions with it, using the
 * locked files as live calculation engines — without modifying them.
 *
 * KEY FACT (verified): the tools declare `suppliers`/`settings`/`STATE`
 * with `let`, so they are NOT reachable as window properties cross-frame.
 * But their `function` declarations ARE. So we:
 *   • call cw.calculateOrders(supplierObj) with an object WE build,
 *   • drive `settings` through the tool's own DOM controls + events,
 *   • call cw.buildWorkbook / cw.downloadWorkbook to emit the real .xlsx,
 *   • call PRO-TRACK's pure cw.calculateMaturityDate for payment terms.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Engine = (function () {
  'use strict';

  var SRC = {
    order: '../order-generator-first update claude.html',
    track: '../procurement supplier warehouse.html'
  };
  var FRAME = { order: 'frameOrder', track: 'frameTrack' };

  // Resolve a frame's contentWindow, loading the iframe on demand and waiting
  // until the tool's functions exist. No need to visit the tab first.
  function ensureFrame(which) {
    var f = document.getElementById(FRAME[which]);
    return new Promise(function (resolve, reject) {
      if (!f) { reject(new Error('Frame ' + which + ' not found')); return; }
      var probe = which === 'order' ? 'calculateOrders' : 'calculateMaturityDate';
      function ready() {
        try { return f.contentWindow && typeof f.contentWindow[probe] === 'function'; }
        catch (e) { return false; }
      }
      if (ready()) { resolve(f.contentWindow); return; }
      var tries = 0;
      function waitReady() {
        if (ready()) { resolve(f.contentWindow); return; }
        if (++tries > 60) { reject(new Error(which + ' tool did not finish loading')); return; }
        setTimeout(waitReady, 100);
      }
      f.addEventListener('load', waitReady);
      if (!f.getAttribute('src')) f.src = encodeURI(SRC[which]);
      else waitReady();
    });
  }

  // Drive the Order Generator's global `settings` via its own DOM + events
  // (we can't set the `let settings` binding directly across frames).
  function setOrderSettings(cw, o) {
    o = o || {};
    var doc = cw.document;
    function fire(el, type) { el.dispatchEvent(new cw.Event(type, { bubbles: true })); }
    if (o.coverDays) {
      var s = doc.getElementById('stockCoverDays');
      if (s) { s.value = String(o.coverDays); fire(s, 'change'); }
    }
    if (o.daysPerMonth) {
      var d = doc.getElementById('daysPerMonth');
      if (d) { d.value = String(o.daysPerMonth); fire(d, 'change'); }
    }
    if (o.outputMode) {
      var btn = doc.querySelector('#outputModeToggle button[data-mode="' + o.outputMode + '"]');
      if (btn) btn.click();
    }
  }

  // Build a supplier object in the EXACT shape calculateOrders expects,
  // sourced from gpo_db (sellout grouped by month/branch/item; stock optional).
  function buildOrderSupplier(supplierId, opts) {
    opts = opts || {};
    var sup = GPO.Store.get('suppliers', supplierId) || {};
    var rows = GPO.Store.all('sellout').filter(function (r) { return r.supplierId === supplierId; });

    var branchesSet = {}, items = {}, itemNames = {}, byMonth = {};
    rows.forEach(function (r) {
      var bname = GPO.Store.branchName(r.branchId);
      branchesSet[bname] = 1;
      items[r.itemCode] = { name: r.itemName || '' };
      itemNames[r.itemCode] = r.itemName || '';
      byMonth[r.month] = byMonth[r.month] || {};
      byMonth[r.month][bname] = byMonth[r.month][bname] || {};
      byMonth[r.month][bname][r.itemCode] = (byMonth[r.month][bname][r.itemCode] || 0) + (+r.qtySold || 0);
    });
    var branches = Object.keys(branchesSet);

    // Stock on hand (gpo_db has none by default → 0). Optional override map.
    var stock = {};
    Object.keys(items).forEach(function (code) {
      stock[code] = {};
      branches.forEach(function (b) {
        stock[code][b] = (opts.stock && opts.stock[code] && opts.stock[code][b]) || 0;
      });
    });

    // One "sellout file" per distinct month → monthsCount drives the window.
    var selloutFiles = Object.keys(byMonth).sort().map(function (m) {
      return { fileName: m, parsed: { branchData: byMonth[m], itemNames: itemNames, warnings: [] } };
    });

    return {
      name: sup.name || '(supplier)',
      leadTimeDays: sup.leadTimeDays || 0,
      minOrderQty: sup.minOrderQty || 0,
      casePackSize: sup.casePackSize || 1,
      stockFile: { fileName: 'gpo_db', parsed: { branches: branches, items: items, stock: stock } },
      selloutFiles: selloutFiles
    };
  }

  /**
   * calculateOrders(supplierIds, opts) — run the ORIGINAL Order Generator
   * engine on gpo_db data. opts: { coverDays, daysPerMonth, outputMode, stock }
   * Returns Promise<[{ supplierId, supplier, calc }]>.
   */
  function calculateOrders(supplierIds, opts) {
    opts = opts || {};
    return ensureFrame('order').then(function (cw) {
      setOrderSettings(cw, opts);
      return supplierIds.map(function (id) {
        var supObj = buildOrderSupplier(id, opts);
        var calc = cw.calculateOrders(supObj);
        return { supplierId: id, supplier: supObj, calc: calc };
      });
    });
  }

  /**
   * downloadOrderWorkbook — produce the REAL .xlsx via the locked tool's own
   * buildWorkbook + downloadWorkbook, from gpo_db data.
   */
  function downloadOrderWorkbook(supplierIds, opts) {
    return calculateOrders(supplierIds, opts).then(function (runData) {
      return ensureFrame('order').then(function (cw) {
        var rd = runData.map(function (x) { return { supplier: x.supplier, calc: x.calc }; });
        return cw.buildWorkbook(rd).then(function (wb) { return cw.downloadWorkbook(wb); });
      });
    });
  }

  /**
   * paymentSchedule — drive PRO-TRACK's pure calculateMaturityDate() over
   * gpo_db orders to compute due dates by each supplier's payment terms.
   * Returns Promise<[{ poNumber, supplier, term, invoiceDate, dueDate, value }]>.
   */
  function paymentSchedule() {
    return ensureFrame('track').then(function (cw) {
      return GPO.Store.all('orders').map(function (o) {
        var sup = GPO.Store.get('suppliers', o.supplierId) || {};
        var lead = sup.leadTimeDays || 0;
        var term = sup.paymentTermType || 'NET30';
        var due;
        try { due = cw.calculateMaturityDate(o.orderDate, term, lead); }
        catch (e) { due = '(n/a)'; }
        var inv = new Date(o.orderDate); inv.setDate(inv.getDate() + lead);
        return {
          poNumber: o.poNumber, supplier: sup.name || '(supplier)', term: term,
          invoiceDate: isNaN(inv) ? '' : inv.toISOString().split('T')[0],
          dueDate: due, value: o.netValue || o.grossValue || 0
        };
      });
    });
  }

  return {
    ensureFrame: ensureFrame,
    buildOrderSupplier: buildOrderSupplier,
    calculateOrders: calculateOrders,
    downloadOrderWorkbook: downloadOrderWorkbook,
    paymentSchedule: paymentSchedule
  };
})();
