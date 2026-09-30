import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { db, doc, collection, serverTimestamp, runTransaction, addDoc } from '../firebase.js';
import { listDocs } from '../db.js';
import { audit } from '../ops.js';
import { el, qs, esc, fmtUGX, fmtDateTime, toast, modal, humanError, debounce } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');
root.innerHTML = `
<div class="page-head">
  <div><h1>Dispensing Queue</h1><p>Pending prescriptions</p></div>
  <div class="row">
    <select id="status">
      <option value="PENDING">Pending</option>
      <option value="DISPENSED">Dispensed</option>
      <option value="">All</option>
    </select>
    <input id="q" type="search" placeholder="Search client or medicine…" style="min-width:220px">
  </div>
</div>
<div id="list" class="table-wrap"></div>`;

let rows = [];
qs('#status').addEventListener('change', load);
qs('#q').addEventListener('input', debounce(paint, 150));

await load();

async function load() {
  qs('#list').innerHTML = `<div style="padding:1.5rem"><div class="skeleton" style="width:50%"></div><div class="skeleton mt2" style="width:70%"></div></div>`;
  try {
    const status = qs('#status').value;
    const where = status ? [['status', '==', status]] : [];
    rows = await listDocs('prescriptions', { where, order: 'createdAt', max: 300 });
    paint();
  } catch (e) { qs('#list').innerHTML = `<div class="empty">${esc(humanError(e))}</div>`; }
}

function paint() {
  const q = qs('#q').value.trim().toLowerCase();
  const f = q ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(q)) : rows;
  if (!f.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">📤</div><p class="muted">No prescriptions.</p></div>`; return; }
  qs('#list').innerHTML = `<table class="table">
    <thead><tr><th>When</th><th>Client</th><th>Medicine</th><th class="num">Qty</th><th>Instructions</th><th>Status</th><th></th></tr></thead>
    <tbody>${f.map(r => `<tr>
      <td>${fmtDateTime(r.createdAt)}</td>
      <td><b>${esc(r.clientName || '—')}</b></td>
      <td>${esc(r.medicineName)}<span class="subtle">${esc(r.strength || '')} · ${esc(r.dosage || '')}</span></td>
      <td class="num">${r.quantity}</td>
      <td class="small">${esc(r.instructions || '—')}</td>
      <td><span class="badge ${r.status === 'DISPENSED' ? 'badge--ok' : 'badge--warn'}">${esc(r.status || '—')}</span></td>
      <td class="actions">
        ${r.status === 'PENDING' ? `<button class="btn btn--sm btn--primary" data-disp="${esc(r.id)}">Dispense</button>` : ''}
      </td>
    </tr>`).join('')}</tbody></table>`;
  qs('#list').querySelectorAll('[data-disp]').forEach(b => b.onclick = () => openDispense(f.find(x => x.id === b.dataset.disp)));
}

async function openDispense(rx) {
  // Find batches for this medicine on this branch, order FEFO
  let batches = [];
  try {
    batches = await listDocs('batches', {
      where: [
        ['medicineId', '==', rx.medicineId],
        ['quantityRemaining', '>', 0]
      ],
      max: 50
    });
    if (rx.branchId) batches = batches.filter(b => !b.branchId || b.branchId === rx.branchId);
    batches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
  } catch (e) { toast(humanError(e), 'err'); return; }

  if (!batches.length) { toast('No stock available for this medicine.', 'warn'); return; }
  const suggested = batches[0];

  modal({
    title: `Dispense — ${rx.medicineName}`,
    body: `<form id="df">
      <p class="muted small">Prescribed quantity: <b>${rx.quantity}</b> for ${esc(rx.clientName || 'client')}</p>
      <label class="field"><span>Batch (FEFO suggested) <span class="req">*</span></span>
        <select name="batchId" required>
          ${batches.map((b, i) => `<option value="${esc(b.id)}"${i === 0 ? ' selected' : ''} data-remaining="${b.quantityRemaining}" data-price="${b.sellingPrice || b.buyingPrice || 0}">
            ${esc(b.batchNumber)} · Exp ${esc(b.expiryDate)} · ${b.quantityRemaining} left · ${fmtUGX(b.sellingPrice || b.buyingPrice || 0)}
          </option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Quantity to dispense <span class="req">*</span></span>
        <input type="number" name="quantity" min="1" required value="${rx.quantity}">
      </label>
      <label class="field"><span>Payment method</span>
        <select name="paymentMethod"><option>CASH</option><option>MOBILE_MONEY</option><option>BANK</option><option>CARD</option><option>INSURANCE</option></select>
      </label>
      <label class="check"><input type="checkbox" name="charge" checked> <span>Record sale (charge patient)</span></label>
      <label class="field mt2"><span>Notes</span><textarea name="notes" rows="2"></textarea></label>
    </form>`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Confirm dispense', class: 'btn--primary', close: false,
        onClick: async (e, close) => {
          const form = qs('#df');
          if (!form.reportValidity()) return false;
          const fd = new FormData(form);
          const batchId = fd.get('batchId');
          const quantity = Number(fd.get('quantity'));
          const charge = fd.get('charge') === 'on';
          const paymentMethod = fd.get('paymentMethod');
          const notes = fd.get('notes');
          const batch = batches.find(b => b.id === batchId);
          if (!batch) { toast('Batch not found', 'err'); return false; }
          if (quantity > batch.quantityRemaining) { toast('Not enough stock in that batch.', 'err'); return false; }
          try {
            await dispenseRx(rx, batch, quantity, { charge, paymentMethod, notes });
            toast('Dispensed successfully.', 'success');
            close(); load();
          } catch (err) { toast(humanError(err), 'err'); return false; }
        }
      }
    ]
  });
}

async function dispenseRx(rx, batch, quantity, { charge, paymentMethod, notes }) {
  const unitPrice = Number(batch.sellingPrice || batch.buyingPrice || 0);
  const total = quantity * unitPrice;
  const dispRef = 'DSP-' + Date.now();
  const saleDocRef = doc(collection(db, 'sales'));

  await runTransaction(db, async (tx) => {
    const bRef = doc(db, 'batches', batch.id);
    const bs = await tx.get(bRef);
    if (!bs.exists()) throw new Error('Batch no longer exists');
    const remaining = Number(bs.data().quantityRemaining || 0);
    if (remaining < quantity) throw new Error('Insufficient stock');

    tx.update(bRef, { quantityRemaining: remaining - quantity, updatedAt: serverTimestamp() });

    // Update prescription
    tx.update(doc(db, 'prescriptions', rx.id), {
      status: 'DISPENSED',
      dispensedBy: profile.uid,
      dispensedByName: profile.fullName,
      dispensedAt: serverTimestamp(),
      dispensedBatchId: batch.id,
      dispensedBatchNumber: batch.batchNumber,
      dispensedQty: quantity,
      notes: notes || null
    });

    // Stock ledger
    tx.set(doc(collection(db, 'stockLedger')), {
      branchId: rx.branchId || batch.branchId || profile.branchId,
      medicineId: rx.medicineId, medicineName: rx.medicineName,
      batchId: batch.id, batchNumber: batch.batchNumber,
      transactionType: 'DISPENSING',
      referenceId: rx.id, reference: dispRef,
      quantityIn: 0, quantityOut: quantity, unitCost: unitPrice,
      reason: 'Dispensed against prescription',
      performedBy: profile.uid, performedByName: profile.fullName,
      timestamp: serverTimestamp()
    });

    // Sale + financial entries only if charging
    if (charge) {
      tx.set(saleDocRef, {
        ref: dispRef,
        receiptRef: 'BZ-RCP-' + dispRef,
        branchId: rx.branchId || batch.branchId,
        items: [{
          medicineId: rx.medicineId, medicineName: rx.medicineName,
          batchId: batch.id, batchNumber: batch.batchNumber,
          quantity, unitPrice
        }],
        totals: total,
        paymentMethod,
        amountPaid: total,
        clientId: rx.clientId || null,
        clientName: rx.clientName || null,
        source: 'DISPENSING',
        performedBy: profile.uid, performedByName: profile.fullName,
        status: 'COMPLETED',
        createdAt: serverTimestamp()
      });
      tx.set(doc(collection(db, 'financialLedger')), {
        branchId: rx.branchId || batch.branchId,
        type: 'SALE', referenceId: saleDocRef.id, reference: dispRef,
        description: `Dispensing — ${rx.medicineName}`,
        debit: 0, credit: total, paymentMethod,
        performedBy: profile.uid, performedByName: profile.fullName,
        timestamp: serverTimestamp()
      });
      tx.set(doc(collection(db, 'payments')), {
        branchId: rx.branchId || batch.branchId,
        referenceId: saleDocRef.id, reference: dispRef,
        amount: total, paymentMethod,
        clientId: rx.clientId || null,
        direction: 'IN', status: 'COMPLETED',
        performedBy: profile.uid, performedByName: profile.fullName,
        timestamp: serverTimestamp()
      });
    }
  });

  await audit(profile, 'DISPENSING', {
    prescriptionId: rx.id, medicine: rx.medicineName,
    batch: batch.batchNumber, quantity, charged: charge, total
  });
}