import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs } from '../db.js';
import { recordExpense } from '../ops.js';
import { el, qs, esc, fmtUGX, fmtDateTime, toast, modal, formData, humanError, debounce } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');
root.innerHTML = `
<div class="page-head">
  <div><h1>Expenses</h1><p>Recorded expenses &amp; financial ledger impact</p></div>
  <div class="row">
    <input id="q" type="search" placeholder="Search…" style="min-width:220px">
    <button class="btn btn--primary" id="add">+ Record expense</button>
  </div>
</div>
<div id="list" class="table-wrap"></div>`;

qs('#add').addEventListener('click', openForm);
qs('#q').addEventListener('input', debounce(paint, 150));
let rows = [];
await load();

async function load() {
  rows = await listDocs('expenses', { order: 'createdAt', max: 500 });
  paint();
}

function paint() {
  const q = qs('#q').value.trim().toLowerCase();
  const f = q ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(q)) : rows;
  if (!f.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">📉</div><p class="muted">No expenses yet.</p></div>`; return; }
  qs('#list').innerHTML = `<table class="table">
    <thead><tr><th>Ref</th><th>Category</th><th>Description</th><th class="num">Amount</th><th>Method</th><th>By</th><th>When</th></tr></thead>
    <tbody>${f.map(r => `<tr>
      <td class="mono">${esc(r.ref || r.id)}</td>
      <td>${esc(r.category)}</td>
      <td>${esc(r.description || '—')}</td>
      <td class="num">${fmtUGX(r.amount)}</td>
      <td>${esc(r.paymentMethod || '—')}</td>
      <td>${esc(r.createdByName || '—')}</td>
      <td>${fmtDateTime(r.createdAt)}</td>
    </tr>`).join('')}</tbody></table>`;
}

function openForm() {
  modal({
    title: 'Record expense',
    body: `<form id="ef">
      <label class="field"><span>Category <span class="req">*</span></span>
        <select name="category" required>
          <option>Rent</option><option>Electricity</option><option>Water</option><option>Internet</option>
          <option>Transport</option><option>Cleaning</option><option>Salaries</option><option>Repairs</option>
          <option>Medical supplies</option><option>Office supplies</option><option>Other</option>
        </select>
      </label>
      <label class="field"><span>Description</span><input name="description"></label>
      <label class="field"><span>Amount (UGX) <span class="req">*</span></span><input type="number" name="amount" required min="1"></label>
      <label class="field"><span>Payment method</span>
        <select name="paymentMethod"><option>CASH</option><option>MOBILE_MONEY</option><option>BANK</option><option>CARD</option><option>OTHER</option></select>
      </label>
      <label class="field"><span>Reference / receipt #</span><input name="reference"></label>
    </form>`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Record', class: 'btn--primary', close: false,
        onClick: async (e, close) => {
          const form = qs('#ef');
          if (!form.reportValidity()) return false;
          const d = formData(form);
          try {
            const branchId = profile.branchId || (await pickBranch());
            if (!branchId) return false;
            await recordExpense(profile, { branchId, ...d });
            toast('Expense recorded.', 'success');
            close(); load();
          } catch (err) { toast(humanError(err), 'err'); return false; }
        }
      }
    ]
  });
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