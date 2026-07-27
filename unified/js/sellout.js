/* =====================================================================
 * sellout.js — Automated Sellout Upload & Mapping + Demo Seeder (NEW)
 * ---------------------------------------------------------------------
 * Reads a monthly sellout workbook and maps every row into the unified
 * Store, segmented by supplier / month / branch. It mirrors the parsing
 * conventions of the locked Order Generator (tabs = branches; columns
 * code/item/quantity) so the same files work — WITHOUT importing or
 * modifying that tool's code.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Sellout = (function () {
  'use strict';

  function readWorkbook(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try { resolve(XLSX.read(new Uint8Array(e.target.result), { type: 'array' })); }
        catch (err) { reject(err); }
      };
      reader.onerror = function () { reject(new Error('Could not read file')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function findHeaderRow(rows) {
    var limit = Math.min(5, rows.length);
    for (var i = 0; i < limit; i++) {
      var lower = (rows[i] || []).map(function (c) { return String(c == null ? '' : c).trim().toLowerCase(); });
      if (lower.some(function (c) { return c.indexOf('code') >= 0; })) return i;
    }
    return 0;
  }

  // Ensure a branch exists in the Store, return its id.
  function ensureBranch(name) {
    var existing = GPO.Store.all('branches').find(function (b) {
      return b.name.trim().toLowerCase() === name.trim().toLowerCase();
    });
    if (existing) return existing.id;
    var b = GPO.Store.upsert('branches', { name: name.trim(), code: name.trim().toUpperCase().slice(0, 6) });
    return b.id;
  }

  /**
   * importWorkbook — map a sellout workbook into Store rows.
   * @param supplierId  target supplier
   * @param month       'YYYY-MM' this file represents
   * @param file        the .xlsx File
   * @param opts        { category, priceLookup(code)->unitPrice }
   * Returns { added, branches, warnings }.
   */
  function importWorkbook(supplierId, month, file, opts) {
    opts = opts || {};
    return readWorkbook(file).then(function (wb) {
      var added = 0, warnings = [], branchesSeen = {};
      var newRows = [];

      wb.SheetNames.forEach(function (sheetName) {
        var ws = wb.Sheets[sheetName];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!rows.length) return;
        var hIdx = findHeaderRow(rows);
        var header = (rows[hIdx] || []).map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
        var codeIdx = header.findIndex(function (h) { return h.indexOf('code') >= 0; });
        var itemIdx = header.findIndex(function (h) { return h.indexOf('item') >= 0 || h.indexOf('name') >= 0; });
        var qtyIdx = header.findIndex(function (h) { return h.indexOf('quant') >= 0 || h.indexOf('qty') >= 0; });
        var valIdx = header.findIndex(function (h) { return h.indexOf('value') >= 0 || h.indexOf('amount') >= 0; });

        if (codeIdx < 0 || qtyIdx < 0) {
          warnings.push('Sheet "' + sheetName + '" missing code/quantity columns — skipped.');
          return;
        }

        var branchId = ensureBranch(sheetName);
        branchesSeen[sheetName] = true;

        for (var r = hIdx + 1; r < rows.length; r++) {
          var row = rows[r];
          if (!row || row.every(function (c) { return String(c == null ? '' : c).trim() === ''; })) continue;
          var code = String(row[codeIdx] == null ? '' : row[codeIdx]).trim();
          if (!code) continue;
          var qty = Number(row[qtyIdx]);
          if (isNaN(qty)) { qty = 0; }
          var value = valIdx >= 0 ? Number(row[valIdx]) || 0 : 0;
          if (!value && opts.priceLookup) value = qty * (opts.priceLookup(code) || 0);
          var itemName = itemIdx >= 0 ? String(row[itemIdx] || '').trim() : '';

          newRows.push({
            id: GPO.Store.uid(),
            supplierId: supplierId,
            branchId: branchId,
            month: month,
            itemCode: code,
            itemName: itemName,
            category: opts.category || '',
            qtySold: qty,
            valueSold: value
          });
          added++;
        }
      });

      // Idempotent per supplier+month: drop existing rows for this exact
      // supplier+month and write the new ones. replaceWhere sends only the
      // DELTA to Firestore (no full-collection rewrite).
      GPO.Store.replaceWhere('sellout', function (r) {
        return r.supplierId === supplierId && r.month === month;
      }, newRows);

      return { added: added, branches: Object.keys(branchesSeen), warnings: warnings };
    });
  }

  // ---- Demo seeder: rich, self-consistent dataset for the new modules ---
  function seedDemo() {
    var db = GPO.Store.emptyDb();

    var suppliers = [
      { id: 'sup_a', name: 'Nile Foods Trading', code: 'NFT-01', category: 'food',
        paymentTermType: 'NET45', paymentTermDays: 45, leadTimeDays: 5, minOrderQty: 100, casePackSize: 12,
        discounts: { main: 0.12, extra: 0.05, special: 0.02 }, cashDiscount: { pct: 0.02, conditionDays: 10 },
        bonus: { buyQty: 10, freeQty: 2 }, avgUnitCost: 40, avgSellingPrice: 55 },
      { id: 'sup_b', name: 'Cairo Beverage Co', code: 'CBC-02', category: 'beverage',
        paymentTermType: 'EOM', paymentTermDays: 30, leadTimeDays: 3, minOrderQty: 200, casePackSize: 24,
        discounts: { main: 0.10, extra: 0.03, special: 0 }, cashDiscount: { pct: 0.015, conditionDays: 0 },
        bonus: { buyQty: 20, freeQty: 3 }, avgUnitCost: 18, avgSellingPrice: 25 },
      { id: 'sup_c', name: 'Delta Household Goods', code: 'DHG-03', category: 'household',
        paymentTermType: 'NET60', paymentTermDays: 60, leadTimeDays: 7, minOrderQty: 50, casePackSize: 6,
        discounts: { main: 0.08, extra: 0, special: 0 }, cashDiscount: { pct: 0.025, conditionDays: 15 },
        bonus: { buyQty: 0, freeQty: 0 }, avgUnitCost: 90, avgSellingPrice: 120 }
    ];

    var branches = [
      { id: 'br_1', name: 'Cairo', code: 'CAI', region: 'Greater Cairo' },
      { id: 'br_2', name: 'Alexandria', code: 'ALX', region: 'Delta' },
      { id: 'br_3', name: 'Giza', code: 'GIZ', region: 'Greater Cairo' }
    ];

    var months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    var sellout = [];
    suppliers.forEach(function (s) {
      branches.forEach(function (b) {
        months.forEach(function (mk) {
          var base = 300 + Math.round(Math.random() * 200);
          var seas = GPO.Seasonality.index(mk, s.category).factor;
          var qty = Math.round(base * seas);
          sellout.push({
            id: GPO.Store.uid(), supplierId: s.id, branchId: b.id, month: mk,
            itemCode: s.code + '-SKU', itemName: s.name + ' core line', category: s.category,
            qtySold: qty, valueSold: qty * s.avgSellingPrice
          });
        });
      });
    });

    var orders = [];
    suppliers.forEach(function (s) {
      months.forEach(function (mk, i) {
        var val = 40000 + i * 6000 + Math.round(Math.random() * 8000);
        orders.push({
          id: GPO.Store.uid(), supplierId: s.id, poNumber: s.code + '-PO-' + (i + 1),
          orderDate: mk + '-05', month: mk, grossValue: val, netValue: Math.round(val * 0.85),
          receivedQty: 1000, receivedValue: Math.round(val * 0.85), status: 'Received',
          lines: [{ itemCode: s.code + '-SKU', qty: 1000, unitCost: s.avgUnitCost, bonusFree: s.bonus.freeQty }]
        });
      });
    });

    var contracts = [
      { id: GPO.Store.uid(), supplierId: 'sup_a', type: 'combined',
        periodStart: '2026-01', periodEnd: '2026-12',
        annualSlabs: [{ threshold: 500000, rebatePct: 0.02 }, { threshold: 750000, rebatePct: 0.03 }, { threshold: 1000000, rebatePct: 0.04 }],
        quarterlySlabs: { Q1: [{ threshold: 120000, rebatePct: 0.01 }, { threshold: 180000, rebatePct: 0.015 }], Q2: [{ threshold: 130000, rebatePct: 0.01 }] },
        customTerms: [{ label: 'End-cap visibility', value: 'Q2-Q3', notes: 'Ramadan gondola' }], notes: '' },
      { id: GPO.Store.uid(), supplierId: 'sup_b', type: 'annual',
        periodStart: '2026-01', periodEnd: '2026-12',
        annualSlabs: [{ threshold: 300000, rebatePct: 0.015 }, { threshold: 450000, rebatePct: 0.025 }],
        quarterlySlabs: {}, customTerms: [], notes: '' }
    ];

    var offers = [
      { id: GPO.Store.uid(), supplierId: 'sup_a', month: '2026-02', mechanism: 'BOGO', itemCode: 'NFT-01-SKU', itemName: 'Ramadan bundle', unitsSold: 1800, valueSold: 99000, supplierFunding: 22000, redemptions: 900 },
      { id: GPO.Store.uid(), supplierId: 'sup_b', month: '2026-03', mechanism: 'PCT_OFF', itemCode: 'CBC-02-SKU', itemName: '20% off cases', unitsSold: 2400, valueSold: 60000, supplierFunding: 12000, redemptions: 2400 },
      { id: GPO.Store.uid(), supplierId: 'sup_a', month: '2026-05', mechanism: 'BUNDLE', itemCode: 'NFT-01-SKU', itemName: 'Eid pack', unitsSold: 1200, valueSold: 66000, supplierFunding: 9000, redemptions: 600 }
    ];

    var budgets = [];
    suppliers.forEach(function (s) {
      months.forEach(function (mk) {
        budgets.push({ id: GPO.Store.uid(), supplierId: s.id, month: mk, plannedValue: 45000 });
      });
    });

    db.suppliers = suppliers; db.branches = branches; db.sellout = sellout;
    db.orders = orders; db.contracts = contracts; db.offers = offers; db.budgets = budgets;
    GPO.Store.importJson(JSON.stringify(db));
  }

  return { readWorkbook: readWorkbook, importWorkbook: importWorkbook, ensureBranch: ensureBranch, seedDemo: seedDemo };
})();
