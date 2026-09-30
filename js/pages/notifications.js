import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs, update } from '../db.js';
import { db, doc, collection, addDoc, serverTimestamp } from '../firebase.js';
import { audit } from '../ops.js';
import { el, qs, esc, fmtDateTime, toast, humanError, debounce } from '../utils.js';
import { can } from '../permissions.js';

const profile = await shellReady;
const root = qs('#page-root');

root.innerHTML = `
<div class="page-head">
  <div><h1>Notifications</h1><p>System alerts &amp; operational reminders</p></div>
  <div class="row">
    <select id="filter">
      <option value="">All</option>
      <option>UNREAD</option>
      <option>LOW_STOCK</option><option>OUT_OF_STOCK</option><option>EXPIRING</option><option>EXPIRED</option>
      <option>PENDING_TRANSFER</option><option>CASH_DISCREPANCY</option><option>STOCK_DISCREPANCY</option>
    </select>
    <button class="btn" id="refresh">⟳ Scan for alerts</button>
    <button class="btn" id="readall">Mark all read</button>
  </div>
</div>
<div id="list" class="list-rows" style="background:#fff;border:1px solid var(--line);border-radius:var(--radius)"></div>`;

let rows = [];
qs('#filter').addEventListener('change', paint);
qs('#refresh').addEventListener('click', scanAlerts);
qs('#readall').addEventListener('click', markAllRead);

await load();

async function load() {
  try {
    rows = await listDocs('notifications', { order: 'createdAt', max: 200 });
    paint();
  } catch (e) { qs('#list').innerHTML = `<div class="empty">${esc(humanError(e))}</div>`; }
}

function paint() {
  const f = qs('#filter').value;
  let list = rows;
  if (f === 'UNREAD') list = rows.filter(r => !r.read);
  else if (f) list = rows.filter(r => r.type === f);
  if (!list.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">🔔</div><p class="muted">Nothing here.</p></div>`; return; }
  qs('#list').innerHTML = list.map(n => `
    <div style="${n.read ? '' : 'background:#F7F9FD;'}">
      <div style="width:42px;height:42px;border-radius:12px;background:#EEF2FD;display:grid;place-items:center;font-size:1.2rem">${iconFor(n.type)}</div>
      <div class="list-rows__main">
        <b>${esc(n.title || n.type)}${n.read ? '' : ' <span class="badge badge--info">NEW</span>'}</b>
        <span>${esc(n.message || '')} · ${fmtDateTime(n.createdAt)}</span>
      </div>
      ${!n.read ? `<button class="btn btn--sm" data-read="${esc(n.id)}">Mark read</button>` : ''}
    </div>`).join('');
  qs('#list').querySelectorAll('[data-read]').forEach(b => b.onclick = () => markRead(b.dataset.read));
}

function iconFor(t) {
  return ({ LOW_STOCK: '⚠️', OUT_OF_STOCK: '🚫', EXPIRING: '⏳', EXPIRED: '⛔',
            PENDING_TRANSFER: '🔄', CASH_DISCREPANCY: '💰', STOCK_DISCREPANCY: '📦' })[t] || '🔔';
}

async function markRead(id) {
  try {
    await update('notifications', id, { read: true, readAt: serverTimestamp(), readBy: profile.uid });
    toast('Marked as read.', 'success');
    await load();
  } catch (e) { toast(humanError(e), 'err'); }
}

async function markAllRead() {
  const unread = rows.filter(r => !r.read);
  if (!unread.length) return;
  try {
    await Promise.all(unread.map(n => update('notifications', n.id, { read: true, readAt: serverTimestamp(), readBy: profile.uid })));
    toast('All marked read.', 'success');
    await load();
  } catch (e) { toast(humanError(e), 'err'); }
}

async function scanAlerts() {
  if (!can(profile, 'notifications.view')) return;
  const btn = qs('#refresh');
  btn.disabled = true; btn.textContent = 'Scanning…';
  try {
    const batches = await listDocs('batches', { max: 2000 });
    const now = Date.now();
    const WARN = 1000 * 60 * 60 * 24 * 60;
    const problems = [];
    for (const b of batches) {
      const rem = Number(b.quantityRemaining || 0);
      if (rem === 0) problems.push({ type: 'OUT_OF_STOCK', title: `Out of stock: ${b.medicineName}`, message: `Batch ${b.batchNumber} at ${b.branchId}` });
      else if (rem <= 20) problems.push({ type: 'LOW_STOCK', title: `Low stock: ${b.medicineName}`, message: `${rem} left in batch ${b.batchNumber}` });
      const exp = new Date(b.expiryDate).getTime();
      if (exp <= now && rem > 0) problems.push({ type: 'EXPIRED', title: `Expired: ${b.medicineName}`, message: `Batch ${b.batchNumber} expired on ${b.expiryDate}` });
      else if (exp > now && exp - now < WARN && rem > 0) problems.push({ type: 'EXPIRING', title: `Expiring soon: ${b.medicineName}`, message: `Batch ${b.batchNumber} expires ${b.expiryDate}` });
    }
    // Cap to avoid flooding
    const created = [];
    for (const p of problems.slice(0, 50)) {
      const ref = await addDoc(collection(db, 'notifications'), {
        ...p, branchId: profile.branchId || null, read: false,
        createdBy: profile.uid, createdAt: serverTimestamp()
      });
      created.push(ref.id);
    }
    await audit(profile, 'NOTIFICATION_SCAN', { created: created.length });
    toast(`${created.length} notifications generated.`, 'success');
    await load();
  } catch (e) { toast(humanError(e), 'err'); }
  finally { btn.disabled = false; btn.textContent = '⟳ Scan for alerts'; }
}