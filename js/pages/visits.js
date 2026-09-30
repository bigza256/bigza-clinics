import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs } from '../db.js';
import { el, qs, esc, fmtDateTime, toast, debounce, modal, formData, humanError } from '../utils.js';
import { can } from '../permissions.js';

const profile = await shellReady;
const root = qs('#page-root');
root.innerHTML = `
<div class="page-head">
  <div><h1>Visits</h1><p>All clinical visits</p></div>
  <div class="row">
    <input id="q" type="search" placeholder="Search client, reason…" style="min-width:240px">
    <select id="status">
      <option value="">All statuses</option>
      <option>OPEN</option><option>CLOSED</option><option>CANCELLED</option>
    </select>
  </div>
</div>
<div id="list" class="table-wrap"></div>`;

let rows = [];
qs('#q').addEventListener('input', debounce(paint, 150));
qs('#status').addEventListener('change', paint);
await load();

async function load() {
  try { rows = await listDocs('visits', { order: 'createdAt', max: 400 }); paint(); }
  catch (e) { qs('#list').innerHTML = `<div class="empty">${esc(humanError(e))}</div>`; }
}

function paint() {
  const q = qs('#q').value.trim().toLowerCase();
  const s = qs('#status').value;
  const f = rows.filter(r => (!s || r.status === s) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
  if (!f.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">🗂️</div><p class="muted">No visits.</p></div>`; return; }
  qs('#list').innerHTML = `<table class="table">
    <thead><tr><th>When</th><th>Client</th><th>Reason</th><th>Clinician</th><th>Status</th><th></th></tr></thead>
    <tbody>${f.map(v => `<tr>
      <td>${fmtDateTime(v.createdAt)}</td>
      <td><b>${esc(v.clientName || '—')}</b><span class="subtle">${esc(v.clientRef || '')}</span></td>
      <td>${esc(v.reason || '—')}</td>
      <td>${esc(v.clinicianName || '—')}</td>
      <td><span class="badge ${v.status === 'CLOSED' ? 'badge--ok' : v.status === 'CANCELLED' ? 'badge--err' : 'badge--warn'}">${esc(v.status || '—')}</span></td>
      <td class="actions">
        ${can(profile, 'clinical.edit') && v.status !== 'CLOSED' ? `<a class="btn btn--sm" href="consultation.html?visitId=${esc(v.id)}&clientId=${esc(v.clientId || '')}">Consult</a>` : ''}
        ${can(profile, 'clinical.edit') && v.status !== 'CLOSED' ? `<button class="btn btn--sm" data-close="${esc(v.id)}">Close</button>` : ''}
      </td>
    </tr>`).join('')}</tbody></table>`;

  qs('#list').querySelectorAll('[data-close]').forEach(b => b.onclick = async () => {
    try {
      const { update } = await import('../db.js');
      await update('visits', b.dataset.close, { status: 'CLOSED' });
      const { audit } = await import('../ops.js');
      await audit(profile, 'VISIT_CLOSED', { visitId: b.dataset.close });
      toast('Visit closed.', 'success');
      load();
    } catch (e) { toast(humanError(e), 'err'); }
  });
}