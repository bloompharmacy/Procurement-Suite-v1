/* =====================================================================
 * importer.js — Universal Data Importer  (NEW)
 * ---------------------------------------------------------------------
 * Ingests CSV / XLSX files into gpo_db for the three core data types:
 *   • suppliers  • sellout (per branch/item/month)  • orders (past POs)
 * Parses the file, auto-maps columns (fuzzy), lets the UI confirm the
 * mapping, then writes into the Store so forecasting / margins / dashboard
 * have real data. Also serves downloadable CSV templates.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Importer = (function () {
  'use strict';

  // ---- Target field definitions (drive the mapping UI) --------------
  var FIELDS = {
    suppliers: [
      { key: 'name', label: 'Supplier name', required: true, syn: ['name', 'supplier', 'suppliername', 'vendor'] },
      { key: 'code', label: 'Code', syn: ['code', 'suppliercode', 'id', 'ref'] },
      { key: 'category', label: 'Category', syn: ['category', 'cat', 'type'] },
      { key: 'paymentTermType', label: 'Payment term', syn: ['payment', 'terms', 'paymentterm', 'term'] },
      { key: 'leadTimeDays', label: 'Lead time (days)', syn: ['lead', 'leadtime', 'leadtimedays'] },
      { key: 'minOrderQty', label: 'MOQ', syn: ['moq', 'minorder', 'minimum', 'minorderqty'] },
      { key: 'casePackSize', label: 'Case pack', syn: ['pack', 'casepack', 'packsize', 'casepacksize'] },
      { key: 'mainDiscount', label: 'Main discount %', syn: ['maindiscount', 'discount', 'disc', 'main'] },
      { key: 'extraDiscount', label: 'Extra discount %', syn: ['extradiscount', 'extra'] },
      { key: 'specialDiscount', label: 'Special discount %', syn: ['specialdiscount', 'special'] },
      { key: 'cashDiscountPct', label: 'Cash discount %', syn: ['cashdiscount', 'cash'] },
      { key: 'cashConditionDays', label: 'Cash within (days)', syn: ['cashdays', 'cashwithin', 'cashconditiondays'] },
      { key: 'bonusBuy', label: 'Bonus buy qty', syn: ['bonusbuy', 'buyqty', 'buy'] },
      { key: 'bonusFree', label: 'Bonus free qty', syn: ['bonusfree', 'freeqty', 'free'] },
      { key: 'avgUnitCost', label: 'Avg unit cost', syn: ['cost', 'unitcost', 'buyprice', 'costprice'] },
      { key: 'avgSellingPrice', label: 'Avg selling price', syn: ['price', 'sellprice', 'sellingprice', 'retail'] }
    ],
    sellout: [
      { key: 'supplier', label: 'Supplier (name or code)', required: true, syn: ['supplier', 'suppliername', 'vendor', 'suppliercode'] },
      { key: 'branch', label: 'Branch', required: true, syn: ['branch', 'store', 'location', 'outlet'] },
      { key: 'month', label: 'Month (YYYY-MM)', required: true, syn: ['month', 'period', 'date'] },
      { key: 'itemCode', label: 'Item code', required: true, syn: ['code', 'itemcode', 'sku', 'barcode'] },
      { key: 'itemName', label: 'Item name', syn: ['item', 'name', 'description', 'product', 'itemname'] },
      { key: 'category', label: 'Category', syn: ['category', 'cat'] },
      { key: 'qtySold', label: 'Qty sold', required: true, syn: ['qty', 'quantity', 'units', 'sold', 'qtysold', 'salesqty'] },
      { key: 'valueSold', label: 'Value sold', syn: ['value', 'amount', 'salesvalue', 'revenue', 'valuesold'] }
    ],
    orders: [
      { key: 'supplier', label: 'Supplier (name or code)', required: true, syn: ['supplier', 'suppliername', 'vendor', 'suppliercode'] },
      { key: 'poNumber', label: 'PO number', required: true, syn: ['po', 'ponumber', 'ordernumber', 'ref'] },
      { key: 'orderDate', label: 'Order date (YYYY-MM-DD)', syn: ['date', 'orderdate', 'podate'] },
      { key: 'grossValue', label: 'Gross value', syn: ['gross', 'value', 'amount', 'total', 'grossvalue'] },
      { key: 'netValue', label: 'Net value', syn: ['net', 'netvalue'] },
      { key: 'qty', label: 'Qty ordered', syn: ['qty', 'quantity', 'units', 'qtyordered'] },
      { key: 'unitCost', label: 'Unit cost', syn: ['cost', 'unitcost'] },
      { key: 'receivedQty', label: 'Received qty', syn: ['received', 'qtyreceived', 'receivedqty'] },
      { key: 'receivedValue', label: 'Received value', syn: ['receivedvalue', 'valuereceived'] },
      { key: 'status', label: 'Status', syn: ['status', 'state'] }
    ]
  };

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // ---- Parse CSV / XLSX into { headers, rows } ----------------------
  function parseFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          // Header = first row with >= 2 non-empty cells.
          var hIdx = 0;
          for (var i = 0; i < Math.min(10, aoa.length); i++) {
            var nonEmpty = (aoa[i] || []).filter(function (c) { return String(c).trim() !== ''; }).length;
            if (nonEmpty >= 2) { hIdx = i; break; }
          }
          var headers = (aoa[hIdx] || []).map(function (h) { return String(h).trim(); });
          var rows = [];
          for (var r = hIdx + 1; r < aoa.length; r++) {
            var row = aoa[r];
            if (!row || row.every(function (c) { return String(c).trim() === ''; })) continue;
            var obj = {};
            headers.forEach(function (h, ci) { obj[h] = row[ci]; });
            rows.push(obj);
          }
          resolve({ headers: headers.filter(Boolean), rows: rows });
        } catch (err) { reject(err); }
      };
      reader.onerror = function () { reject(new Error('Could not read file')); };
      reader.readAsArrayBuffer(file);
    });
  }

  // Auto-guess a mapping { fieldKey: headerName } from the file headers.
  function autoMap(type, headers) {
    var map = {};
    FIELDS[type].forEach(function (fld) {
      var hit = headers.find(function (h) {
        var nh = norm(h);
        return fld.syn.some(function (s) { return nh === s || nh.indexOf(s) >= 0 || s.indexOf(nh) >= 0 && nh.length > 2; });
      });
      if (hit) map[fld.key] = hit;
    });
    return map;
  }

  function pctFrac(v) { v = +v || 0; return v > 1 ? v / 100 : v; }
  function slug(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

  // Resolve a supplier by name or code; create a stub if missing.
  function findOrCreateSupplier(nameOrCode) {
    var key = String(nameOrCode || '').trim();
    if (!key) return null;
    var lk = key.toLowerCase();
    var found = GPO.Store.all('suppliers').find(function (s) {
      return (s.name && s.name.toLowerCase() === lk) || (s.code && s.code.toLowerCase() === lk);
    });
    if (found) return found.id;
    var id = 'imp_sup_' + slug(key);
    GPO.Store.upsert('suppliers', {
      id: id, name: key, code: slug(key).toUpperCase().slice(0, 10), category: '',
      paymentTermType: 'NET30', leadTimeDays: 0, minOrderQty: 0, casePackSize: 1,
      discounts: { main: 0, extra: 0, special: 0 }, cashDiscount: { pct: 0, conditionDays: 0 },
      bonus: { buyQty: 0, freeQty: 0 }, avgUnitCost: 0, avgSellingPrice: 0
    });
    return id;
  }
  function ensureBranch(name) {
    var nm = String(name || '').trim();
    var found = GPO.Store.all('branches').find(function (b) { return b.name.toLowerCase() === nm.toLowerCase(); });
    if (found) return found.id;
    var b = GPO.Store.upsert('branches', { name: nm, code: nm.toUpperCase().slice(0, 6) });
    return b.id;
  }

  function val(row, map, key) { var h = map[key]; return h != null ? row[h] : undefined; }

  // ---- Import each type into the Store ------------------------------
  function importRows(type, rows, map) {
    if (type === 'suppliers') return importSuppliers(rows, map);
    if (type === 'sellout') return importSellout(rows, map);
    if (type === 'orders') return importOrders(rows, map);
    throw new Error('Unknown import type');
  }

  function importSuppliers(rows, map) {
    var n = 0, skipped = 0;
    rows.forEach(function (row) {
      var name = String(val(row, map, 'name') || '').trim();
      if (!name) { skipped++; return; }
      var code = String(val(row, map, 'code') || '').trim();
      var existing = GPO.Store.all('suppliers').find(function (s) {
        return (code && s.code && s.code.toLowerCase() === code.toLowerCase()) || s.name.toLowerCase() === name.toLowerCase();
      });
      GPO.Store.upsert('suppliers', {
        id: existing ? existing.id : ('imp_sup_' + slug(code || name)),
        name: name, code: code || slug(name).toUpperCase().slice(0, 10),
        category: String(val(row, map, 'category') || '').trim().toLowerCase(),
        paymentTermType: String(val(row, map, 'paymentTermType') || 'NET30').trim().toUpperCase(),
        leadTimeDays: +val(row, map, 'leadTimeDays') || 0,
        minOrderQty: +val(row, map, 'minOrderQty') || 0,
        casePackSize: +val(row, map, 'casePackSize') || 1,
        discounts: { main: pctFrac(val(row, map, 'mainDiscount')), extra: pctFrac(val(row, map, 'extraDiscount')), special: pctFrac(val(row, map, 'specialDiscount')) },
        cashDiscount: { pct: pctFrac(val(row, map, 'cashDiscountPct')), conditionDays: +val(row, map, 'cashConditionDays') || 0 },
        bonus: { buyQty: +val(row, map, 'bonusBuy') || 0, freeQty: +val(row, map, 'bonusFree') || 0 },
        avgUnitCost: +val(row, map, 'avgUnitCost') || 0,
        avgSellingPrice: +val(row, map, 'avgSellingPrice') || 0
      });
      n++;
    });
    return { imported: n, skipped: skipped, type: 'suppliers' };
  }

  function normMonth(v) {
    var s = String(v == null ? '' : v).trim();
    if (/^\d{4}-\d{2}$/.test(s)) return s;
    var d = new Date(s);
    if (!isNaN(d)) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    var m = s.match(/^(\d{4})[\/\-](\d{1,2})/); // 2026/3
    if (m) return m[1] + '-' + String(m[2]).padStart(2, '0');
    return s;
  }

  function importSellout(rows, map) {
    // Group by supplier+month so we can idempotently replaceWhere.
    var groups = {}, skipped = 0;
    rows.forEach(function (row) {
      var supKey = val(row, map, 'supplier'), branch = val(row, map, 'branch'),
          month = normMonth(val(row, map, 'month')), code = String(val(row, map, 'itemCode') || '').trim();
      if (!supKey || !branch || !month || !code) { skipped++; return; }
      var supplierId = findOrCreateSupplier(supKey);
      var branchId = ensureBranch(branch);
      var qty = +val(row, map, 'qtySold') || 0;
      var value = +val(row, map, 'valueSold') || 0;
      if (!value) {
        var sup = GPO.Store.get('suppliers', supplierId);
        if (sup && sup.avgSellingPrice) value = qty * sup.avgSellingPrice;
      }
      var gk = supplierId + '|' + month;
      groups[gk] = groups[gk] || { supplierId: supplierId, month: month, rows: [] };
      groups[gk].rows.push({
        id: 'imp_' + supplierId + '_' + month + '_' + slug(String(branch)) + '_' + slug(code),
        supplierId: supplierId, branchId: branchId, month: month,
        itemCode: code, itemName: String(val(row, map, 'itemName') || '').trim(),
        category: String(val(row, map, 'category') || '').trim().toLowerCase(),
        qtySold: qty, valueSold: value
      });
    });
    var n = 0;
    Object.keys(groups).forEach(function (gk) {
      var g = groups[gk];
      GPO.Store.replaceWhere('sellout', function (r) {
        return r.supplierId === g.supplierId && r.month === g.month;
      }, g.rows);
      n += g.rows.length;
    });
    return { imported: n, skipped: skipped, groups: Object.keys(groups).length, type: 'sellout' };
  }

  function importOrders(rows, map) {
    var n = 0, skipped = 0;
    rows.forEach(function (row) {
      var supKey = val(row, map, 'supplier'), po = String(val(row, map, 'poNumber') || '').trim();
      if (!supKey || !po) { skipped++; return; }
      var supplierId = findOrCreateSupplier(supKey);
      var orderDate = String(val(row, map, 'orderDate') || '').trim();
      var month = orderDate ? normMonth(orderDate) : '';
      var gross = +val(row, map, 'grossValue') || 0;
      var net = +val(row, map, 'netValue') || gross;
      var qty = +val(row, map, 'qty') || 0;
      var unitCost = +val(row, map, 'unitCost') || (qty ? gross / qty : 0);
      GPO.Store.upsert('orders', {
        id: 'imp_ord_' + slug(po),
        supplierId: supplierId, poNumber: po, orderDate: orderDate, month: month,
        grossValue: gross, netValue: net,
        receivedQty: +val(row, map, 'receivedQty') || 0,
        receivedValue: +val(row, map, 'receivedValue') || 0,
        status: String(val(row, map, 'status') || 'Imported').trim(),
        lines: [{ itemCode: po + '-L1', qty: qty, unitCost: unitCost, bonusFree: 0 }]
      });
      n++;
    });
    return { imported: n, skipped: skipped, type: 'orders' };
  }

  // ---- CSV templates -------------------------------------------------
  function template(type) {
    var headers = FIELDS[type].map(function (f) { return f.label; });
    var example = {
      suppliers: ['Nile Foods Trading', 'NFT-01', 'food', 'NET45', '5', '100', '12', '12', '5', '2', '2', '10', '10', '2', '40', '55'],
      sellout: ['Nile Foods Trading', 'Cairo', '2026-06', 'NFT-01-SKU', 'Core line', 'food', '320', '17600'],
      orders: ['Nile Foods Trading', 'PO-2026-001', '2026-06-05', '45000', '38250', '1000', '40', '1000', '38250', 'Received']
    }[type];
    return headers.join(',') + '\n' + example.join(',') + '\n';
  }

  return {
    FIELDS: FIELDS, parseFile: parseFile, autoMap: autoMap,
    importRows: importRows, template: template
  };
})();
