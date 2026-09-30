import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs } from '../db.js';
import { completeSale, audit } from '../ops.js';
import { el, qs, esc, fmtUGX, toast, modal, humanError, debounce, todayISO } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');

root.innerHTML = `
<div class="page-head">
  <div><h1>Pharmacy POS</h1><p>Fast dispensing · FEFO batch suggestion</p></div>
</div>
<div class="pos">
  <div>
    <div class="toolbar"><input id="q" type="search" class="grow" placeholder="Search medicine or batch…"></div>
    <div class="pos-list" id="list"></div>
  </div>
  <div class="pos-cart">
    <div class="card__head"><h3>Cart</h3><span class="badge" id="cart-count">0</span></div>
    <div class="pos-cart__list" id="cart"></div>
    <div class="pos-cart__foot">
      <div class="pos-total"><span>Total</span><span id="total">UGX 0</span></div>
      <label class="field"><span>Payment method</span>
        <select id="pm">
          <option>CASH</option><option>MOBILE_MONEY</option><option>BANK</option><option>CARD</option><option>INSURANCE</option><option>CREDIT</option>
        </select>
      </label>
      <label class="field"><span>Amount paid (UGX)</span><input type="number" id="paid" min="0"></label>
      <button class="btn btn--primary btn--block" id="checkout" disabled>Complete sale</button>
    </div>
  </div>
</div>
`;

let batches = [];
const cart = [];

load();
qs('#q').addEventListener('input', debounce(paint, 150));
qs('#paid').addEventListener('input', updateTotal);
qs('#checkout').addEventListener('click', checkout);

async function load() {
  try {
    batches = await listDocs('batches', { where: [['quantityRemaining', '>', 0]], max: 500 });
    batches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate)); // FEFO
    paint();
  } catch (e) { qs('#list').innerHTML = `<div class="empty">${esc(humanError(e))}</div>`; }
}

function paint() {
  const q = qs('#q').value.trim().toLowerCase();
  const f = q ? batches.filter(b => JSON.stringify(b).toLowerCase().includes(q)) : batches;
  if (!f.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">💊</div><p class="muted">No batches in stock.</p></div>`; return; }
  qs('#list').innerHTML = f.map(b => `
    <div class="pos-item" data-id="${esc(b.id)}">
      <div>
        <div class="pos-item__name">${esc(b.medicineName)}</div>
        <div class="pos-item__meta">Batch ${esc(b.batchNumber)} · Exp ${esc(b.expiryDate)} · ${b.quantityRemaining} left</div>
      </div>
      <div class="pos-item__price">${fmtUGX(b.sellingPrice || b.buyingPrice)}</div>
    </div>`).join('');
  qs('#list').querySelectorAll('.pos-item').forEach(node => {
    node.addEventListener('click', () => addToCart(batches.find(b => b.id === node.dataset.id)));
  });
}

function addToCart(b) {
  if (!b) return;
  const existing = cart.find(c => c.batchId === b.id);
  if (existing) {
    if (existing.quantity + 1 > b.quantityRemaining) { toast('Not enough stock in batch.', 'warn'); return; }
    existing.quantity++;
  } else {
    cart.push({
      batchId: b.id, medicineId: b.medicineId, medicineName: b.medicineName,
      batchNumber: b.batchNumber, quantity: 1,
      unitPrice: Number(b.sellingPrice || b.buyingPrice || 0),
      max: b.quantityRemaining
    });
  }
  paintCart();
}

function paintCart() {
  qs('#cart-count').textContent = cart.length;
  qs('#cart').innerHTML = cart.length ? cart.map((c, i) => `
    <div class="pos-cart__row">
      <div><b>${esc(c.medicineName)}</b><span class="subtle">Batch ${esc(c.batchNumber)} · ${fmtUGX(c.unitPrice)}</span></div>
      <div class="pos-cart__qty">
        <button class="btn btn--sm" data-dec="${i}">−</button>
        <input type="number" min="1" max="${c.max}" value="${c.quantity}" data-qty="${i}">
        <button class="btn btn--sm" data-inc="${i}">+</button>
        <button class="btn btn--sm btn--danger" data-del="${i}">✕</button>
      </div>
    </div>`).join('') : `<div class="empty small">Tap medicines to add.</div>`;
  qs('#cart').querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { const c = cart[+b.dataset.inc]; if (c.quantity < c.max) { c.quantity++; paintCart(); } });
  qs('#cart').querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { const c = cart[+b.dataset.dec]; c.quantity = Math.max(1, c.quantity - 1); paintCart(); });
  qs('#cart').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { cart.splice(+b.dataset.del, 1); paintCart(); });
  qs('#cart').querySelectorAll('[data-qty]').forEach(inp => inp.oninput = () => {
    const c = cart[+inp.dataset.qty];
    const v = Math.max(1, Math.min(c.max, Number(inp.value) || 1));
    c.quantity = v;
    updateTotal();
  });
  updateTotal();
}

function updateTotal() {
  const t = cart.reduce((a, c) => a + c.quantity * c.unitPrice, 0);
  qs('#total').textContent = fmtUGX(t);
  qs('#checkout').disabled = cart.length === 0;
  const paid = qs('#paid');
  if (!paid.value) paid.value = t;
}

async function checkout() {
  if (!cart.length) return;
  const branchId = profile.branchId || (await promptBranch());
  if (!branchId) return;
  const total = cart.reduce((a, c) => a + c.quantity * c.unitPrice, 0);
  const btn = qs('#checkout');
  btn.disabled = true; btn.textContent = 'Processing…';
  try {
    const res = await completeSale(profile, {
      branchId,
      items: cart.map(c => ({
        medicineId: c.medicineId, medicineName: c.medicineName,
        batchId: c.batchId, batchNumber: c.batchNumber,
        quantity: c.quantity, unitPrice: c.unitPrice
      })),
      paymentMethod: qs('#pm').value,
      amountPaid: Number(qs('#paid').value || total)
    });
    toast(`Sale complete — ${res.ref}`, 'success');
    showReceipt(res, branchId);
    cart.length = 0;
    paintCart();
    load();
  } catch (e) {
    toast(humanError(e), 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Complete sale';
  }
}

async function promptBranch() {
  const branches = await listDocs('branches', { max: 100 });
  return new Promise(resolve => {
    modal({
      title: 'Select branch',
      body: `<div class="list-rows">${branches.map(b => `<button class="btn btn--ghost btn--block" data-bid="${b.id}">${esc(b.name)}</button>`).join('')}</div>`,
      actions: [{ label: 'Cancel', onClick: () => resolve(null) }],
      onMount: (body, close) => {
        body.querySelectorAll('[data-bid]').forEach(b => b.onclick = () => { close(); resolve(b.dataset.bid); });
      }
    });
  });
}

function showReceipt(res, branchId) {
  modal({
    title: 'Sale complete',
    body: `
      <div style="text-align:center;padding:.5rem 0">
        <div class="brand-mark brand-mark--lg" style="margin:0 auto .5rem">BZ</div>
        <h2 style="margin:0">BIGZA CLINICS</h2>
        <p class="muted small">Receipt ${esc(res.receiptRef)}</p>
      </div>
      <hr class="hr">
      <dl class="kv">
        <dt>Sale ref</dt><dd>${esc(res.ref)}</dd>
        <dt>Total</dt><dd><b>${fmtUGX(res.totals)}</b></dd>
        <dt>Served by</dt><dd>${esc(profile.fullName)}</dd>
        <dt>Date</dt><dd>${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Kampala' })}</dd>
      </dl>
    `,
    actions: [{ label: 'Print', onClick: () => window.print() }, { label: 'Done' }]
  });
}