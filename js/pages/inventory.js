import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs } from '../db.js';
import { el, qs, esc, fmtUGX, fmtNum, debounce, toast } from '../utils.js';
import { can } from '../permissions.js';

const profile = await shellReady;
const root = qs('#page-root');

root.innerHTML = `
<div class="page-head">
  <div><h1>Inventory</h1><p>Batch-level stock · FEFO ordering</p></div>
  <div class="row"><input type="search" id="q" placeholder="Search medicine or batch…" style="min-width:240px"></div>
</div>
<div id="stats" class="stat-grid"></div>
<div id="list" class="table-wrap"></div>
`;

let batches = [];
qs('#q').addEventListener('input', debounce(paint, 150));
await load();

async function load() {
  try {
    batches = await listDocs('batches', { max: 1000 });
    paint();
  } catch (e) { qs('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function paint() {
  const value = batches.reduce((a, b) => a + Number(b.quantityRemaining || 0) * Number(b.buyingPrice || 0), 0);
  const low = batches.filter(b => b.quantityRemaining > 0 && b.quantityRemaining <= 20).length;
  const oos = batches.filter(b => (b.quantityRemaining || 0) <= 0).length;
  const now = Date.now();
  const expSoon = batches.filter(b => { const t = new Date(b.expiryDate).getTime(); return t > now && t - now < 1000 * 60 * 60 * 24 * 60; }).length;
  qs('#stats').innerHTML = `
    <div class="stat stat--info"><div class="stat__label">Inventory value</div><div class="stat__value">${fmtUGX(value)}</div><div class="stat__meta">At buying cost</div></div>
    <div class="stat stat--warn"><div class="stat__label">Low stock</div><div class="stat__value">${low}</div><div class="stat__meta">≤ 20 remaining</div></div>
    <div class="stat stat--err"><div class="stat__label">Out of stock</div><div class="stat__value">${oos}</div><div class="stat__meta">Needs replenishment</div></div>
    <div class="stat stat--warn"><div class="stat__label">Expiring ≤ 60d</div><div class="stat__value">${expSoon}</div><div class="stat__meta">Review batches</div></div>
  `;

  const q = qs('#q').value.trim().toLowerCase();
  const rows = q ? batches.filter(b => JSON.stringify(b).toLowerCase().includes(q)) : batches;
  if (!rows.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">📦</div><p class="muted">No batches found.</p></div>`; return; }
  qs('#list').innerHTML = `<table class="table">
    <thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="num">Received</th><th class="num">Remaining</th><th class="num">Buying</th><th class="num">Value</th><th></th></tr></thead>
    <tbody>${rows.map(b => {
      const exp = new Date(b.expiryDate).getTime() <= now ? '<span class="badge badge--err">EXPIRED</span>' : '';
      return `<tr>
        <td><b>${esc(b.medicineName)}</b></td>
        <td class="mono">${esc(b.batchNumber)}</td>
        <td>${esc(b.expiryDate)} ${exp}</td>
        <td class="num">${fmtNum(b.quantityReceived)}</td>
        <td class="num">${fmtNum(b.quantityRemaining)}</td>
        <td class="num">${fmtUGX(b.buyingPrice)}</td>
        <td class="num">${fmtUGX((b.quantityRemaining || 0) * (b.buyingPrice || 0))}</td>
        <td class="actions">${can(profile, 'stock.adjust') ? `<button class="btn btn--sm" data-adj="${esc(b.id)}">Adjust</button>` : ''}</td>
      </tr>`;
    }).join('')}</tbody></table>`;

  if (can(profile, 'stock.adjust')) {
    qs('#list').querySelectorAll('[data-adj]').forEach(btn => btn.onclick = () => openAdjust(batches.find(x => x.id === btn.dataset.adj)));
  }
}

function openAdjust(b) {
  import('../ops.js').then(async ({ adjustStock }) => {
    const { modal, formData, humanError, toast } = await import('../utils.js');
    modal({
      title: `Adjust ${b.medicineName}`,
      body: `<form id="af">
        <p class="muted small">Batch ${esc(b.batchNumber)} · Current: ${b.quantityRemaining}</p>
        <label class="field"><span>Adjustment (+ / −) <span class="req">*</span></span><input type="number" name="adjustQty" required placeholder="e.g. -3"></label>
        <label class="field"><span>Reason <span class="req">*</span></span><textarea name="reason" required placeholder="Physical count discrepancy…"></textarea></label>
      </form>`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Apply', class: 'btn--primary', close: false,
          onClick: async (e, close) => {
            const form = qs('#af');
            if (!form.reportValidity()) return false;
            const d = formData(form);
            try {
              await adjustStock(profile, { branchId: b.branchId, batchId: b.id, medicineId: b.medicineId, medicineName: b.medicineName, batchNumber: b.batchNumber, adjustQty: Number(d.adjustQty), reason: d.reason });
              toast('Adjustment recorded.', 'success');
              close(); load();
            } catch (err) { toast(humanError(err), 'err'); return false; }
          }
        }
      ]
    });
  });
}