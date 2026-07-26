/* =====================================================================
 * app.js — Shell controller & module UI (NEW)
 * ---------------------------------------------------------------------
 * Owns navigation, renders the 6 new module views, and lazy-embeds the two
 * LOCKED tools into iframes (their files are loaded byte-for-byte from the
 * parent folder — never imported, parsed, or modified).
 * ===================================================================== */
window.GPO = window.GPO || {};

GPO.App = (function () {
  'use strict';

  // Relative paths to the untouched locked tools (one folder up).
  var LOCKED = {
    order: '../order-generator-first update claude.html',
    track: '../procurement supplier warehouse.html'
  };
  var framesLoaded = {};
  var charts = {};

  // ---- utils ---------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function money(n) { return (GPO.Store.load().meta.currency || 'EGP') + ' ' + Math.round(n || 0).toLocaleString(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (sel === v ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function supplierOptions(sel) {
    return '<option value="">— select supplier —</option>' +
      GPO.Store.all('suppliers').map(function (s) { return opt(s.id, s.name, sel); }).join('');
  }
  function destroyChart(k) { if (charts[k]) { charts[k].destroy(); delete charts[k]; } }

  // ---- routing -------------------------------------------------------
  var currentRoute = 'dashboard';
  function route(name) {
    currentRoute = name;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.querySelectorAll('.navbtn').forEach(function (b) { b.classList.toggle('active', b.dataset.route === name); });
    var view = $('view-' + name);
    if (view) view.classList.add('active');

    if (name === 'tool-order') return embedLocked('frameOrder', LOCKED.order);
    if (name === 'tool-track') return embedLocked('frameTrack', LOCKED.track);

    var r = { dashboard: renderDashboard, suppliers: renderSuppliers, sellout: renderSellout,
      forecast: renderForecast, contracts: renderContracts, margin: renderMargin,
      offers: renderOffers, budgets: renderBudgets, bridge: renderBridge }[name];
    if (r) r();
  }

  // Lazy-embed a locked tool exactly once (keeps its own state alive).
  function embedLocked(frameId, src) {
    if (framesLoaded[frameId]) return;
    $(frameId).src = encodeURI(src);
    framesLoaded[frameId] = true;
  }

  // ================================================================
  // MODULE: Master Dashboard
  // ================================================================
  function renderDashboard() {
    var months = GPO.Dashboard.availableMonths();
    var from = dashState.from || (months[0] || '');
    var to = dashState.to || (months[months.length - 1] || '');
    var f = { from: from, to: to, supplierId: dashState.supplierId || '', category: dashState.category || '' };

    var k = GPO.Dashboard.kpis(f);
    var cats = {}; GPO.Store.all('sellout').forEach(function (r) { if (r.category) cats[r.category] = 1; });

    var v = $('view-dashboard');
    v.innerHTML =
      '<h2 class="page">Master Dashboard</h2>' +
      '<p class="page-sub">Cross-filter every module by date range, supplier and category. Currency: ' + (GPO.Store.load().meta.currency) + '.</p>' +
      '<div class="card"><div class="row">' +
        '<div class="f"><label>From month</label><select id="dFrom">' + months.map(function (m) { return opt(m, m, from); }).join('') + '</select></div>' +
        '<div class="f"><label>To month</label><select id="dTo">' + months.map(function (m) { return opt(m, m, to); }).join('') + '</select></div>' +
        '<div class="f"><label>Supplier</label><select id="dSup">' + supplierOptions(f.supplierId) + '</select></div>' +
        '<div class="f"><label>Category</label><select id="dCat"><option value="">All</option>' + Object.keys(cats).map(function (c) { return opt(c, c, f.category); }).join('') + '</select></div>' +
      '</div></div>' +
      '<div class="grid g4">' +
        kpi('Total Sellout', money(k.totalSelloutValue), { icon: '📈', tone: 'info', sub: k.totalSelloutUnits.toLocaleString() + ' units' }) +
        kpi('Order Value', money(k.totalOrderValue), { icon: '🧾' }) +
        kpi('Blended Margin', k.blendedMarginPct + '%', { icon: '💰', tone: k.blendedMarginPct >= 20 ? 'ok' : 'warn' }) +
        kpi('Offer Contribution', k.offerContribution + '%', { icon: '🎁', tone: 'ok' }) +
      '</div>' +
      '<div class="split" style="margin-top:18px">' +
        '<div class="card"><h3>Monthly Sellout Trend</h3><div class="chart-box"><canvas id="chTrend"></canvas></div></div>' +
        '<div class="card"><h3>Budget vs Actual</h3><div class="chart-box"><canvas id="chBudget"></canvas></div></div>' +
      '</div>' +
      '<div class="split">' +
        '<div class="card"><h3>Supplier Performance</h3><div class="chart-box"><canvas id="chSup"></canvas></div></div>' +
        '<div class="card"><h3>Branch Performance</h3><div class="chart-box"><canvas id="chBranch"></canvas></div></div>' +
      '</div>' +
      '<div class="card"><h3>Category Performance</h3>' + tableCategory(f) + '</div>';

    ['dFrom:from', 'dTo:to', 'dSup:supplierId', 'dCat:category'].forEach(function (pair) {
      var p = pair.split(':');
      $(p[0]).addEventListener('change', function (e) { dashState[p[1]] = e.target.value; renderDashboard(); });
    });

    drawDashCharts(f);
  }

  var dashState = {};
  // kpi(label, val, opts?) — opts: { icon, tone:'ok|warn|bad|info', sub }
  function kpi(label, val, opts) {
    opts = opts || {};
    return '<div class="kpi' + (opts.tone ? ' ' + opts.tone : '') + '">' +
      (opts.icon ? '<div class="kpi-ic">' + opts.icon + '</div>' : '') +
      '<div class="kpi-body"><div class="label">' + label + '</div><div class="val">' + val + '</div>' +
      (opts.sub ? '<div class="kpi-sub">' + opts.sub + '</div>' : '') + '</div></div>';
  }

  function tableCategory(f) {
    var rows = GPO.Dashboard.categoryPerformance(f);
    if (!rows.length) return '<p class="muted">No sellout data in range. Seed demo data or upload a sellout sheet.</p>';
    return '<table><thead><tr><th>Category</th><th class="num">Units</th><th class="num">Value</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r.category) + '</td><td class="num">' + r.units.toLocaleString() + '</td><td class="num">' + money(r.value) + '</td></tr>'; }).join('') +
      '</tbody></table>';
  }

  function drawDashCharts(f) {
    var trend = GPO.Dashboard.monthlyTrend(f);
    destroyChart('trend');
    charts.trend = new Chart($('chTrend'), { type: 'line',
      data: { labels: trend.map(function (t) { return t.month; }),
        datasets: [{ label: 'Sellout', data: trend.map(function (t) { return t.value; }), borderColor: '#3E7A66', backgroundColor: 'rgba(62,122,102,.12)', fill: true, tension: .3 }] },
      options: chartOpts() });

    var bva = GPO.Dashboard.budgetVsActual(f);
    destroyChart('budget');
    charts.budget = new Chart($('chBudget'), { type: 'bar',
      data: { labels: bva.map(function (b) { return b.month; }),
        datasets: [
          { label: 'Planned', data: bva.map(function (b) { return b.planned; }), backgroundColor: '#B97A1F' },
          { label: 'Actual', data: bva.map(function (b) { return b.actual; }), backgroundColor: '#3E7A66' }] },
      options: chartOpts() });

    var sup = GPO.Dashboard.supplierPerformance(f);
    destroyChart('sup');
    charts.sup = new Chart($('chSup'), { type: 'bar',
      data: { labels: sup.map(function (s) { return s.name; }),
        datasets: [{ label: 'Sellout value', data: sup.map(function (s) { return s.selloutValue; }), backgroundColor: '#2f6fb0' }] },
      options: chartOpts(true) });

    var br = GPO.Dashboard.branchPerformance(f);
    destroyChart('branch');
    charts.branch = new Chart($('chBranch'), { type: 'doughnut',
      data: { labels: br.map(function (b) { return b.name; }),
        datasets: [{ data: br.map(function (b) { return b.value; }), backgroundColor: ['#3E7A66', '#E8A33D', '#2f6fb0', '#B8492F', '#8a6d3b'] }] },
      options: { responsive: true, maintainAspectRatio: false } });
  }
  function chartOpts(horizontal) {
    return { responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
      plugins: { legend: { labels: { font: { size: 11 } } } },
      scales: { y: { beginAtZero: true } } };
  }

  // ================================================================
  // MODULE: Suppliers & Pricing (master supplier DB)
  // ================================================================
  function renderSuppliers() {
    var v = $('view-suppliers');
    var list = GPO.Store.all('suppliers');
    v.innerHTML =
      '<h2 class="page">Suppliers &amp; Pricing Database</h2>' +
      '<p class="page-sub">Master supplier profiles: payment terms, discount cascades, cash terms and bonus structures.</p>' +
      '<div class="card"><h3>Add / Edit Supplier</h3>' + supplierForm() + '</div>' +
      '<div class="card"><h3>Supplier Registry (' + list.length + ')</h3>' + supplierTable(list) + '</div>';
    wireSupplierForm();
  }

  function supplierForm(s) {
    s = s || {};
    var d = s.discounts || {}, c = s.cashDiscount || {}, b = s.bonus || {};
    return '<input type="hidden" id="sfId" value="' + esc(s.id || '') + '">' +
      '<div class="row">' +
        field('Name', '<input id="sfName" value="' + esc(s.name || '') + '">') +
        field('Code', '<input id="sfCode" value="' + esc(s.code || '') + '">') +
        field('Category', '<input id="sfCat" value="' + esc(s.category || '') + '" placeholder="food, beverage…">') +
        field('Payment term', '<select id="sfTerm">' + ['NET30', 'NET45', 'NET60', 'EOM', 'COD', 'CONSIGNMENT'].map(function (t) { return opt(t, t, s.paymentTermType); }).join('') + '</select>') +
      '</div>' +
      '<div class="row" style="margin-top:10px">' +
        field('Lead time (d)', '<input id="sfLead" type="number" value="' + (s.leadTimeDays || 0) + '">') +
        field('MOQ', '<input id="sfMoq" type="number" value="' + (s.minOrderQty || 0) + '">') +
        field('Case pack', '<input id="sfPack" type="number" value="' + (s.casePackSize || 1) + '">') +
        field('Avg unit cost', '<input id="sfCost" type="number" value="' + (s.avgUnitCost || 0) + '">') +
        field('Avg selling price', '<input id="sfSell" type="number" value="' + (s.avgSellingPrice || 0) + '">') +
      '</div>' +
      '<div class="row" style="margin-top:10px">' +
        field('Main disc %', '<input id="sfD1" type="number" step="0.1" value="' + pctIn(d.main) + '">') +
        field('Extra disc %', '<input id="sfD2" type="number" step="0.1" value="' + pctIn(d.extra) + '">') +
        field('Special disc %', '<input id="sfD3" type="number" step="0.1" value="' + pctIn(d.special) + '">') +
        field('Cash disc %', '<input id="sfCash" type="number" step="0.1" value="' + pctIn(c.pct) + '">') +
        field('Cash within (d)', '<input id="sfCashD" type="number" value="' + (c.conditionDays || 0) + '">') +
        field('Bonus buy', '<input id="sfBuy" type="number" value="' + (b.buyQty || 0) + '">') +
        field('Bonus free', '<input id="sfFree" type="number" value="' + (b.freeQty || 0) + '">') +
      '</div>' +
      '<div style="margin-top:14px"><button class="act" id="sfSave">Save Supplier</button> ' +
      '<button class="act ghost sm" id="sfClear">Clear</button></div>';
  }
  function pctIn(v) { v = +v || 0; return v <= 1 ? +(v * 100).toFixed(2) : v; }
  function field(label, inner) { return '<div class="f"><label>' + label + '</label>' + inner + '</div>'; }

  function wireSupplierForm() {
    var save = $('sfSave'); if (!save) return;
    save.addEventListener('click', function () {
      var name = $('sfName').value.trim();
      if (!name) { toast('Supplier name required'); return; }
      GPO.Store.upsert('suppliers', {
        id: $('sfId').value || undefined,
        name: name, code: $('sfCode').value.trim(), category: $('sfCat').value.trim().toLowerCase(),
        paymentTermType: $('sfTerm').value,
        leadTimeDays: +$('sfLead').value || 0, minOrderQty: +$('sfMoq').value || 0, casePackSize: +$('sfPack').value || 1,
        avgUnitCost: +$('sfCost').value || 0, avgSellingPrice: +$('sfSell').value || 0,
        discounts: { main: pctFrac($('sfD1').value), extra: pctFrac($('sfD2').value), special: pctFrac($('sfD3').value) },
        cashDiscount: { pct: pctFrac($('sfCash').value), conditionDays: +$('sfCashD').value || 0 },
        bonus: { buyQty: +$('sfBuy').value || 0, freeQty: +$('sfFree').value || 0 }
      });
      toast('Supplier saved'); renderSuppliers();
    });
    $('sfClear').addEventListener('click', function () { renderSuppliers(); });
  }
  function pctFrac(v) { v = +v || 0; return v > 1 ? v / 100 : v; }

  function supplierTable(list) {
    if (!list.length) return '<p class="muted">No suppliers yet. Add one above or seed demo data.</p>';
    return '<table><thead><tr><th>Name</th><th>Code</th><th>Category</th><th>Terms</th><th class="num">Cascade</th><th class="num">Bonus</th><th></th></tr></thead><tbody>' +
      list.map(function (s) {
        var d = s.discounts || {};
        var casc = [d.main, d.extra, d.special].filter(function (x) { return x; }).map(function (x) { return (x * 100).toFixed(1) + '%'; }).join(' + ') || '—';
        var bonus = (s.bonus && s.bonus.buyQty) ? s.bonus.buyQty + '+' + s.bonus.freeQty : '—';
        return '<tr><td>' + esc(s.name) + '</td><td class="num">' + esc(s.code) + '</td><td>' + esc(s.category || '—') + '</td><td>' + esc(s.paymentTermType) + '</td><td class="num">' + casc + '</td><td class="num">' + bonus + '</td>' +
          '<td><button class="act ghost sm" onclick="GPO.App.editSupplier(\'' + s.id + '\')">Edit</button> <button class="act del sm" onclick="GPO.App.delSupplier(\'' + s.id + '\')">✕</button></td></tr>';
      }).join('') + '</tbody></table>';
  }
  function editSupplier(id) {
    var s = GPO.Store.get('suppliers', id);
    $('view-suppliers').querySelector('.card').innerHTML = '<h3>Add / Edit Supplier</h3>' + supplierForm(s);
    wireSupplierForm();
    window.scrollTo(0, 0);
  }
  function delSupplier(id) { if (confirm('Delete this supplier?')) { GPO.Store.remove('suppliers', id); renderSuppliers(); } }

  // ================================================================
  // MODULE: Sellout & Upload (automated mapping)
  // ================================================================
  function renderSellout() {
    var v = $('view-sellout');
    var rows = GPO.Store.all('sellout');
    var byKey = {};
    rows.forEach(function (r) {
      var k = r.supplierId + '|' + r.month;
      byKey[k] = byKey[k] || { supplierId: r.supplierId, month: r.month, rows: 0, qty: 0, value: 0, branches: {} };
      byKey[k].rows++; byKey[k].qty += (+r.qtySold || 0); byKey[k].value += (+r.valueSold || 0); byKey[k].branches[r.branchId] = 1;
    });
    var summary = Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) { return b.month.localeCompare(a.month); });

    v.innerHTML =
      '<h2 class="page">Sellout Tracking &amp; Automated Upload</h2>' +
      '<p class="page-sub">Upload a monthly sellout workbook (tabs = branches; columns Code / Item / Quantity [/ Value]). Rows are auto-mapped to the supplier, segmented by month &amp; branch. Same file format as the locked Order Generator.</p>' +
      '<div class="card"><h3>Upload monthly sellout</h3><div class="row">' +
        field('Supplier', '<select id="soSup">' + supplierOptions('') + '</select>') +
        field('Month', '<input id="soMonth" type="month" value="' + defaultMonth() + '">') +
        field('Category override', '<input id="soCat" placeholder="optional">') +
        '<div class="f"><label>Workbook (.xlsx)</label><input id="soFile" type="file" accept=".xlsx,.xls"></div>' +
      '</div><div style="margin-top:12px"><button class="act" id="soImport">Import &amp; Map</button></div>' +
      '<div id="soResult" style="margin-top:10px"></div></div>' +
      '<div class="card"><h3>Sellout ledger by supplier / month (' + summary.length + ')</h3>' +
        (summary.length ? '<table><thead><tr><th>Month</th><th>Supplier</th><th class="num">Branches</th><th class="num">SKU rows</th><th class="num">Units</th><th class="num">Value</th></tr></thead><tbody>' +
          summary.map(function (s) { return '<tr><td>' + s.month + '</td><td>' + esc(GPO.Store.supplierName(s.supplierId)) + '</td><td class="num">' + Object.keys(s.branches).length + '</td><td class="num">' + s.rows + '</td><td class="num">' + s.qty.toLocaleString() + '</td><td class="num">' + money(s.value) + '</td></tr>'; }).join('') +
          '</tbody></table>' : '<p class="muted">No sellout imported yet.</p>') +
      '</div>';

    $('soImport').addEventListener('click', function () {
      var sup = $('soSup').value, month = $('soMonth').value, file = $('soFile').files[0];
      if (!sup) { toast('Pick a supplier'); return; }
      if (!month) { toast('Pick a month'); return; }
      if (!file) { toast('Choose a file'); return; }
      GPO.Sellout.importWorkbook(sup, month, file, { category: $('soCat').value.trim().toLowerCase() })
        .then(function (res) {
          $('soResult').innerHTML = '<div class="note">Mapped <b>' + res.added + '</b> rows into ' + res.branches.length + ' branch(es): ' + esc(res.branches.join(', ')) +
            (res.warnings.length ? '<br><span class="pill warn">' + res.warnings.length + ' warning(s)</span> ' + esc(res.warnings.join(' | ')) : '') + '</div>';
          toast('Sellout mapped'); renderSellout();
        })
        .catch(function (e) { $('soResult').innerHTML = '<div class="note" style="color:var(--rust)">Import failed: ' + esc(e.message) + '</div>'; });
    });
  }

  // ================================================================
  // MODULE: Forecast & Smart Order
  // ================================================================
  function renderForecast() {
    var v = $('view-forecast');
    v.innerHTML =
      '<h2 class="page">Forecasting &amp; Smart Order Creation</h2>' +
      '<p class="page-sub">Seasonally-adjusted forecast (Egypt calendar: Ramadan, Eid, Back-to-School, Summer) with an overstock-guarded order suggestion.</p>' +
      '<div class="card"><div class="row">' +
        field('Supplier', '<select id="fcSup">' + supplierOptions('') + '</select>') +
        field('Target month', '<input id="fcMonth" type="month" value="' + defaultMonth() + '">') +
        field('Stock cover (d)', '<input id="fcCover" type="number" value="45">') +
        field('On hand', '<input id="fcOnHand" type="number" value="0">') +
        '<div class="f" style="flex:0"><label>&nbsp;</label><button class="act" id="fcRun">Forecast</button></div>' +
      '</div></div>' +
      '<div id="fcOut"></div>';
    $('fcRun').addEventListener('click', runForecast);
  }
  function runForecast() {
    var sup = $('fcSup').value;
    if (!sup) { toast('Pick a supplier'); return; }
    var s = GPO.Store.get('suppliers', sup) || {};
    var month = $('fcMonth').value, cover = +$('fcCover').value || 45, onHand = +$('fcOnHand').value || 0;
    var fc = GPO.Forecast.forecast(sup, month, { category: s.category });
    var so = GPO.Forecast.smartOrder(sup, month, { category: s.category, coverDays: cover, onHand: onHand });
    var seas = GPO.Seasonality.index(month, s.category);

    $('fcOut').innerHTML =
      '<div class="grid g4">' +
        kpi('Baseline / mo', fc.baselineQty.toLocaleString() + ' u') +
        kpi('Seasonal factor', '×' + fc.factor) +
        kpi('Forecast ' + month, fc.qty.toLocaleString() + ' u') +
        kpi('Suggested order', so.qty.toLocaleString() + ' u') +
      '</div>' +
      '<div class="card" style="margin-top:16px"><h3>Why this number</h3>' +
        '<p class="muted">Active Egypt seasonality events for ' + month + ': ' +
          (seas.events.length ? seas.events.map(function (e) { return '<span class="pill warn">' + esc(e.name) + ' +' + Math.round(e.weight * 100) + '%</span>'; }).join(' ') : '<span class="pill ok">none — base month</span>') + '</p>' +
        '<div class="breakdown">' +
          '<div>Daily demand: ' + so.dailyDemand + ' u/day · cover window ' + so.window + ' d</div>' +
          '<div>Order path: ' + esc(so.path) + '</div>' +
          '<div>Overstock ceiling: ' + so.overstockCeiling.toLocaleString() + ' u (order capped here to avoid overstock)</div>' +
        '</div></div>';
    toast('Forecast ready');
  }

  // ================================================================
  // MODULE: Contracts & Targets
  // ================================================================
  function renderContracts() {
    var v = $('view-contracts');
    var reminders = GPO.Contracts.monthlyReminders(defaultMonth());
    v.innerHTML =
      '<h2 class="page">Contract Management &amp; Target Tracker</h2>' +
      '<p class="page-sub">Annual / quarterly / combined / custom rebate contracts with slab tracking and monthly reminders.</p>' +
      '<div class="card"><h3>📣 Monthly reminders — ' + defaultMonth() + '</h3>' + reminderTable(reminders) + '</div>' +
      '<div class="card"><h3>Create contract</h3>' + contractForm() + '</div>' +
      '<div class="card"><h3>Contracts (' + GPO.Store.all('contracts').length + ')</h3>' + contractList() + '</div>';
    wireContractForm();
  }
  function reminderTable(rem) {
    if (!rem.length) return '<p class="muted">No active contracts this month. Create one below (or seed demo data).</p>';
    return '<table><thead><tr><th>Supplier</th><th>Scope</th><th class="num">Achieved</th><th class="num">Remaining to next</th><th class="num">Next slab</th><th class="num">Rebate unlocked</th><th>Status</th></tr></thead><tbody>' +
      rem.map(function (r) {
        var st = r.onTrack ? '<span class="pill ok">Slab hit</span>' : (r.remainingToNext > 0 ? '<span class="pill warn">In progress</span>' : '<span class="pill ok">—</span>');
        return '<tr><td>' + esc(r.supplier) + '</td><td>' + esc(r.scope) + '</td><td class="num">' + money(r.achieved) + '</td><td class="num">' + money(r.remainingToNext) + '</td><td class="num">' + (r.nextThreshold ? money(r.nextThreshold) : '—') + '</td><td class="num">' + (r.rebateUnlocked ? money(r.rebateUnlocked) + ' (' + r.rebatePct + '%)' : '—') + '</td><td>' + st + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="muted" style="margin-top:8px">Tip: use the Forecast module to see the cheapest seasonal pull-forward to close a remaining gap without overstocking.</p>';
  }
  function contractForm() {
    return '<div class="row">' +
        field('Supplier', '<select id="ctSup">' + supplierOptions('') + '</select>') +
        field('Type', '<select id="ctType">' + ['annual', 'quarterly', 'combined', 'custom'].map(function (t) { return opt(t, t, ''); }).join('') + '</select>') +
        field('Period start', '<input id="ctStart" type="month" value="' + defaultMonth().slice(0, 4) + '-01">') +
        field('Period end', '<input id="ctEnd" type="month" value="' + defaultMonth().slice(0, 4) + '-12">') +
      '</div>' +
      '<div class="row" style="margin-top:10px">' +
        field('Annual slabs (threshold:rebate%, …)', '<input id="ctAnnual" placeholder="500000:2, 750000:3, 1000000:4">') +
        field('Q1 slabs', '<input id="ctQ1" placeholder="120000:1, 180000:1.5">') +
      '</div>' +
      '<div class="row" style="margin-top:10px">' +
        field('Custom terms (label:value, …)', '<input id="ctCustom" placeholder="End-cap visibility:Q2, Marketing fund:50000">') +
      '</div>' +
      '<div style="margin-top:14px"><button class="act" id="ctSave">Save contract</button></div>';
  }
  function parseSlabs(str) {
    return String(str || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) {
      var kv = p.split(':'); return { threshold: +kv[0] || 0, rebatePct: pctFrac(kv[1]) };
    }).filter(function (s) { return s.threshold > 0; });
  }
  function wireContractForm() {
    var b = $('ctSave'); if (!b) return;
    b.addEventListener('click', function () {
      var sup = $('ctSup').value; if (!sup) { toast('Pick a supplier'); return; }
      var custom = String($('ctCustom').value || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) { var kv = p.split(':'); return { label: kv[0], value: kv[1] || '', notes: '' }; });
      GPO.Store.upsert('contracts', {
        supplierId: sup, type: $('ctType').value,
        periodStart: $('ctStart').value, periodEnd: $('ctEnd').value,
        annualSlabs: parseSlabs($('ctAnnual').value),
        quarterlySlabs: { Q1: parseSlabs($('ctQ1').value), Q2: [], Q3: [], Q4: [] },
        customTerms: custom, notes: ''
      });
      toast('Contract saved'); renderContracts();
    });
  }
  function contractList() {
    var list = GPO.Store.all('contracts');
    if (!list.length) return '<p class="muted">No contracts yet.</p>';
    return '<table><thead><tr><th>Supplier</th><th>Type</th><th>Period</th><th>Slabs / terms</th><th></th></tr></thead><tbody>' +
      list.map(function (c) {
        var desc = c.type === 'custom' ? (c.customTerms || []).map(function (t) { return esc(t.label + ': ' + t.value); }).join('; ')
          : (c.annualSlabs || []).map(function (s) { return money(s.threshold) + '@' + (s.rebatePct * 100) + '%'; }).join(', ');
        return '<tr><td>' + esc(GPO.Store.supplierName(c.supplierId)) + '</td><td>' + esc(c.type) + '</td><td>' + esc(c.periodStart + ' → ' + c.periodEnd) + '</td><td class="muted">' + (desc || '—') + '</td><td><button class="act del sm" onclick="GPO.App.delContract(\'' + c.id + '\')">✕</button></td></tr>';
      }).join('') + '</tbody></table>';
  }
  function delContract(id) { if (confirm('Delete contract?')) { GPO.Store.remove('contracts', id); renderContracts(); } }

  // ================================================================
  // MODULE: Pricing & Margin
  // ================================================================
  function renderMargin() {
    var v = $('view-margin');
    var agg = GPO.Pricing.aggregateMargin();
    v.innerHTML =
      '<h2 class="page">Pricing, Discounts &amp; True Margin Engine</h2>' +
      '<p class="page-sub">Effective cost folds cascading discounts, conditional cash discount and bonus free-goods dilution. Aggregate margin is value-weighted across suppliers.</p>' +
      '<div class="grid g3">' +
        kpi('Blended margin', agg.blendedMarginPct + '%') +
        kpi('Weighted revenue', money(agg.totalRevenue)) +
        kpi('Weighted profit', money(agg.totalProfit)) +
      '</div>' +
      '<div class="card" style="margin-top:16px"><h3>Per-supplier true margin</h3>' +
        (agg.suppliers.length ? '<table><thead><tr><th>Supplier</th><th class="num">List cost</th><th class="num">Effective cost</th><th class="num">Selling</th><th class="num">Unit profit</th><th class="num">Margin %</th><th></th></tr></thead><tbody>' +
          agg.suppliers.map(function (m) {
            return '<tr><td>' + esc(m.name) + '</td><td class="num">' + money(m.listCost) + '</td><td class="num">' + money(m.effectiveUnitCost) + '</td><td class="num">' + money(m.sellingPrice) + '</td><td class="num">' + money(m.unitProfit) + '</td><td class="num"><span class="pill ' + (m.marginPct >= 20 ? 'ok' : m.marginPct >= 10 ? 'warn' : 'bad') + '">' + m.marginPct + '%</span></td>' +
              '<td><button class="act ghost sm" onclick="GPO.App.marginDetail(\'' + m.supplierId + '\')">Cascade</button></td></tr>';
          }).join('') + '</tbody></table>' : '<p class="muted">No suppliers. Add suppliers with cost & price to compute margin.</p>') +
      '</div><div id="mgDetail"></div>';
  }
  function marginDetail(id) {
    var s = GPO.Store.get('suppliers', id);
    var m = GPO.Pricing.supplierMargin(s);
    $('mgDetail').innerHTML = '<div class="card"><h3>Cost cascade — ' + esc(s.name) + '</h3><div class="breakdown">' +
      m.breakdown.map(function (b) { return '<div>' + esc(b.step) + ' → ' + b.value + '</div>'; }).join('') +
      '<div style="margin-top:6px">Effective unit cost <b>' + m.effectiveUnitCost + '</b> · selling ' + m.sellingPrice + ' · margin <b>' + m.marginPct + '%</b> · markup ' + m.markupPct + '%</div>' +
      '</div></div>';
    window.scrollTo(0, document.body.scrollHeight);
  }

  // ================================================================
  // MODULE: Offers & ROI
  // ================================================================
  function renderOffers() {
    var v = $('view-offers');
    var sum = GPO.Offers.summary({});
    v.innerHTML =
      '<h2 class="page">Offers &amp; Redemption ROI Tracker</h2>' +
      '<p class="page-sub">Track supplier-funded promotions by mechanism, ROI and contribution to total sellout.</p>' +
      '<div class="card"><h3>Log an offer</h3><div class="row">' +
        field('Supplier', '<select id="ofSup">' + supplierOptions('') + '</select>') +
        field('Month', '<input id="ofMonth" type="month" value="' + defaultMonth() + '">') +
        field('Mechanism', '<select id="ofMech">' + GPO.Offers.MECHANISMS.map(function (m) { return opt(m, m, ''); }).join('') + '</select>') +
        field('Item', '<input id="ofItem" placeholder="SKU / name">') +
      '</div><div class="row" style="margin-top:10px">' +
        field('Units sold', '<input id="ofUnits" type="number">') +
        field('Value sold', '<input id="ofValue" type="number">') +
        field('Supplier funding', '<input id="ofFund" type="number">') +
        field('Redemptions', '<input id="ofRed" type="number">') +
        '<div class="f" style="flex:0"><label>&nbsp;</label><button class="act" id="ofSave">Add offer</button></div>' +
      '</div></div>' +
      '<div class="grid g4">' +
        kpi('Offer value', money(sum.totalOfferValue)) +
        kpi('Total funding', money(sum.totalFunding)) +
        kpi('Blended ROI', (sum.blendedRoi != null ? sum.blendedRoi + '×' : '—')) +
        kpi('Sellout contribution', sum.contributionToSellout + '%') +
      '</div>' +
      '<div class="split" style="margin-top:16px">' +
        '<div class="card"><h3>By mechanism</h3>' + mechTable(sum.mechanisms) + '</div>' +
        '<div class="card"><h3>ROI by mechanism</h3><div class="chart-box"><canvas id="chOffers"></canvas></div></div>' +
      '</div>';
    $('ofSave').addEventListener('click', function () {
      var sup = $('ofSup').value; if (!sup) { toast('Pick a supplier'); return; }
      GPO.Store.upsert('offers', {
        supplierId: sup, month: $('ofMonth').value, mechanism: $('ofMech').value,
        itemCode: $('ofItem').value.trim(), itemName: $('ofItem').value.trim(),
        unitsSold: +$('ofUnits').value || 0, valueSold: +$('ofValue').value || 0,
        supplierFunding: +$('ofFund').value || 0, redemptions: +$('ofRed').value || 0
      });
      toast('Offer logged'); renderOffers();
    });
    var mechs = sum.mechanisms;
    destroyChart('offers');
    if (mechs.length) charts.offers = new Chart($('chOffers'), { type: 'bar',
      data: { labels: mechs.map(function (m) { return m.mechanism; }), datasets: [{ label: 'ROI (×)', data: mechs.map(function (m) { return m.roi || 0; }), backgroundColor: '#3E7A66' }] },
      options: chartOpts() });
  }
  function mechTable(mechs) {
    if (!mechs.length) return '<p class="muted">No offers logged.</p>';
    return '<table><thead><tr><th>Mechanism</th><th class="num">Units</th><th class="num">Value</th><th class="num">Funding</th><th class="num">ROI</th></tr></thead><tbody>' +
      mechs.map(function (m) { return '<tr><td>' + esc(m.mechanism) + '</td><td class="num">' + m.units.toLocaleString() + '</td><td class="num">' + money(m.value) + '</td><td class="num">' + money(m.funding) + '</td><td class="num">' + (m.roi != null ? m.roi + '×' : '—') + '</td></tr>'; }).join('') +
      '</tbody></table>';
  }

  // ================================================================
  // MODULE: Budgets (editable planned monthly value per supplier)
  // ================================================================
  function renderBudgets() {
    var v = $('view-budgets');
    var budgets = GPO.Store.all('budgets').slice().sort(function (a, b) {
      return (b.month || '').localeCompare(a.month || '') || GPO.Store.supplierName(a.supplierId).localeCompare(GPO.Store.supplierName(b.supplierId));
    });
    var totalPlanned = budgets.reduce(function (a, b) { return a + (+b.plannedValue || 0); }, 0);

    v.innerHTML =
      '<h2 class="page">Budget Management</h2>' +
      '<p class="page-sub">Set the planned monthly spend per supplier. These feed the Budget vs Actual chart on the Master Dashboard.</p>' +
      '<div class="grid g3">' +
        kpi('Budget lines', String(budgets.length), { icon: '🎯' }) +
        kpi('Total planned', money(totalPlanned), { icon: '💵', tone: 'info' }) +
        kpi('Suppliers covered', String(Object.keys(budgets.reduce(function (a, b) { a[b.supplierId] = 1; return a; }, {})).length), { icon: '🏢' }) +
      '</div>' +
      '<div class="card" style="margin-top:20px"><h3>➕ Add / update budget line</h3><div class="row">' +
        field('Supplier', '<select id="buSup">' + supplierOptions('') + '</select>') +
        field('Month', '<input id="buMonth" type="month" value="' + defaultMonth() + '">') +
        field('Planned value', '<input id="buVal" type="number" min="0" placeholder="e.g. 45000">') +
        '<div class="f" style="flex:0"><label>&nbsp;</label><button class="act" id="buSave">Save</button></div>' +
      '</div><p class="muted" style="margin-top:8px">Saving the same supplier + month updates the existing line.</p></div>' +
      '<div class="card"><h3>Budget register</h3>' +
        (budgets.length ? '<div class="tbl-wrap"><table><thead><tr><th>Month</th><th>Supplier</th><th class="num">Planned value</th><th></th></tr></thead><tbody>' +
          budgets.map(function (b) {
            return '<tr><td>' + esc(b.month) + '</td><td>' + esc(GPO.Store.supplierName(b.supplierId)) + '</td>' +
              '<td class="num"><input type="number" value="' + (b.plannedValue || 0) + '" style="max-width:130px" onchange="GPO.App.updateBudget(\'' + b.id + '\', this.value)"></td>' +
              '<td><button class="act del sm" onclick="GPO.App.delBudget(\'' + b.id + '\')">✕</button></td></tr>';
          }).join('') + '</tbody></table></div>'
          : '<div class="empty"><span class="big">🎯</span>No budgets yet. Add one above, or seed demo data.</div>') +
      '</div>';

    $('buSave').addEventListener('click', function () {
      var sup = $('buSup').value, month = $('buMonth').value, val = +$('buVal').value || 0;
      if (!sup) { toast('Pick a supplier'); return; }
      if (!month) { toast('Pick a month'); return; }
      // Idempotent per supplier+month.
      var existing = GPO.Store.all('budgets').find(function (b) { return b.supplierId === sup && b.month === month; });
      GPO.Store.upsert('budgets', { id: existing ? existing.id : undefined, supplierId: sup, month: month, plannedValue: val });
      toast('Budget saved'); renderBudgets();
    });
  }
  function updateBudget(id, val) { GPO.Store.upsert('budgets', { id: id, plannedValue: +val || 0 }); toast('Budget updated'); }
  function delBudget(id) { GPO.Store.remove('budgets', id); renderBudgets(); }

  // ================================================================
  // MODULE: Data Bridge (non-invasive import from the locked tools)
  // ================================================================
  function renderBridge() {
    var v = $('view-bridge');
    v.innerHTML =
      '<h2 class="page">Data Bridge</h2>' +
      '<p class="page-sub">Pull live data out of the two locked tools into the cloud database — without editing them. The bridge reads each tool\'s own in-memory state through the same-origin iframe and reuses its own functions.</p>' +
      '<div class="split">' +
        '<div class="card"><h3>🧾 Order Generator → Sellout</h3>' +
          '<p class="muted">Open the <b>Order Generator</b> tab, add a supplier and upload its stock + sellout files, then bridge here. Sellout quantities are mapped per branch/SKU into the cloud <code>sellout</code> collection.</p>' +
          '<div class="row"><div class="f"><label>Tag as month</label><input id="bgMonth" type="month" value="' + defaultMonth() + '"></div>' +
          '<div class="f" style="flex:0"><label>&nbsp;</label><button class="act" id="bgOrder">Bridge Order Generator</button></div></div>' +
          '<div id="bgOrderOut" style="margin-top:10px"></div></div>' +
        '<div class="card"><h3>🏭 PRO-TRACK → Orders</h3>' +
          '<p class="muted">Open the <b>PRO-TRACK SCM</b> tab, seed or commit POs via its OCR desk, then bridge here. Purchase orders + received values flow into the cloud <code>orders</code> collection so forecasting runs on live history.</p>' +
          '<div class="row"><div class="f" style="flex:0"><button class="act" id="bgTrack">Bridge PRO-TRACK</button></div></div>' +
          '<div id="bgTrackOut" style="margin-top:10px"></div></div>' +
      '</div>' +
      '<div class="note">The locked tools stay byte-for-byte unchanged. If a tab hasn\'t been opened yet this session, open it once (so its iframe loads) before bridging.</div>';

    $('bgOrder').addEventListener('click', function () {
      var res = GPO.Bridge.fromOrderGenerator({ month: $('bgMonth').value });
      $('bgOrderOut').innerHTML = res.ok
        ? '<div class="note">✅ Bridged <b>' + res.suppliers + '</b> supplier(s), <b>' + res.selloutRows + '</b> sellout rows.' + (res.skipped.length ? ' Skipped: ' + esc(res.skipped.join(', ')) : '') + '</div>'
        : '<div class="note" style="color:var(--rust)">⚠ ' + esc(res.reason) + '</div>';
      if (res.ok) toast('Order Generator bridged');
    });
    $('bgTrack').addEventListener('click', function () {
      var res = GPO.Bridge.fromProTrack();
      $('bgTrackOut').innerHTML = res.ok
        ? '<div class="note">✅ Bridged <b>' + res.suppliers + '</b> supplier(s), <b>' + res.orders + '</b> orders into live history.</div>'
        : '<div class="note" style="color:var(--rust)">⚠ ' + esc(res.reason) + '</div>';
      if (res.ok) toast('PRO-TRACK bridged');
    });
  }

  // ---- misc ----------------------------------------------------------
  function defaultMonth() {
    var months = GPO.Dashboard.availableMonths();
    if (months.length) return months[months.length - 1];
    var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function seed() { GPO.Sellout.seedDemo(); toast('Demo data seeded'); route('dashboard'); }
  function exportDb() {
    var blob = new Blob([GPO.Store.exportJson()], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gpo_database.json'; a.click(); URL.revokeObjectURL(a.href);
  }
  function importDb(files) {
    if (!files || !files[0]) return;
    var r = new FileReader();
    r.onload = function (e) { try { GPO.Store.importJson(e.target.result); toast('Database imported'); route('dashboard'); } catch (err) { toast('Invalid JSON'); } };
    r.readAsText(files[0]);
  }

  // ---- theme ---------------------------------------------------------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('gpo_theme', t); } catch (e) {}
    var b = $('themeToggle'); if (b) b.textContent = t === 'dark' ? '☀️' : '🌙';
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  // ---- auth UI -------------------------------------------------------
  function showLogin(show) { var s = $('loginScreen'); if (s) s.hidden = !show; }

  function renderAuthArea() {
    var el = $('authArea'); if (!el) return;
    if (!GPO.Auth.isCloud()) { el.innerHTML = ''; return; } // local mode: dbMode chip already says "Local"
    var u = GPO.Auth.currentUser();
    if (u) {
      var initials = (u.displayName || u.email || 'U').slice(0, 1).toUpperCase();
      var avatar = u.photoURL ? '<img src="' + esc(u.photoURL) + '" alt="">' : esc(initials);
      el.innerHTML = '<div class="user-chip"><span class="name">' + esc(u.displayName || u.email) + '</span><span class="avatar">' + avatar + '</span></div>' +
        '<button class="icon-btn" id="signOutBtn" title="Sign out" style="margin-left:8px">⎋</button>';
      var so = $('signOutBtn'); if (so) so.addEventListener('click', function () { GPO.Auth.signOut(); });
    } else {
      el.innerHTML = '<button class="act sm" id="signInBtn">Sign in</button>';
      var si = $('signInBtn'); if (si) si.addEventListener('click', function () { GPO.Auth.signIn(); });
    }
  }

  // ---- mode badge ----------------------------------------------------
  function setModeBadge() {
    var el = $('dbMode'); if (!el) return;
    if (GPO.Store.isCloud()) { el.className = 'mode-chip cloud'; el.textContent = 'Firestore · cloud'; }
    else { el.className = 'mode-chip local'; el.textContent = 'Local · offline'; }
  }

  // Auto-refresh the current view when data changes (realtime or local write).
  // Guard: don't clobber a form the user is actively typing in.
  function autoRefresh() {
    var ae = document.activeElement;
    if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    if (['tool-order', 'tool-track'].indexOf(currentRoute) >= 0) return;
    route(currentRoute);
  }

  // ---- startup -------------------------------------------------------
  var _started = false;
  function startApp() {
    if (_started) return; _started = true;
    GPO.Store.init().then(function () { setModeBadge(); route(currentRoute || 'dashboard'); })
      .catch(function (e) { console.error('[GPO.App] store init failed', e); setModeBadge(); route('dashboard'); });
  }

  function init() {
    // theme toggle
    var curTheme = document.documentElement.getAttribute('data-theme') || 'light';
    var tb = $('themeToggle');
    if (tb) { tb.textContent = curTheme === 'dark' ? '☀️' : '🌙'; tb.addEventListener('click', toggleTheme); }

    // navigation
    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.addEventListener('click', function () { route(b.dataset.route); });
    });
    var g = $('googleSignIn'); if (g) g.addEventListener('click', function () { GPO.Auth.signIn(); });

    GPO.Store.onChange(autoRefresh);

    // Auth gate: cloud mode requires sign-in before loading Firestore data.
    var cloud = GPO.Auth.init();
    renderAuthArea();
    if (!cloud) { showLogin(false); startApp(); return; }

    showLogin(true); // covered until first auth callback resolves
    GPO.Auth.onChange(function (user) {
      renderAuthArea();
      if (user) { showLogin(false); startApp(); }
      else { showLogin(true); _started = false; } // signed out -> re-gate
    });
  }
  document.addEventListener('DOMContentLoaded', init);

  return {
    route: route, seed: seed, exportDb: exportDb, importDb: importDb,
    editSupplier: editSupplier, delSupplier: delSupplier,
    delContract: delContract, marginDetail: marginDetail,
    updateBudget: updateBudget, delBudget: delBudget,
    toggleTheme: toggleTheme
  };
})();
