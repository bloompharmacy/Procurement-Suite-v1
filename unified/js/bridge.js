/* =====================================================================
 * bridge.js — Non-invasive Data Bridge  (NEW)
 * ---------------------------------------------------------------------
 * Pulls live data OUT of the two LOCKED tools and into the unified
 * Firestore/local store — without editing, importing, or parsing their
 * source. It works by reading the tools' own global variables through the
 * same-origin iframe (window.frames), and by calling the tools' OWN
 * functions (e.g. the Order Generator's calculateOrders / aggregateSellout).
 *
 * Same-origin is guaranteed on GitHub Pages (all files served from one
 * origin), which is why cross-frame global access is permitted here.
 *
 * Idempotent: every bridged row uses a DETERMINISTIC id, so re-running the
 * bridge updates rows in place instead of duplicating them.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Bridge = (function () {
  'use strict';

  function frameWin(id) {
    var f = document.getElementById(id);
    if (!f) return null;
    try { return f.contentWindow; } catch (e) { return null; } // cross-origin guard
  }

  function slug(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

  // Find an existing GPO supplier by name (case-insensitive) or return null.
  function findSupplierByName(name) {
    var n = String(name || '').trim().toLowerCase();
    return GPO.Store.all('suppliers').find(function (s) { return s.name.trim().toLowerCase() === n; }) || null;
  }

  // Ensure a GPO supplier exists for a given name; return its id.
  // Uses a deterministic id so repeated bridging never duplicates.
  function ensureSupplier(name, extra) {
    var existing = findSupplierByName(name);
    if (existing) {
      if (extra) GPO.Store.upsert('suppliers', Object.assign({ id: existing.id }, extra));
      return existing.id;
    }
    var id = 'br_sup_' + slug(name);
    GPO.Store.upsert('suppliers', Object.assign({
      id: id, name: name, code: slug(name).toUpperCase().slice(0, 8),
      category: '', paymentTermType: 'NET30', leadTimeDays: 0, minOrderQty: 0, casePackSize: 1,
      discounts: { main: 0, extra: 0, special: 0 }, cashDiscount: { pct: 0, conditionDays: 0 },
      bonus: { buyQty: 0, freeQty: 0 }, avgUnitCost: 0, avgSellingPrice: 0
    }, extra || {}));
    return id;
  }

  // =================================================================
  // BRIDGE A: Order Generator  ->  suppliers + sellout collections
  // -----------------------------------------------------------------
  // Reads the tool's live global `suppliers` array (which holds parsed
  // stock + sellout files while the user has them loaded) and calls the
  // tool's own `aggregateSellout()` to extract per-branch, per-SKU qty.
  // =================================================================
  function fromOrderGenerator(opts) {
    opts = opts || {};
    var cw = frameWin('frameOrder');
    if (!cw) return { ok: false, reason: 'Order Generator tab not opened yet — open it once so it loads.' };
    if (!cw.suppliers || !Array.isArray(cw.suppliers)) {
      return { ok: false, reason: 'Order Generator has no active session. Open that tab and upload stock + sellout files first.' };
    }
    var month = opts.month || defaultMonth();
    var report = { ok: true, suppliers: 0, selloutRows: 0, skipped: [] };

    cw.suppliers.forEach(function (s) {
      if (!s.name || !s.selloutFiles || !s.selloutFiles.length) { report.skipped.push(s.name || '(unnamed)'); return; }

      var gpoId = ensureSupplier(s.name, {
        leadTimeDays: s.leadTimeDays || 0,
        minOrderQty: s.minOrderQty || 0,
        casePackSize: s.casePackSize || 1
      });
      report.suppliers++;

      // Reuse the tool's OWN aggregation function — no reimplementation.
      var agg;
      try { agg = cw.aggregateSellout(s.selloutFiles); }
      catch (e) { report.skipped.push(s.name + ' (parse err)'); return; }

      var sup = GPO.Store.get('suppliers', gpoId) || {};
      var price = sup.avgSellingPrice || 0;
      var rows = [];

      // agg.combined[branchName][skuCode] = qtySold  (across the loaded months)
      Object.keys(agg.combined || {}).forEach(function (branchName) {
        var branchId = GPO.Sellout.ensureBranch(branchName);
        var codes = agg.combined[branchName];
        Object.keys(codes).forEach(function (code) {
          var qty = codes[code] || 0;
          rows.push({
            id: 'og_' + gpoId + '_' + month + '_' + slug(branchName) + '_' + slug(code),
            supplierId: gpoId, branchId: branchId, month: month,
            itemCode: code, itemName: (agg.itemNames && agg.itemNames[code]) || '',
            category: sup.category || '', qtySold: qty, valueSold: qty * price
          });
          report.selloutRows++;
        });
      });

      // Idempotent replace for this supplier+month.
      GPO.Store.replaceWhere('sellout', function (r) {
        return r.supplierId === gpoId && r.month === month && String(r.id).indexOf('og_') === 0;
      }, rows);
    });

    return report;
  }

  // =================================================================
  // BRIDGE B: PRO-TRACK SCM  ->  suppliers + orders collections
  // -----------------------------------------------------------------
  // Reads the tool's live global `STATE` (suppliers / purchaseOrders /
  // receivedOrders) — including anything just committed via its OCR desk —
  // and maps it into the unified `orders` collection so the forecasting &
  // contract engines run on live purchase history.
  // =================================================================
  function fromProTrack() {
    var cw = frameWin('frameTrack');
    if (!cw) return { ok: false, reason: 'PRO-TRACK tab not opened yet — open it once so it loads.' };
    if (!cw.STATE || !Array.isArray(cw.STATE.purchaseOrders)) {
      return { ok: false, reason: 'PRO-TRACK has no data. Open that tab and seed/commit POs first.' };
    }
    var st = cw.STATE;
    var report = { ok: true, suppliers: 0, orders: 0 };

    // Map PRO-TRACK numeric supplier ids -> GPO supplier ids.
    var idMap = {};
    (st.suppliers || []).forEach(function (s) {
      var gpoId = ensureSupplier(s.name, {
        code: s.code || undefined,
        paymentTermType: normalizeTerm(s.payment_term_type),
        leadTimeDays: s.lead_time_bench || 0
      });
      idMap[s.id] = gpoId;
      report.suppliers++;
    });

    // Received qty/value keyed by PO id (to enrich the order rows).
    var recByPo = {};
    (st.receivedOrders || []).forEach(function (r) { recByPo[r.po_id] = r; });

    (st.purchaseOrders || []).forEach(function (po) {
      var supId = idMap[po.supplier_id] || ensureSupplier('Supplier ' + po.supplier_id);
      var rec = recByPo[po.id];
      var month = String(po.order_date || '').slice(0, 7);
      GPO.Store.upsert('orders', {
        id: 'pt_' + po.po_number,               // deterministic -> idempotent
        supplierId: supId, poNumber: po.po_number,
        orderDate: po.order_date, month: month,
        grossValue: po.total_value || 0,
        netValue: rec ? (rec.value_received || po.total_value || 0) : (po.total_value || 0),
        receivedQty: rec ? (rec.qty_received || 0) : 0,
        receivedValue: rec ? (rec.value_received || 0) : 0,
        status: po.status || 'PO Issued',
        lines: [{ itemCode: po.po_number + '-L1', qty: po.qty_ordered || 0, unitCost: (po.qty_ordered ? (po.total_value / po.qty_ordered) : 0), bonusFree: 0 }]
      });
      report.orders++;
    });

    return report;
  }

  // PRO-TRACK term codes -> our supplier term vocabulary.
  function normalizeTerm(t) {
    var m = { NET45: 'NET45', NET60: 'NET60', EOM: 'EOM', CONSIGNMENT: 'CONSIGNMENT', COD: 'COD' };
    return m[t] || 'NET30';
  }

  function defaultMonth() {
    var months = GPO.Dashboard.availableMonths();
    if (months.length) return months[months.length - 1];
    var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  return {
    fromOrderGenerator: fromOrderGenerator,
    fromProTrack: fromProTrack,
    ensureSupplier: ensureSupplier
  };
})();
