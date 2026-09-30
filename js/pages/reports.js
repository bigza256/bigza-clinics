import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs } from '../db.js';
import { el, qs, esc, fmtUGX, fmtNum, todayISO } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');
root.innerHTML = `
<div class="page-head">
  <div><h1>Reports</h1><p>Sales · Inventory · Finance · Clinical</p></div>
  <div class="row">
    <input type="date" id="from"><input type="date" id="to">
    <button class="btn btn--primary" id="run">Run</button>
    <button class="btn" id="csv">Export CSV</button>
  </div>
</div>
<div id="out"></div>`;

const from = qs('#from'), to = qs('#to');
const d = new Date();
to.value = todayISO();
const past = new Date(d.getTime() - 1000 * 60 * 60 * 24 * 29);
from.value = past.toISOString().slice(0, 10);
qs('#run').addEventListener('click', run);
qs('#csv').addEventListener('click', exportCSV);

let lastRows = [];

async function run() {
  qs('#out').innerHTML = `<div class="skeleton" style="width:60%"></div>`;
  const [sales, expenses, batches] = await Promise.all([
    listDocs('sales', { order: 'createdAt', max: 2000 }),
    listDocs('expenses', { order: 'createdAt', max: 2000 }),
    listDocs('batches', { max: 2000 })
  ]);
  const inRange = (ts) => {
    if (!ts) return false;
    const dt = ts?.toDate ? ts.toDate() : new Date(ts);
    const s = dt.toISOString().slice(0, 10);
    return (!from.value || s >= from.value) && (!to.value || s <= to.value);
  };
  const salesR = sales.filter(s => inRange(s.createdAt));
  const expR = expenses.filter(e => inRange(e.createdAt));

  const totalSales = salesR.reduce((a, s) => a + Number(s.totals || 0), 0);
  const totalExp = expR.reduce((a, e) => a + Number(e.amount || 0), 0);
  const byMethod = {};
  for (const s of salesR) byMethod[s.paymentMethod || 'UNKNOWN'] = (byMethod[s.paymentMethod || 'UNKNOWN'] || 0) + Number(s.totals || 0);
  const byMed = {};
  for (const s of salesR) for (const i of (s.items || [])) byMed[i.medicineName] = (byMed[i.medicineName] || 0) + i.quantity * i.unitPrice;

  const invValue = batches.reduce((a, b) => a + Number(b.quantityRemaining || 0) * Number(b.buyingPrice || 0), 0);
  const now = Date.now();
  const expired = batches.filter(b => new Date(b.expiryDate).getTime() <= now && Number(b.quantityRemaining || 0) > 0);
  const low = batches.filter(b => b.quantityRemaining > 0 && b.quantityRemaining <= 20);

  lastRows = salesR.map(s => ({ ref: s.ref, when: s.createdAt?.toDate?.().toISOString() || '', branch: s.branchName, total: s.totals, method: s.paymentMethod, by: s.performedByName }));

  qs('#out').innerHTML = `
    <div class="stat-grid">
      <div class="stat stat--info"><div class="stat__label">Sales</div><div class="stat__value">${fmtUGX(totalSales)}</div><div class="stat__meta">${salesR.length} transactions</div></div>
      <div class="stat stat--warn"><div class="stat__label">Expenses</div><div class="stat__value">${fmtUGX(totalExp)}</div><div class="stat__meta">${expR.length} entries</div></div>
      <div class="stat stat--ok"><div class="stat__label">Net</div><div class="stat__value">${fmtUGX(totalSales - totalExp)}</div><div class="stat__meta">Sales − Expenses</div></div>
      <div class="stat"><div class="stat__label">Inventory Value</div><div class="stat__value">${fmtUGX(invValue)}</div><div class="stat__meta">At cost</div></div>
    </div>

    <div class="grid-2 mt2">
      <div class="card"><div class="card__head"><h3>Sales by payment method</h3></div>
        <div class="card__body">${Object.keys(byMethod).length ? `<table class="table"><thead><tr><th>Method</th><th class="num">Total</th></tr></thead><tbody>${Object.entries(byMethod).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmtUGX(v)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No data in range.</p>'}</div>
      </div>
      <div class="card"><div class="card__head"><h3>Top-selling medicines</h3></div>
        <div class="card__body">${Object.keys(byMed).length ? `<table class="table"><thead><tr><th>Medicine</th><th class="num">Revenue</th></tr></thead><tbody>${Object.entries(byMed).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmtUGX(v)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No data in range.</p>'}</div>
      </div>
    </div>

    <div class="grid-2 mt2">
      <div class="card"><div class="card__head"><h3>Inventory alerts</h3></div>
        <div class="card__body">
          <p>Expired batches: <b>${expired.length}</b></p>
          <p>Low stock batches: <b>${low.length}</b></p>
          <p>Total batches: <b>${batches.length}</b></p>
        </div>
      </div>
      <div class="card"><div class="card__head"><h3>Clinical activity</h3></div>
        <div class="card__body">
          <p class="muted small">Clinical aggregate reports are restricted by role. Visit <a href="visits.html">Visits</a> and <a href="laboratory.html">Laboratory</a> for detail views.</p>
        </div>
      </div>
    </div>
  `;
}

function exportCSV() {
  if (!lastRows.length) { alert('Nothing to export.'); return; }
  const cols = Object.keys(lastRows[0]);
  const csv = [cols.join(',')].concat(lastRows.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bigza-sales-${todayISO()}.csv`;
  a.click();
}

run();