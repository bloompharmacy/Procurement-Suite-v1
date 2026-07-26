/* =====================================================================
 * seasonality.js — Egypt Seasonality Engine  (NEW module)
 * ---------------------------------------------------------------------
 * Produces a demand multiplier for any given 'YYYY-MM' month, blending:
 *   1. A base monthly index (calendar seasonality typical of Egyptian FMCG/retail)
 *   2. Moving Islamic events (Ramadan pre-buy spike, Eid) resolved by year
 *   3. Fixed seasonal windows (Back-to-School, Summer)
 * A category modifier lets food/beverage spike harder in Ramadan while
 * some categories dip. All factors are transparent & auditable.
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Seasonality = (function () {
  'use strict';

  // Approx. Gregorian start date of Ramadan by year (Egypt sightings vary ±1d).
  // Used to know WHICH month(s) carry the pre-Ramadan stock-up spike.
  var RAMADAN_START = {
    2024: '2024-03-11', 2025: '2025-03-01', 2026: '2026-02-18',
    2027: '2027-02-08', 2028: '2028-01-28', 2029: '2029-01-16',
    2030: '2030-01-06'
  };

  // Base monthly index (1.00 = average month). Reflects a typical Egyptian
  // retail rhythm independent of Ramadan (which is overlaid separately).
  var BASE = {
    1: 0.95,  // Jan  - post-holiday lull
    2: 0.95,  // Feb
    3: 1.00,  // Mar
    4: 1.00,  // Apr
    5: 1.02,  // May
    6: 1.08,  // Jun  - summer ramp
    7: 1.12,  // Jul  - peak summer
    8: 1.10,  // Aug  - summer + BTS pre-buy
    9: 1.10,  // Sep  - Back to School
    10: 1.00, // Oct
    11: 0.98, // Nov
    12: 1.05  // Dec  - year-end
  };

  // Category sensitivity to the Ramadan pre-buy spike (default = 1).
  var RAMADAN_CATEGORY = {
    food: 1.6, beverage: 1.5, grocery: 1.45, confectionery: 1.7,
    dairy: 1.4, household: 1.15, personal_care: 1.1, electronics: 0.9
  };

  function parseMonth(monthKey) {
    var p = String(monthKey).split('-');
    return { y: parseInt(p[0], 10), m: parseInt(p[1], 10) };
  }

  function monthOf(dateStr) {
    var d = new Date(dateStr);
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }

  // Which calendar months are touched by Ramadan for a given year, and the
  // weight of the pre-buy spike. The heaviest stock-up is the ~2 weeks BEFORE
  // Ramadan, so both the month containing the start and (if the start falls
  // late) the prior month can carry weight.
  function ramadanWeight(y, m) {
    var start = RAMADAN_START[y];
    if (!start) return 0;
    var rs = monthOf(start);
    var startDay = new Date(start).getDate();

    if (rs.m === m) return 1.0;            // month Ramadan begins: full spike
    // Pre-buy bleeds into the previous month, more so when Ramadan starts early.
    var prevM = rs.m === 1 ? 12 : rs.m - 1;
    var prevY = rs.m === 1 ? rs.y - 1 : rs.y;
    if (prevM === m && prevY === y) {
      return startDay <= 15 ? 0.6 : 0.35; // earlier start => stronger prior-month buy
    }
    return 0;
  }

  // Back-to-School window (Egypt schools resume ~mid/late September).
  function backToSchool(m) { return m === 9 ? 0.25 : (m === 8 ? 0.12 : 0); }

  // Summer uplift already partly in BASE; small extra pull for Jun-Aug.
  function summer(m) { return (m >= 6 && m <= 8) ? 0.05 : 0; }

  /**
   * index(monthKey, category) -> { factor, base, events:[{name,weight}] }
   * factor is the demand multiplier to apply to a de-seasonalised baseline.
   */
  function index(monthKey, category) {
    var mm = parseMonth(monthKey);
    var base = BASE[mm.m] || 1.0;
    var events = [];
    var factor = base;

    var rw = ramadanWeight(mm.y, mm.m);
    if (rw > 0) {
      var catMult = (category && RAMADAN_CATEGORY[category.toLowerCase()]) || 1.25;
      // Convert the category multiplier into an additive uplift scaled by weight.
      var uplift = (catMult - 1) * rw;
      factor *= (1 + uplift);
      events.push({ name: 'Ramadan pre-buy', weight: +(uplift).toFixed(2) });
    }

    var bts = backToSchool(mm.m);
    if (bts > 0) { factor *= (1 + bts); events.push({ name: 'Back to School', weight: bts }); }

    var su = summer(mm.m);
    if (su > 0) { factor *= (1 + su); events.push({ name: 'Summer season', weight: su }); }

    return { factor: +factor.toFixed(3), base: base, events: events };
  }

  // Average factor across a list of month keys (used to de-seasonalise history).
  function averageFactor(monthKeys, category) {
    if (!monthKeys.length) return 1;
    var sum = monthKeys.reduce(function (a, mk) { return a + index(mk, category).factor; }, 0);
    return sum / monthKeys.length;
  }

  return {
    index: index,
    averageFactor: averageFactor,
    RAMADAN_START: RAMADAN_START,
    BASE: BASE
  };
})();
