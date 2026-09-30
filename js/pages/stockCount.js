import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs, addDocAuto, nextCounter } from '../db.js';
import { db, doc, collection, serverTimestamp, runTransaction } from '../firebase.js';
import { audit } from '../ops.js';
import { el, qs, esc, fmtUGX, fmtNum, toast, modal, humanError, todayISO } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');

root.innerHTML = `
<div class="page-head">
  <div><h1>Stock Count</h1><p>Physical stock-taking &amp; variance recording</p></div>
  <div class="row">
    <select id="branch"><option value="">Loading branches…</option></select>
    <input type="date" id="cdate" value="${todayISO()}">
    <button class="btn" id="load">Load batches</button>
    <button class="btn btn--primary" id="submit" disabled>Record count</button>
  </div>
</div>
<div id="out"></div>`;

qs('#load').addEventListener('click', loadBatches);
qs('#submit').addEventListener('click', submitCount);

await loadBranches();

async function loadBranches() {
  try {
    const branches = await listDocs('branches', { max: 100 });
    qs('#branch').innerHTML = branches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
    if (profile.branchId) qs('#branch').value = profile.branchId;
  } catch (e) { toast(humanError(e), 'err'); }
}

let batches = [];
async function loadBatches() {
  const branchId = qs('#branch').value;
  if (!branchId) { toast('Select a branch.', 'warn'); return; }
  qs('#out').innerHTML = `<div style="padding:1rem"><div class="skeleton" style="width:60%"></div></div>`;
  try {
    batches = await listDocs('batches', { where: [['branchId', '==', branchId]], max: 1000 });
    if (!batches.length) { qs('#out').innerHTML = `<div class="empty"><div class="empty__ico">📦</div><p class="muted">No batches for that branch.</p></div>`; return; }
    paint();
  } catch (e) { qs('#out').innerHTML = `<div class="empty">${esc(humanError(e))}</div>`; }
}

function paint() {
  qs('#out').innerHTML = `<div class="table-wrap"><table class="table" id="ct">
    <thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="num">Expected</th><th class="num">Physical</th><th class="num">Variance</th><th>Reason</th></tr></thead>
    <tbody>${batches.map((b, i) => `<tr data-i="${i}">
      <td><b>${esc(b.medicineName)}</b></td>
      <td class="mono">${esc(b.batchNumber)}</td>
      <td>${esc(b.expiryDate)}</td>
      <td class="num" data-exp="${b.quantityRemaining}">${fmtNum(b.quantityRemaining)}</td>
      <td class="num"><input type="number" data-phys="${i}" min="0" value="${b.quantityRemaining}" style="width:90px;text-align:right"></td>
      <td class="num" data-var="${i}">0</td>
      <td><input data-reason="${i}" placeholder="If variance" style="min-width:180px"></td>
    </tr>`).join('')}</tbody></table></div>`;

  qs('#ct').querySelectorAll('[data-phys]').forEach(inp => inp.oninput = recalc);
  recalc();
  qs('#submit').disabled = false;
}

function recalc() {
  let anyVar = false;
  qs('#ct').querySelectorAll('[data-phys]').forEach(inp => {
    const i = +inp.dataset.phys;
    const b = batches[i];
    const phys = Number(inp.value);
    const v = phys - Number(b.quantityRemaining || 0);
    const node = qs(`[data-var="${i}"]`);
    node.textContent = (v > 0 ? '+' : '') + v;
    node.style.color = v === 0 ? 'var(--muted)' : v > 0 ? 'var(--green)' : 'var(--red)';
    node.style.fontWeight = v === 0 ? 'normal' : '700';
    if (v !== 0) anyVar = true;
  });
  return anyVar;
}

async function submitCount() {
  const branchId = qs('#branch').value;
  const countDate = qs('#cdate').value;
  const items = [];
  let hasVariance = false;
  qs('#ct').querySelectorAll('[data-phys]').forEach(inp => {
    const i = +inp.dataset.phys;
    const b = batches[i];
    const phys = Number(inp.value);
    const variance = phys - Number(b.quantityRemaining || 0);
    const reason = qs(`[data-reason="${i}"]`).value.trim();
    if (variance !== 0) hasVariance = true;
    items.push({
      batchId: b.id, medicineId: b.medicineId, medicineName: b.medicineName,
      batchNumber: b.batchNumber,
      expected: b.quantityRemaining, physical: phys, variance, reason
    });
  });
  if (!items.length) return;
  if (hasVariance && !confirm('There are variances. Continue recording?')) return;

  const btn = qs('#submit');
  btn.disabled = true; btn.textContent = 'Recording…';
  try {
    const seq = await nextCounter('stockCounts');
    const branchDoc = await listDocs('branches', { max: 1, where: [['__name__', '==', branchId]] }).catch(() => []);
    // Fallback branch name from select
    const branchName = qs('#branch').selectedOptions[0].textContent;
    const ref = `BZ-CNT-${branchName.slice(0, 3).toUpperCase()}-${String(seq).padStart(6, '0')}`;

    // Save count and apply variances
    await runTransaction(db, async (tx) => {
      for (const it of items) {
        if (it.variance === 0) continue;
        const bRef = doc(db, 'batches', it.batchId);
        const bs = await tx.get(bRef);
        if (!bs.exists()) continue;
        const next = Number(bs.data().quantityRemaining || 0) + it.variance;
        if (next < 0) throw new Error(`Variance would make stock negative for ${it.medicineName}`);
        tx.update(bRef, { quantityRemaining: next, updatedAt: serverTimestamp() });
        tx.set(doc(collection(db, 'stockLedger')), {
          branchId, medicineId: it.medicineId, medicineName: it.medicineName,
          batchId: it.batchId, batchNumber: it.batchNumber,
          transactionType: 'STOCK_COUNT',
          reference: ref,
          quantityIn: it.variance > 0 ? it.variance : 0,
          quantityOut: it.variance < 0 ? -it.variance : 0,
          reason: it.reason || 'Physical stock count',
          performedBy: profile.uid, performedByName: profile.fullName,
          timestamp: serverTimestamp()
        });
      }
      tx.set(doc(collection(db, 'stockCounts')), {
        ref, branchId, countDate, items,
        varianceCount: items.filter(i => i.variance !== 0).length,
        countedBy: profile.uid, countedByName: profile.fullName,
        createdAt: serverTimestamp()
      });
    });

    await audit(profile, 'STOCK_COUNT', { ref, branchId, varianceCount: items.filter(i => i.variance !== 0).length });
    toast(`Stock count recorded (${ref}).`, 'success');
    btn.textContent = 'Recorded';
    setTimeout(() => { btn.textContent = 'Record count'; }, 1500);
  } catch (e) {
    toast(humanError(e), 'err');
    btn.disabled = false; btn.textContent = 'Record count';
  }
}