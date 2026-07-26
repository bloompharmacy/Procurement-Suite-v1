/* =====================================================================
 * dashboard.js — Master Dashboard KPI Compiler (NEW)
 * ---------------------------------------------------------------------
 * Pure computation layer for the primary dashboard. Every function accepts
 * a { from, to, supplierId, branchId, category } filter so the UI can
 * cross-filter by any date range / dimension in the database history.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Dashboard = (function () {
  'use strict';

  function match(row, f) {
    f = f || {};
    return (!f.from || row.month >= f.from) &&
      (!f.to || row.month <= f.to) &&
      (!f.supplierId || row.supplierId === f.supplierId) &&
      (!f.branchId || row.branchId === f.branchId) &&
      (!f.category || (row.category || '') === f.category);
  }

  function sellout(f) { return GPO.Store.all('sellout').filter(function (r) { return match(r, f); }); }
  function orders(f) {
    return GPO.Store.all('orders').filter(function (o) {
      var f2 = { from: f && f.from, to: f && f.to, supplierId: f && f.supplierId };
      return match(o, f2);
    });
  }

  function sum(arr, key) { return arr.reduce(function (a, r) { return a + (+r[key] || 0); }, 0); }

  // ---- Headline KPIs -------------------------------------------------
  function kpis(f) {
    var so = sellout(f), od = orders(f);
    var margin = GPO.Pricing.aggregateMargin();
    var offerSummary = GPO.Offers.summary({ from: f && f.from, to: f && f.to, supplierId: f && f.supplierId });
    return {
      totalSelloutValue: Math.round(sum(so, 'valueSold')),
      totalSelloutUnits: sum(so, 'qtySold'),
      totalOrderValue: Math.round(od.reduce(function (a, o) { return a + (+o.netValue || +o.grossValue || 0); }, 0)),
      activeSuppliers: GPO.Store.all('suppliers').length,
      blendedMarginPct: margin.blendedMarginPct,
      offerContribution: offerSummary.contributionToSellout
    };
  }

  // ---- Supplier performance -----------------------------------------
  function supplierPerformance(f) {
    return GPO.Store.all('suppliers').map(function (s) {
      var sf = Object.assign({}, f, { supplierId: s.id });
      var so = sellout(sf);
      var m = GPO.Pricing.supplierMargin(s);
      return {
        id: s.id, name: s.name,
        selloutValue: Math.round(sum(so, 'valueSold')),
        units: sum(so, 'qtySold'),
        marginPct: m.marginPct
      };
    }).sort(function (a, b) { return b.selloutValue - a.selloutValue; });
  }

  // ---- Budget vs actual (monthly) -----------------------------------
  function budgetVsActual(f) {
    var budgets = GPO.Store.all('budgets').filter(function (b) {
      return (!f || !f.from || b.month >= f.from) && (!f || !f.to || b.month <= f.to) &&
        (!f || !f.supplierId || b.supplierId === f.supplierId);
    });
    var months = {};
    budgets.forEach(function (b) {
      months[b.month] = months[b.month] || { month: b.month, planned: 0, actual: 0 };
      months[b.month].planned += (+b.plannedValue || 0);
    });
    sellout(f).forEach(function (r) {
      months[r.month] = months[r.month] || { month: r.month, planned: 0, actual: 0 };
      months[r.month].actual += (+r.valueSold || 0);
    });
    return Object.keys(months).sort().map(function (k) {
      var m = months[k];
      m.planned = Math.round(m.planned); m.actual = Math.round(m.actual);
      m.variancePct = m.planned > 0 ? +(((m.actual - m.planned) / m.planned) * 100).toFixed(1) : null;
      return m;
    });
  }

  // ---- Branch performance -------------------------------------------
  function branchPerformance(f) {
    var agg = {};
    sellout(f).forEach(function (r) {
      agg[r.branchId] = agg[r.branchId] || { branchId: r.branchId, value: 0, units: 0 };
      agg[r.branchId].value += (+r.valueSold || 0);
      agg[r.branchId].units += (+r.qtySold || 0);
    });
    return Object.keys(agg).map(function (k) {
      return { name: GPO.Store.branchName(k), value: Math.round(agg[k].value), units: agg[k].units };
    }).sort(function (a, b) { return b.value - a.value; });
  }

  // ---- Category performance -----------------------------------------
  function categoryPerformance(f) {
    var agg = {};
    sellout(f).forEach(function (r) {
      var c = r.category || 'uncategorised';
      agg[c] = agg[c] || { category: c, value: 0, units: 0 };
      agg[c].value += (+r.valueSold || 0);
      agg[c].units += (+r.qtySold || 0);
    });
    return Object.keys(agg).map(function (k) {
      return { category: k, value: Math.round(agg[k].value), units: agg[k].units };
    }).sort(function (a, b) { return b.value - a.value; });
  }

  // ---- Monthly sellout trend (for line chart) -----------------------
  function monthlyTrend(f) {
    var agg = {};
    sellout(f).forEach(function (r) {
      agg[r.month] = (agg[r.month] || 0) + (+r.valueSold || 0);
    });
    return Object.keys(agg).sort().map(function (k) { return { month: k, value: Math.round(agg[k]) }; });
  }

  // Distinct months present in history (for date-range pickers).
  function availableMonths() {
    var set = {};
    GPO.Store.all('sellout').forEach(function (r) { set[r.month] = 1; });
    GPO.Store.all('orders').forEach(function (o) { set[o.month] = 1; });
    return Object.keys(set).sort();
  }

  return {
    kpis: kpis, supplierPerformance: supplierPerformance,
    budgetVsActual: budgetVsActual, branchPerformance: branchPerformance,
    categoryPerformance: categoryPerformance, monthlyTrend: monthlyTrend,
    availableMonths: availableMonths
  };
})();
