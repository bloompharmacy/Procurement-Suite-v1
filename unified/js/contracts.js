/* =====================================================================
 * contracts.js — Contract Management & Target/Slab Tracker (NEW)
 * ---------------------------------------------------------------------
 * Tracks annual / quarterly / combined / custom rebate contracts, computes
 * achievement vs targets, and produces the monthly reminder payload:
 *   - achieved value  - remaining to target  - rebate unlocked at next slab
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.Contracts = (function () {
  'use strict';

  function quarterOf(month) { // 'YYYY-MM' -> 1..4
    var m = parseInt(String(month).split('-')[1], 10);
    return Math.floor((m - 1) / 3) + 1;
  }

  // Sum of order value for a supplier within [start,end] (inclusive months).
  function achievedValue(supplierId, startMonth, endMonth) {
    return GPO.Store.all('orders')
      .filter(function (o) {
        return o.supplierId === supplierId &&
          o.month >= startMonth && o.month <= endMonth;
      })
      .reduce(function (a, o) { return a + (+o.netValue || +o.grossValue || 0); }, 0);
  }

  // Given ordered slabs and an achieved value, find current + next slab.
  function slabStatus(slabs, achieved) {
    var sorted = (slabs || []).slice().sort(function (a, b) { return a.threshold - b.threshold; });
    var current = null, next = null;
    for (var i = 0; i < sorted.length; i++) {
      if (achieved >= sorted[i].threshold) current = sorted[i];
      else { next = sorted[i]; break; }
    }
    return {
      current: current,
      next: next,
      currentRebate: current ? achieved * current.rebatePct : 0,
      nextRebate: next ? next.threshold * next.rebatePct : 0,
      remainingToNext: next ? Math.max(0, next.threshold - achieved) : 0
    };
  }

  // Full status for one contract (handles all four types).
  function evaluate(contract) {
    var out = { contractId: contract.id, supplierId: contract.supplierId, type: contract.type, tracks: [] };

    if (contract.type === 'annual' || contract.type === 'combined') {
      var achA = achievedValue(contract.supplierId, contract.periodStart, contract.periodEnd);
      var st = slabStatus(contract.annualSlabs, achA);
      out.tracks.push(Object.assign({ scope: 'Annual', achieved: achA }, st));
    }

    if (contract.type === 'quarterly' || contract.type === 'combined') {
      var qMap = contract.quarterlySlabs || {};
      ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function (q, idx) {
        if (!qMap[q] || !qMap[q].length) return;
        var year = String(contract.periodStart).split('-')[0];
        var qStart = year + '-' + String(idx * 3 + 1).padStart(2, '0');
        var qEnd = year + '-' + String(idx * 3 + 3).padStart(2, '0');
        var achQ = achievedValue(contract.supplierId, qStart, qEnd);
        var stq = slabStatus(qMap[q], achQ);
        out.tracks.push(Object.assign({ scope: q, achieved: achQ }, stq));
      });
    }

    if (contract.type === 'custom') {
      out.customTerms = contract.customTerms || [];
    }

    return out;
  }

  /**
   * monthlyReminders — the notification payload for the current month.
   * Returns one entry per active track showing achieved / remaining / the
   * rebate value that unlocks if the next slab is reached.
   */
  function monthlyReminders(asOfMonth) {
    var reminders = [];
    GPO.Store.all('contracts').forEach(function (c) {
      // Only remind on contracts whose period covers asOfMonth.
      if (asOfMonth < c.periodStart || asOfMonth > c.periodEnd) return;
      var ev = evaluate(c);
      (ev.tracks || []).forEach(function (t) {
        reminders.push({
          supplier: GPO.Store.supplierName(c.supplierId),
          supplierId: c.supplierId,
          scope: t.scope,
          achieved: Math.round(t.achieved),
          remainingToNext: Math.round(t.remainingToNext),
          nextThreshold: t.next ? t.next.threshold : null,
          rebateUnlocked: Math.round(t.nextRebate),
          rebatePct: t.next ? +(t.next.rebatePct * 100).toFixed(1) : null,
          onTrack: t.next ? (t.remainingToNext === 0) : true
        });
      });
    });
    return reminders;
  }

  return {
    quarterOf: quarterOf,
    achievedValue: achievedValue,
    slabStatus: slabStatus,
    evaluate: evaluate,
    monthlyReminders: monthlyReminders
  };
})();
