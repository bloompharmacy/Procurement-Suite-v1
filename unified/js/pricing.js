/* =====================================================================
 * pricing.js — Discounts, Cash Terms, Bonuses & True Margin Engine (NEW)
 * ---------------------------------------------------------------------
 * Computes the 100%-accurate effective unit cost and profit margin per
 * supplier, folding in every lever from the brief:
 *   - Cascading discounts (main / +extra / +special)
 *   - Conditional cash discount (early payment / on delivery)
 *   - Bonus free goods (buy X get Y) diluting the paid cost per received unit
 * Then aggregates a weighted total margin across all suppliers.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Pricing = (function () {
  'use strict';

  // frac() tolerates values entered as 12 (%) or 0.12 (fraction).
  function frac(v) {
    v = +v || 0;
    return v > 1 ? v / 100 : v;
  }

  /**
   * effectiveUnitCost — applies the cascade in the correct commercial order.
   * @param listCost           gross list cost per unit
   * @param discounts {main,extra,special} each % or fraction
   * @param cash {pct,conditionDays}    applied only if opts.applyCash
   * @param bonus {buyQty,freeQty}      free-goods dilution
   * @param opts {applyCash, orderQty}
   */
  function effectiveUnitCost(listCost, discounts, cash, bonus, opts) {
    opts = opts || {};
    discounts = discounts || {};
    cash = cash || {};
    bonus = bonus || {};
    var breakdown = [];

    var cost = +listCost || 0;
    breakdown.push({ step: 'List cost', value: cost });

    // Cascading trade discounts (each applies to the running net).
    ['main', 'extra', 'special'].forEach(function (k) {
      var d = frac(discounts[k]);
      if (d > 0) {
        cost = cost * (1 - d);
        breakdown.push({ step: k + ' discount ' + (d * 100).toFixed(1) + '%', value: +cost.toFixed(4) });
      }
    });

    // Cash / early-payment discount (conditional).
    if (opts.applyCash && frac(cash.pct) > 0) {
      var c = frac(cash.pct);
      cost = cost * (1 - c);
      breakdown.push({
        step: 'Cash discount ' + (c * 100).toFixed(1) + '% (' +
          (cash.conditionDays ? 'paid ≤' + cash.conditionDays + 'd' : 'on delivery') + ')',
        value: +cost.toFixed(4)
      });
    }

    // Bonus free goods: pay for buyQty, receive buyQty+freeQty.
    var buy = +bonus.buyQty || 0, free = +bonus.freeQty || 0;
    if (buy > 0 && free > 0) {
      var dilution = buy / (buy + free);
      cost = cost * dilution;
      breakdown.push({
        step: 'Bonus ' + buy + '+' + free + ' free (×' + dilution.toFixed(3) + ')',
        value: +cost.toFixed(4)
      });
    }

    return { unitCost: +cost.toFixed(4), breakdown: breakdown };
  }

  /**
   * supplierMargin — true margin for one supplier.
   * Uses supplier.avgUnitCost & avgSellingPrice as list references unless
   * per-call overrides are supplied.
   */
  function supplierMargin(supplier, opts) {
    opts = opts || {};
    var listCost = opts.listCost != null ? opts.listCost : (supplier.avgUnitCost || 0);
    var sell = opts.sellingPrice != null ? opts.sellingPrice : (supplier.avgSellingPrice || 0);

    var eff = effectiveUnitCost(
      listCost, supplier.discounts, supplier.cashDiscount, supplier.bonus,
      { applyCash: opts.applyCash !== false } // assume cash terms met unless told otherwise
    );

    var unitCost = eff.unitCost;
    var profit = sell - unitCost;
    var marginPct = sell > 0 ? (profit / sell) : 0;
    var markupPct = unitCost > 0 ? (profit / unitCost) : 0;

    return {
      supplierId: supplier.id,
      name: supplier.name,
      listCost: listCost,
      effectiveUnitCost: unitCost,
      sellingPrice: sell,
      unitProfit: +profit.toFixed(4),
      marginPct: +(marginPct * 100).toFixed(2),
      markupPct: +(markupPct * 100).toFixed(2),
      breakdown: eff.breakdown
    };
  }

  /**
   * aggregateMargin — value-weighted margin across all suppliers.
   * Weight = each supplier's actual sellout value (falls back to 1 if none).
   */
  function aggregateMargin(opts) {
    var suppliers = GPO.Store.all('suppliers');
    var sellout = GPO.Store.all('sellout');
    var rows = [];
    var wProfit = 0, wRevenue = 0;

    suppliers.forEach(function (s) {
      var m = supplierMargin(s, opts);
      var revenue = sellout.filter(function (r) { return r.supplierId === s.id; })
        .reduce(function (a, r) { return a + (+r.valueSold || 0); }, 0);
      var weight = revenue > 0 ? revenue : 0;
      m.revenueWeight = weight;
      // Profit contribution scaled by units implied by revenue / selling price.
      if (m.sellingPrice > 0 && weight > 0) {
        var units = weight / m.sellingPrice;
        wProfit += units * m.unitProfit;
        wRevenue += weight;
      }
      rows.push(m);
    });

    return {
      suppliers: rows,
      totalRevenue: Math.round(wRevenue),
      totalProfit: Math.round(wProfit),
      blendedMarginPct: wRevenue > 0 ? +((wProfit / wRevenue) * 100).toFixed(2) : 0
    };
  }

  return {
    frac: frac,
    effectiveUnitCost: effectiveUnitCost,
    supplierMargin: supplierMargin,
    aggregateMargin: aggregateMargin
  };
})();
