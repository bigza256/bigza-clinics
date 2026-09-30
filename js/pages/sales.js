import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs } from '../db.js';
import { audit } from '../ops.js';
import { db, doc, collection, serverTimestamp, runTransaction } from '../firebase.js';
import { el, qs, esc, fmtUGX, fmtDateTime, toast, modal, humanError, debounce, confirmDialog } from '../utils.js';
import { can } from '../permissions.js';

const profile = await shellReady;
const root = qs('#page-root');
root.innerHTML = `
<div class="page-head"><div><h1>Sales</h1><p>Completed sales &amp; refunds</p></div>
  <div class="row"><input id="q" type="search" placeholder="Search ref…" style="min-width:240px"></div>
</div>
<div id="list" class="table-wrap"></div>`;

let rows = [];
qs('#q').addEventListener('input', debounce(paint, 150));
await load();

async function load() {
  rows = await listDocs('sales', { order: 'createdAt', max: 500 });
  paint();
}

function paint() {
  const q = qs('#q').value.trim().toLowerCase();
  const f = q ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(q)) : rows;
  if (!f.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">🧮</div><p class="muted">No sales yet.</p></div>`; return; }
  qs('#list').innerHTML = `<table class="table">
    <thead><tr><th>Ref</th><th>When</th><th>Branch</th><th>Items</th><th class="num">Total</th><th>Method</th><th>By</th><th></th></tr></thead>
    <tbody>${f.map(r => `
      <tr>
        <td class="mono">${esc(r.ref || r.id)}</td>
        <td>${fmtDateTime(r.createdAt)}</td>
        <td>${esc(r.branchName || r.branchId || '—')}</td>
        <td>${(r.items || []).length}</td>
        <td class="num"><b>${fmtUGX(r.totals)}</b></td>
        <td>${esc(r.paymentMethod || '—')}</td>
        <td>${esc(r.performedByName || '—')}</td>
        <td class="actions">
          <button class="btn btn--sm" data-view="${esc(r.id)}">View</button>
          ${can(profile, 'sales.refund') && r.status !== 'REFUNDED' ? `<button class="btn btn--sm btn--danger" data-refund="${esc(r.id)}">Refund</button>` : ''}
        </td>
      </tr>`).join('')}</tbody></table>`;
  qs('#list').querySelectorAll('[data-view]').forEach(b => b.onclick = () => viewSale(rows.find(x => x.id === b.dataset.view)));
  qs('#list').querySelectorAll('[data-refund]').forEach(b => b.onclick = () => refund(rows.find(x => x.id === b.dataset.refund)));
}

function viewSale(s) {
  modal({
    title: `Sale ${s.ref || s.id}`,
    body: `<dl class="kv">
      <dt>When</dt><dd>${fmtDateTime(s.createdAt)}</dd>
      <dt>Branch</dt><dd>${esc(s.branchName || s.branchId || '—')}</dd>
      <dt>Method</dt><dd>${esc(s.paymentMethod || '—')}</dd>
      <dt>By</dt><dd>${esc(s.performedByName || '—')}</dd>
      <dt>Status</dt><dd>${esc(s.status || 'COMPLETED')}</dd>
    </dl>
    <hr class="hr">
    <table class="table"><thead><tr><th>Medicine</th><th>Batch</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Subtotal</th></tr></thead>
    <tbody>${(s.items || []).map(i => `<tr><td>${esc(i.medicineName)}</td><td class="mono">${esc(i.batchNumber)}</td><td class="num">${i.quantity}</td><td class="num">${fmtUGX(i.unitPrice)}</td><td class="num">${fmtUGX(i.quantity * i.unitPrice)}</td></tr>`).join('')}</tbody></table>
    <div class="right mt2"><b>Total: ${fmtUGX(s.totals)}</b></div>`,
    actions: [{ label: 'Close' }]
  });
}

async function refund(s) {
  const ok = await confirmDialog({ title: 'Refund sale', message: `Refund ${fmtUGX(s.totals)}? Stock will be returned to original batches.`, confirmLabel: 'Refund', danger: true });
  if (!ok) return;
  try {
    await runTransaction(db, async (tx) => {
      for (const it of (s.items || [])) {
        const bRef = doc(db, 'batches', it.batchId);
        const bs = await tx.get(bRef);
        if (!bs.exists()) continue;
        tx.update(bRef, { quantityRemaining: (bs.data().quantityRemaining || 0) + it.quantity, updatedAt: serverTimestamp() });
        tx.set(doc(collection(db, 'stockLedger')), {
          branchId: s.branchId, medicineId: it.medicineId, medicineName: it.medicineName,
          batchId: it.batchId, batchNumber: it.batchNumber,
          transactionType: 'RETURN', referenceId: s.id, reference: s.ref,
          quantityIn: it.quantity, quantityOut: 0, reason: 'Refund',
          performedBy: profile.uid, performedByName: profile.fullName, timestamp: serverTimestamp()
        });
      }
      tx.update(doc(db, 'sales', s.id), { status: 'REFUNDED', refundedAt: serverTimestamp(), refundedBy: profile.uid });
      tx.set(doc(collection(db, 'financialLedger')), {
        branchId: s.branchId, type: 'REFUND', referenceId: s.id, reference: s.ref,
        description: `Refund of ${s.ref}`, debit: Number(s.totals || 0), credit: 0,
        paymentMethod: s.paymentMethod || 'CASH',
        performedBy: profile.uid, performedByName: profile.fullName, timestamp: serverTimestamp()
      });
    });
    await audit(profile, 'REFUND', { saleId: s.id, ref: s.ref, amount: s.totals });
    toast('Refund recorded.', 'success');
    load();
  } catch (e) { toast(humanError(e), 'err'); }
}