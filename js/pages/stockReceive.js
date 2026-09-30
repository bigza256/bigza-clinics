import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs } from '../db.js';
import { receiveStock } from '../ops.js';
import { el, qs, esc, fmtUGX, toast, modal, humanError, todayISO } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');

root.innerHTML = `
<div class="page-head">
  <div><h1>Receive Stock</h1><p>Goods Received Note · batch + expiry tracking</p></div>
</div>
<div class="grid-2">
  <div class="card">
    <div class="card__head"><h3>Receipt details</h3></div>
    <div class="card__body">
      <label class="field"><span>Supplier</span><select id="supplier"><option value="">Loading…</option></select></label>
      <div class="field-row">
        <label class="field"><span>Invoice number</span><input id="invoice" placeholder="INV-001"></label>
        <label class="field"><span>Purchase date</span><input type="date" id="pdate" value="${todayISO()}"></label>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card__head"><h3>Add line</h3></div>
    <div class="card__body">
      <label class="field"><span>Medicine</span><select id="med"><option value="">Loading…</option></select></label>
      <div class="field-row">
        <label class="field"><span>Batch #</span><input id="batch" placeholder="BATCH-001"></label>
        <label class="field"><span>Expiry date</span><input type="date" id="expiry"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Quantity</span><input type="number" id="qty" min="1" placeholder="100"></label>
        <label class="field"><span>Buying price</span><input type="number" id="buy" min="0" placeholder="200"></label>
      </div>
      <label class="field"><span>Selling price</span><input type="number" id="sell" min="0" placeholder="300"></label>
      <button class="btn btn--primary btn--block" id="addline">+ Add line</button>
    </div>
  </div>
</div>

<div class="card mt2">
  <div class="card__head"><h3>Receipt lines</h3><span class="badge" id="linecount">0</span></div>
  <div id="lines"></div>
  <div class="card__foot">
    <div style="flex:1"><b>Total cost: <span id="total">UGX 0</span></b></div>
    <button class="btn btn--primary" id="post" disabled>Post receipt</button>
  </div>
</div>
`;

const lines = [];
qs('#addline').addEventListener('click', addLine);
qs('#post').addEventListener('click', post);

await loadMeta();

async function loadMeta() {
  try {
    const [sups, meds] = await Promise.all([listDocs('suppliers', { max: 200 }), listDocs('medicines', { max: 500 })]);
    qs('#supplier').innerHTML = `<option value="">— none —</option>` + sups.map(s => `<option value="${esc(s.id)}" data-name="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    qs('#med').innerHTML = `<option value="">Select medicine…</option>` + meds.map(m => `<option value="${esc(m.id)}" data-name="${esc(m.genericName)} ${esc(m.strength || '')}">${esc(m.genericName)} ${esc(m.strength || '')}</option>`).join('');
  } catch (e) { toast(humanError(e), 'err'); }
}

function addLine() {
  const medId = qs('#med').value;
  if (!medId) { toast('Select a medicine.', 'warn'); return; }
  const medName = qs('#med').selectedOptions[0].dataset.name;
  const batchNumber = qs('#batch').value.trim();
  const expiryDate = qs('#expiry').value;
  const quantity = Number(qs('#qty').value);
  const buyingPrice = Number(qs('#buy').value);
  const sellingPrice = Number(qs('#sell').value) || buyingPrice;
  if (!batchNumber || !expiryDate || !quantity || buyingPrice < 0) { toast('Fill batch, expiry, qty and buying price.', 'warn'); return; }
  lines.push({ medicineId: medId, medicineName: medName, batchNumber, expiryDate, quantity, buyingPrice, sellingPrice });
  paintLines();
  ['#batch', '#expiry', '#qty', '#buy', '#sell'].forEach(s => qs(s).value = '');
}

function paintLines() {
  qs('#linecount').textContent = lines.length;
  const t = lines.reduce((a, l) => a + l.quantity * l.buyingPrice, 0);
  qs('#total').textContent = fmtUGX(t);
  qs('#post').disabled = !lines.length;
  if (!lines.length) { qs('#lines').innerHTML = `<div class="empty small">No lines yet.</div>`; return; }
  qs('#lines').innerHTML = `<table class="table"><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="num">Qty</th><th class="num">Buying</th><th class="num">Subtotal</th><th></th></tr></thead>
    <tbody>${lines.map((l, i) => `<tr>
      <td>${esc(l.medicineName)}</td><td class="mono">${esc(l.batchNumber)}</td><td>${esc(l.expiryDate)}</td>
      <td class="num">${l.quantity}</td><td class="num">${fmtUGX(l.buyingPrice)}</td><td class="num">${fmtUGX(l.quantity * l.buyingPrice)}</td>
      <td class="actions"><button class="btn btn--sm" data-del="${i}">✕</button></td>
    </tr>`).join('')}</tbody></table>`;
  qs('#lines').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.del, 1); paintLines(); });
}

async function post() {
  if (!lines.length) return;
  const btn = qs('#post');
  btn.disabled = true; btn.textContent = 'Posting…';
  try {
    const branchId = profile.branchId || (await pickBranch());
    if (!branchId) return;
    const supplierSel = qs('#supplier');
    const supplierId = supplierSel.value || null;
    const supplierName = supplierId ? supplierSel.selectedOptions[0].dataset.name : null;
    const res = await receiveStock(profile, {
      branchId,
      supplierId,
      supplierName,
      invoiceNumber: qs('#invoice').value.trim() || null,
      items: lines,
      purchaseDate: qs('#pdate').value
    });
    toast(`Receipt posted — ${res.ref}`, 'success');
    lines.length = 0; paintLines();
    qs('#invoice').value = '';
  } catch (e) { toast(humanError(e), 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Post receipt'; }
}

async function pickBranch() {
  const branches = await listDocs('branches', { max: 100 });
  return new Promise(resolve => {
    modal({
      title: 'Select branch',
      body: `<div class="list-rows">${branches.map(b => `<button class="btn btn--ghost btn--block" data-bid="${b.id}">${esc(b.name)}</button>`).join('')}</div>`,
      actions: [{ label: 'Cancel', onClick: () => resolve(null) }],
      onMount: (body, close) => body.querySelectorAll('[data-bid]').forEach(x => x.onclick = () => { close(); resolve(x.dataset.bid); })
    });
  });
}