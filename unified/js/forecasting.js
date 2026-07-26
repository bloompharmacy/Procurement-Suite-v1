/* =====================================================================
 * forecasting.js — Forecasting, Budget & Slab-Optimised Ordering (NEW)
 * ---------------------------------------------------------------------
 * Builds on Store (history) + Seasonality (Egypt calendar) to produce:
 *   - runRate()          : de-seasonalised monthly baseline demand
 *   - forecast()         : seasonally-adjusted demand for a target month
 *   - smartOrder()       : suggested order qty that avoids overstocking
 *   - slabOptimisedOrder(): cheapest incremental order to hit next rebate slab
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Forecast = (function () {
  'use strict';

  var S = function () { return GPO.Store; };

  // All sellout rows for a supplier (optionally a single item / branch).
  function selloutRows(supplierId, opts) {
    opts = opts || {};
    return S().all('sellout').filter(function (r) {
      return r.supplierId === supplierId &&
        (!opts.itemCode || r.itemCode === opts.itemCode) &&
        (!opts.branchId || r.branchId === opts.branchId);
    });
  }

  function distinctMonths(rows) {
    return Object.keys(rows.reduce(function (a, r) { a[r.month] = 1; return a; }, {}));
  }

  /**
   * De-seasonalised monthly run rate for a supplier/item.
   * We divide each month's actual by that month's seasonal factor, then
   * average — giving a "normal month" baseline free of Ramadan/summer noise.
   */
  function runRate(supplierId, opts) {
    opts = opts || {};
    var rows = selloutRows(supplierId, opts);
    if (!rows.length) return { qty: 0, value: 0, months: 0 };

    var byMonth = {};
    rows.forEach(function (r) {
      byMonth[r.month] = byMonth[r.month] || { qty: 0, value: 0 };
      byMonth[r.month].qty += (+r.qtySold || 0);
      byMonth[r.month].value += (+r.valueSold || 0);
    });

    var cat = opts.category;
    var months = Object.keys(byMonth);
    var qSum = 0, vSum = 0;
    months.forEach(function (mk) {
      var f = GPO.Seasonality.index(mk, cat).factor || 1;
      qSum += byMonth[mk].qty / f;
      vSum += byMonth[mk].value / f;
    });
    return { qty: qSum / months.length, value: vSum / months.length, months: months.length };
  }

  /**
   * Seasonally-adjusted demand forecast for a target month.
   * forecast = de-seasonalised run rate × target month seasonal factor.
   */
  function forecast(supplierId, targetMonth, opts) {
    opts = opts || {};
    var rr = runRate(supplierId, opts);
    var seas = GPO.Seasonality.index(targetMonth, opts.category);
    return {
      qty: Math.round(rr.qty * seas.factor),
      value: Math.round(rr.value * seas.factor),
      baselineQty: Math.round(rr.qty),
      factor: seas.factor,
      events: seas.events,
      historyMonths: rr.months
    };
  }

  /**
   * Smart order quantity that covers demand over a horizon without overstocking.
   *   demand   = forecast for the cover window (coverDays)
   *   required = demand − onHand
   *   capped   = never exceed maxCoverDays of demand on hand after receipt
   * Rounds up to case pack and respects MOQ (same rules as the locked
   * Order Generator, re-implemented here — the original file is untouched).
   */
  function smartOrder(supplierId, targetMonth, opts) {
    opts = opts || {};
    var sup = S().get('suppliers', supplierId) || {};
    var coverDays = opts.coverDays || 45;
    var leadDays = opts.leadTimeDays != null ? opts.leadTimeDays : (sup.leadTimeDays || 0);
    var maxCoverDays = opts.maxCoverDays || (coverDays + leadDays) * 1.5; // overstock ceiling
    var onHand = opts.onHand || 0;
    var pack = Math.max(1, opts.casePackSize || sup.casePackSize || 1);
    var moq = Math.max(0, opts.minOrderQty != null ? opts.minOrderQty : (sup.minOrderQty || 0));

    var monthly = forecast(supplierId, targetMonth, opts).qty; // per month
    var daily = monthly / 30;
    var window = coverDays + leadDays;

    var demand = Math.ceil(daily * window);
    var required = Math.max(0, demand - onHand);

    // Overstock guard: post-receipt cover must not exceed maxCoverDays.
    var maxStock = Math.ceil(daily * maxCoverDays);
    var ceiling = Math.max(0, maxStock - onHand);
    var qty = Math.min(required, ceiling);
    var path = 'demand ' + demand + ' - onHand ' + onHand + ' = ' + required;

    if (qty > 0) {
      if (qty < moq) { qty = moq; path += ' -> MOQ ' + moq; }
      if (pack > 1) { var packs = Math.ceil(qty / pack); qty = packs * pack; path += ' -> pack×' + pack + ' = ' + qty; }
    }
    if (required > ceiling) path += ' (capped at overstock ceiling ' + ceiling + ')';

    return {
      qty: qty, dailyDemand: +daily.toFixed(2), window: window,
      forecastMonthly: monthly, onHand: onHand, path: path,
      overstockCeiling: ceiling
    };
  }

  /**
   * Slab-optimised order: given how much value has already been achieved
   * toward a contract this period and the next rebate slab, compute the
   * cheapest additional order that reaches the slab — but only if organic
   * (seasonal) demand can absorb it without overstocking.
   *
   * params: { supplierId, achievedValue, nextSlab:{threshold, rebatePct},
   *           remainingMonths, targetMonths:[...], avgUnitValue }
   */
  function slabOptimisedOrder(params) {
    var achieved = params.achievedValue || 0;
    var slab = params.nextSlab;
    if (!slab) return { reachable: false, reason: 'No further slab' };

    var gapValue = Math.max(0, slab.threshold - achieved);
    if (gapValue === 0) {
      return { reachable: true, alreadyHit: true, gapValue: 0,
               rebateGain: slab.threshold * slab.rebatePct };
    }

    // Organic seasonal demand (value) across the remaining target months.
    var months = params.targetMonths || [];
    var organicValue = months.reduce(function (a, mk) {
      return a + forecast(params.supplierId, mk, params).value;
    }, 0);

    // The pull-forward needed beyond organic demand to close the gap.
    var pullForward = Math.max(0, gapValue - organicValue);

    // Rebate unlocked is applied to the WHOLE slab band (typical rebate math).
    var rebateGain = slab.threshold * slab.rebatePct;

    // Guardrail: pulling forward more than ~1 extra month of organic value is
    // an overstock risk; surface it rather than blindly recommending.
    var monthlyOrganic = months.length ? organicValue / months.length : 0;
    var overstockRisk = pullForward > monthlyOrganic;

    return {
      reachable: true,
      alreadyHit: false,
      gapValue: Math.round(gapValue),
      organicValue: Math.round(organicValue),
      pullForwardValue: Math.round(pullForward),
      suggestedExtraUnits: params.avgUnitValue ? Math.ceil(pullForward / params.avgUnitValue) : null,
      rebateGain: Math.round(rebateGain),
      // Net benefit = rebate unlocked minus the capital tied in the pull-forward.
      netBenefit: Math.round(rebateGain - pullForward * (params.holdingCostRate || 0.02)),
      overstockRisk: overstockRisk,
      recommendation: overstockRisk
        ? 'Gap exceeds one month of seasonal demand — split across months or renegotiate slab.'
        : 'Safe to pull forward — seasonal demand absorbs most of the gap.'
    };
  }

  return {
    runRate: runRate,
    forecast: forecast,
    smartOrder: smartOrder,
    slabOptimisedOrder: slabOptimisedOrder,
    selloutRows: selloutRows,
    distinctMonths: distinctMonths
  };
})();
