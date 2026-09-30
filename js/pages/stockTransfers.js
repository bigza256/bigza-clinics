import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { db, doc, collection, serverTimestamp, runTransaction, addDoc } from '../firebase.js';
import { listDocs, addDocAuto } from '../db.js';
import { audit } from '../ops.js';
import { el, qs, esc, fmtDate, fmtDateTime, toast, modal, formData, humanError, debounce } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');

root.innerHTML = `
<div class="page-head">
  <div><h1>Stock Transfers</h1><p>Branch-to-branch stock movement</p></div>
  <div class="row">
    <select id="status">
      <option value="">All</option>
      <option>REQUESTED</option><option>APPROVED</option><option>DISPATCHED</option><option>RECEIVED</option><option>CANCELLED</option>
    </select>
    <button class="btn btn--primary" id="new">+ New transfer</button>
  </div>
</div>
<div id="list" class="table-wrap"></div>`;

let rows = [];
let branches = [];
let batches = [];

qs('#status').addEventListener('change', paint);
qs('#new').addEventListener('click', openNew);

await loadAll();

async function loadAll() {
  try {
    [rows, branches] = await Promise.all([
      listDocs('stockTransfers', { order: 'createdAt', max: 300 }),
      listDocs('branches', { max: 100 })
    ]);
    batches = await listDocs('batches', { where: [['quantityRemaining', '>', 0]], max: 1500 });
    paint();
  } catch (e) { qs('#list').innerHTML = `<div class="empty">${esc(humanError(e))}</div>`; }
}

function paint() {
  const s = qs('#status').value;
  const f = s ? rows.filter(r => r.status === s) : rows;
  if (!f.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">🔄</div><p class="muted">No transfers yet.</p></div>`; return; }
  qs('#list').innerHTML = `<table class="table">
    <thead><tr><th>Ref</th><th>Created</th><th>From</th><th>To</th><th>Lines</th><th>Status</th><th></th></tr></thead>
    <tbody>${f.map(r => `<tr>
      <td class="mono">${esc(r.ref || r.id)}</td>
      <td>${fmtDateTime(r.createdAt)}</td>
      <td>${esc(branchName(r.fromBranchId))}</td>
      <td>${esc(branchName(r.toBranchId))}</td>
      <td>${(r.items || []).length}</td>
      <td><span class="badge ${statusBadge(r.status)}">${esc(r.status)}</span></td>
      <td class="actions"><button class="btn btn--sm" data-open="${esc(r.id)}">Open</button></td>
    </tr>`).join('')}</tbody></table>`;
  qs('#list').querySelectorAll('[data-open]').forEach(b => b.onclick = () => openTransfer(rows.find(x => x.id === b.dataset.open)));
}

function branchName(id) { return (branches.find(b => b.id === id) || {}).name || id; }
function statusBadge(s) {
  return { REQUESTED: 'badge--warn', APPROVED: 'badge--info', DISPATCHED: 'badge--purple', RECEIVED: 'badge--ok', CANCELLED: 'badge--err' }[s] || '';
}

function openNew() {
  const lines = [];
  modal({
    title: 'New stock transfer',
    body: `<form id="tf">
      <div class="field-row">
        <label class="field"><span>From branch <span class="req">*</span></span>
          <select name="fromBranchId" required>
            <option value="">Select…</option>
            ${branches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>To branch <span class="req">*</span></span>
          <select name="toBranchId" required>
            <option value="">Select…</option>
            ${branches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="field"><span>Notes</span><textarea name="notes" rows="2"></textarea></label>
      <hr class="hr">
      <h4>Lines</h4>
      <div id="tx-lines"><div class="empty small">Add lines below.</div></div>
      <div class="field-row">
        <label class="field"><span>Batch</span>
          <select id="lbatch"><option value="">Select batch…</option>${batches.map(b => `<option value="${esc(b.id)}">${esc(b.medicineName)} · ${esc(b.batchNumber)} · ${b.quantityRemaining} left</option>`).join('')}</select>
        </label>
        <label class="field"><span>Quantity</span><input type="number" id="lqty" min="1"></label>
      </div>
      <button type="button" class="btn" id="addline">+ Add line</button>
    </form>`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create request', class: 'btn--primary', close: false,
        onClick: async (e, close) => {
          const form = qs('#tf');
          if (!form.reportValidity()) return false;
          if (lines.length === 0) { toast('Add at least one line.', 'warn'); return false; }
          const d = formData(form);
          if (d.fromBranchId === d.toBranchId) { toast('From and To must differ.', 'warn'); return false; }
          try {
            const ref = `BZ-TRF-${branchName(d.fromBranchId).slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}`;
            await addDocAuto('stockTransfers', {
              ref,
              fromBranchId: d.fromBranchId, toBranchId: d.toBranchId,
              items: lines, status: 'REQUESTED',
              notes: d.notes || null,
              requestedBy: profile.uid, requestedByName: profile.fullName,
              branchId: d.fromBranchId
            });
            await audit(profile, 'TRANSFER_REQUESTED', { ref, from: d.fromBranchId, to: d.toBranchId, lines: lines.length });
            toast(`Transfer ${ref} created.`, 'success');
            close();
            await loadAll();
          } catch (err) { toast(humanError(err), 'err'); return false; }
        }
      }
    ],
    onMount: (body) => {
      const paintLines = () => {
        const box = body.querySelector('#tx-lines');
        if (!lines.length) { box.innerHTML = `<div class="empty small">Add lines below.</div>`; return; }
        box.innerHTML = `<table class="table"><thead><tr><th>Medicine</th><th>Batch</th><th class="num">Qty</th><th></th></tr></thead>
          <tbody>${lines.map((l, i) => `<tr><td>${esc(l.medicineName)}</td><td class="mono">${esc(l.batchNumber)}</td><td class="num">${l.quantity}</td>
            <td class="actions"><button type="button" class="btn btn--sm" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table>`;
        box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.del, 1); paintLines(); });
      };
      body.querySelector('#addline').onclick = () => {
        const bid = body.querySelector('#lbatch').value;
        const qty = Number(body.querySelector('#lqty').value);
        if (!bid || !qty) { toast('Select a batch and enter quantity.', 'warn'); return; }
        const b = batches.find(x => x.id === bid);
        if (!b) return;
        if (qty > b.quantityRemaining) { toast('Quantity exceeds available stock.', 'warn'); return; }
        lines.push({ batchId: b.id, medicineId: b.medicineId, medicineName: b.medicineName, batchNumber: b.batchNumber, quantity: qty });
        paintLines();
        body.querySelector('#lqty').value = '';
      };
    }
  });
}

function openTransfer(t) {
  const items = t.items || [];
  const itemsHtml = items.length ? `<table class="table">
    <thead><tr><th>Medicine</th><th>Batch</th><th class="num">Qty</th></tr></thead>
    <tbody>${items.map(i => `<tr><td>${esc(i.medicineName)}</td><td class="mono">${esc(i.batchNumber)}</td><td class="num">${i.quantity}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty small">No lines.</div>`;

  const actions = [];
  if (t.status === 'REQUESTED') {
    actions.push({ label: 'Approve', class: 'btn--primary', onClick: async () => { await transition(t, 'APPROVED'); return true; } });
    actions.push({ label: 'Cancel', class: 'btn--danger', onClick: async () => { await transition(t, 'CANCELLED'); return true; } });
  }
  if (t.status === 'APPROVED') {
    actions.push({ label: 'Dispatch', class: 'btn--primary', onClick: async () => { await dispatch(t); return true; } });
  }
  if (t.status === 'DISPATCHED') {
    actions.push({ label: 'Receive', class: 'btn--primary', onClick: async () => { await receive(t); return true; } });
  }
  actions.push({ label: 'Close' });

  modal({
    title: `Transfer ${t.ref || t.id}`,
    body: `<dl class="kv">
      <dt>From</dt><dd>${esc(branchName(t.fromBranchId))}</dd>
      <dt>To</dt><dd>${esc(branchName(t.toBranchId))}</dd>
      <dt>Status</dt><dd><span class="badge ${statusBadge(t.status)}">${esc(t.status)}</span></dd>
      <dt>Requested</dt><dd>${fmtDateTime(t.createdAt)}</dd>
      <dt>By</dt><dd>${esc(t.requestedByName || '—')}</dd>
      <dt>Notes</dt><dd>${esc(t.notes || '—')}</dd>
    </dl>
    <hr class="hr">
    ${itemsHtml}`,
    actions
  });
}

async function transition(t, nextStatus) {
  try {
    const { update } = await import('../db.js');
    await update('stockTransfers', t.id, { status: nextStatus, updatedBy: profile.uid, updatedAt: serverTimestamp() });
    await audit(profile, 'TRANSFER_' + nextStatus, { transferId: t.id, ref: t.ref });
    toast(`Transfer ${nextStatus.toLowerCase()}.`, 'success');
    await loadAll();
  } catch (e) { toast(humanError(e), 'err'); }
}

async function dispatch(t) {
  try {
    await runTransaction(db, async (tx) => {
      for (const it of t.items || []) {
        const bRef = doc(db, 'batches', it.batchId);
        const bs = await tx.get(bRef);
        if (!bs.exists()) throw new Error('Batch not found');
        const rem = Number(bs.data().quantityRemaining || 0);
        if (rem < it.quantity) throw new Error(`Insufficient stock in batch ${it.batchNumber}`);
        tx.update(bRef, { quantityRemaining: rem - it.quantity, updatedAt: serverTimestamp() });
        tx.set(doc(collection(db, 'stockLedger')), {
          branchId: t.fromBranchId, medicineId: it.medicineId, medicineName: it.medicineName,
          batchId: it.batchId, batchNumber: it.batchNumber,
          transactionType: 'TRANSFER_OUT', referenceId: t.id, reference: t.ref,
          quantityIn: 0, quantityOut: it.quantity, reason: 'Transfer dispatch',
          performedBy: profile.uid, performedByName: profile.fullName, timestamp: serverTimestamp()
        });
      }
      tx.update(doc(db, 'stockTransfers', t.id), { status: 'DISPATCHED', dispatchedBy: profile.uid, dispatchedAt: serverTimestamp() });
    });
    await audit(profile, 'TRANSFER_DISPATCHED', { transferId: t.id, ref: t.ref });
    toast('Dispatched.', 'success');
    await loadAll();
  } catch (e) { toast(humanError(e), 'err'); }
}

async function receive(t) {
  try {
    await runTransaction(db, async (tx) => {
      for (const it of t.items || []) {
        const bRef = doc(db, 'batches', it.batchId);
        const bs = await tx.get(bRef);
        if (!bs.exists()) throw new Error('Batch missing');
        const bdata = bs.data();
        // Create a new batch on the destination branch mirroring the source
        const newBatchRef = doc(collection(db, 'batches'));
        tx.set(newBatchRef, {
          ...bdata,
          branchId: t.toBranchId,
          quantityReceived: it.quantity,
          quantityRemaining: it.quantity,
          receivedDate: new Date().toISOString().slice(0, 10),
          receivedBy: profile.uid,
          receivedByName: profile.fullName,
          sourceTransferId: t.id,
          createdAt: serverTimestamp()
        });
        tx.set(doc(collection(db, 'stockLedger')), {
          branchId: t.toBranchId, medicineId: it.medicineId, medicineName: it.medicineName,
          batchId: newBatchRef.id, batchNumber: it.batchNumber,
          transactionType: 'TRANSFER_IN', referenceId: t.id, reference: t.ref,
          quantityIn: it.quantity, quantityOut: 0, reason: 'Transfer receipt',
          performedBy: profile.uid, performedByName: profile.fullName, timestamp: serverTimestamp()
        });
      }
      tx.update(doc(db, 'stockTransfers', t.id), { status: 'RECEIVED', receivedBy: profile.uid, receivedAt: serverTimestamp() });
    });
    await audit(profile, 'TRANSFER_RECEIVED', { transferId: t.id, ref: t.ref });
    toast('Received.', 'success');
    await loadAll();
  } catch (e) { toast(humanError(e), 'err'); }
}