/* =====================================================================
 * offers.js — Offers & Redemption ROI Tracker (NEW)
 * ---------------------------------------------------------------------
 * Analyses supplier-funded promotions by mechanism, computes ROI and each
 * mechanism's contribution to total sellout.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Offers = (function () {
  'use strict';

  var MECHANISMS = ['BOGO', 'PCT_OFF', 'BUNDLE', 'GIFT', 'OTHER'];

  function inRange(month, from, to) {
    return (!from || month >= from) && (!to || month <= to);
  }

  /**
   * byMechanism — aggregate performance per promo mechanism.
   * ROI = value sold / supplier funding (how much sell-through each EGP of
   * funding generated). Also returns units and value totals.
   */
  function byMechanism(filter) {
    filter = filter || {};
    var rows = GPO.Store.all('offers').filter(function (o) {
      return (!filter.supplierId || o.supplierId === filter.supplierId) &&
        inRange(o.month, filter.from, filter.to);
    });

    var agg = {};
    rows.forEach(function (o) {
      var k = o.mechanism || 'OTHER';
      agg[k] = agg[k] || { mechanism: k, units: 0, value: 0, funding: 0, redemptions: 0, offers: 0 };
      agg[k].units += (+o.unitsSold || 0);
      agg[k].value += (+o.valueSold || 0);
      agg[k].funding += (+o.supplierFunding || 0);
      agg[k].redemptions += (+o.redemptions || 0);
      agg[k].offers += 1;
    });

    return Object.keys(agg).map(function (k) {
      var a = agg[k];
      a.roi = a.funding > 0 ? +(a.value / a.funding).toFixed(2) : null;
      a.avgValuePerRedemption = a.redemptions > 0 ? +(a.value / a.redemptions).toFixed(2) : null;
      return a;
    }).sort(function (x, y) { return y.value - x.value; });
  }

  /**
   * summary — totals across all offers plus contribution to total sellout.
   */
  function summary(filter) {
    filter = filter || {};
    var mechs = byMechanism(filter);
    var totalOfferValue = mechs.reduce(function (a, m) { return a + m.value; }, 0);
    var totalFunding = mechs.reduce(function (a, m) { return a + m.funding; }, 0);
    var totalUnits = mechs.reduce(function (a, m) { return a + m.units; }, 0);

    // Total sellout value in the same window for contribution %.
    var sellout = GPO.Store.all('sellout').filter(function (r) {
      return (!filter.supplierId || r.supplierId === filter.supplierId) &&
        inRange(r.month, filter.from, filter.to);
    });
    var totalSellout = sellout.reduce(function (a, r) { return a + (+r.valueSold || 0); }, 0);

    var best = mechs.slice().sort(function (x, y) {
      return (y.roi || 0) - (x.roi || 0);
    })[0];

    return {
      mechanisms: mechs,
      totalOfferValue: Math.round(totalOfferValue),
      totalFunding: Math.round(totalFunding),
      totalUnits: totalUnits,
      blendedRoi: totalFunding > 0 ? +(totalOfferValue / totalFunding).toFixed(2) : null,
      contributionToSellout: totalSellout > 0
        ? +((totalOfferValue / totalSellout) * 100).toFixed(1) : 0,
      mostEffectiveMechanism: best ? best.mechanism : null
    };
  }

  return { MECHANISMS: MECHANISMS, byMechanism: byMechanism, summary: summary };
})();
