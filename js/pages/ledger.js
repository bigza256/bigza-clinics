import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs } from '../db.js';
import { el, qs, esc, fmtUGX, fmtDateTime, debounce } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');
root.innerHTML = `
<div class="page-head">
  <div><h1>Financial Ledger</h1><p>Immutable record of money movements</p></div>
  <div class="row">
    <select id="type"><option value="">All types</option><option>SALE</option><option>PURCHASE</option><option>EXPENSE</option><option>PAYMENT</option><option>REFUND</option></select>
    <input id="q" type="search" placeholder="Search…" style="min-width:220px">
  </div>
</div>
<div id="totals" class="stat-grid"></div>
<div id="list" class="table-wrap"></div>`;

let rows = [];
qs('#type').addEventListener('change', paint);
qs('#q').addEventListener('input', debounce(paint, 150));
await load();

async function load() {
  rows = await listDocs('financialLedger', { order: 'timestamp', max: 500 });
  paint();
}

function paint() {
  const type = qs('#type').value;
  const q = qs('#q').value.trim().toLowerCase();
  const f = rows.filter(r => (!type || r.type === type) && (!q || JSON.stringify(r).toLowerCase().includes(q)));

  const debits = f.reduce((a, r) => a + Number(r.debit || 0), 0);
  const credits = f.reduce((a, r) => a + Number(r.credit || 0), 0);
  qs('#totals').innerHTML = `
    <div class="stat stat--err"><div class="stat__label">Debits</div><div class="stat__value">${fmtUGX(debits)}</div><div class="stat__meta">Money out / owed</div></div>
    <div class="stat stat--ok"><div class="stat__label">Credits</div><div class="stat__value">${fmtUGX(credits)}</div><div class="stat__meta">Money in</div></div>
    <div class="stat stat--info"><div class="stat__label">Net</div><div class="stat__value">${fmtUGX(credits - debits)}</div><div class="stat__meta">Credits − Debits</div></div>
    <div class="stat"><div class="stat__label">Entries</div><div class="stat__value">${f.length}</div><div class="stat__meta">of ${rows.length} total</div></div>
  `;

  if (!f.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">📒</div><p class="muted">No entries.</p></div>`; return; }
  qs('#list').innerHTML = `<table class="table">
    <thead><tr><th>When</th><th>Type</th><th>Reference</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th>Method</th><th>By</th></tr></thead>
    <tbody>${f.map(r => `<tr>
      <td>${fmtDateTime(r.timestamp)}</td>
      <td><span class="badge badge--info">${esc(r.type)}</span></td>
      <td class="mono">${esc(r.reference || '—')}</td>
      <td>${esc(r.description || '—')}</td>
      <td class="num">${r.debit ? fmtUGX(r.debit) : '—'}</td>
      <td class="num">${r.credit ? fmtUGX(r.credit) : '—'}</td>
      <td>${esc(r.paymentMethod || '—')}</td>
      <td>${esc(r.performedByName || '—')}</td>
    </tr>`).join('')}</tbody></table>`;
}