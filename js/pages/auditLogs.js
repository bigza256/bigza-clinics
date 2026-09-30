import { shellReady } from '../shell.js';
import { listDocs } from '../db.js';
import { el, qs, esc, fmtDateTime, debounce } from '../utils.js';

await shellReady;
const root = qs('#page-root');
root.innerHTML = `
<div class="page-head"><div><h1>Audit Logs</h1><p>Immutable trail of actions</p></div>
  <div class="row"><input id="q" type="search" placeholder="Search…" style="min-width:240px"></div>
</div>
<div id="list" class="table-wrap"></div>`;

let rows = [];
qs('#q').addEventListener('input', debounce(paint, 150));
await load();

async function load() {
  rows = await listDocs('auditLogs', { order: 'timestamp', max: 500 });
  paint();
}

function paint() {
  const q = qs('#q').value.trim().toLowerCase();
  const f = q ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(q)) : rows;
  if (!f.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">🛡️</div><p class="muted">No audit entries.</p></div>`; return; }
  qs('#list').innerHTML = `<table class="table">
    <thead><tr><th>When</th><th>User</th><th>Role</th><th>Action</th><th>Detail</th></tr></thead>
    <tbody>${f.map(r => `<tr>
      <td>${fmtDateTime(r.timestamp)}</td>
      <td>${esc(r.userName || '—')}</td>
      <td>${esc(r.role || '—')}</td>
      <td><span class="badge">${esc(r.action || '—')}</span></td>
      <td class="small">${esc(JSON.stringify(r.detail || {}).slice(0, 120))}</td>
    </tr>`).join('')}</tbody></table>`;
}