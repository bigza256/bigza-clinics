import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs, addDocAuto } from '../db.js';
import { audit } from '../ops.js';
import { el, qs, esc, fmtUGX, toast, modal, formData, humanError, todayISO, fmtDate } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');

root.innerHTML = `
<div class="page-head">
  <div><h1>Cash Closure</h1><p>End-of-shift reconciliation</p></div>
  <div class="row">
    <select id="branch"><option>Loading…</option></select>
    <input type="date" id="d" value="${todayISO()}">
    <button class="btn" id="load">Load summary</button>
    <button class="btn btn--primary" id="close" disabled>Close day</button>
  </div>
</div>
<div id="out"></div>`;

await loadBranches();
qs('#load').addEventListener('click', loadSummary);
qs('#close').addEventListener('click', closeDay);

async function loadBranches() {
  const branches = await listDocs('branches', { max: 100 });
  qs('#branch').innerHTML = branches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  if (profile.branchId) qs('#branch').value = profile.branchId;
}

let summary = null;
async function loadSummary() {
  const branchId = qs('#branch').value;
  const day = qs('#d').value;
  if (!branchId || !day) { toast('Select branch and date.', 'warn'); return; }
  qs('#out').innerHTML = `<div style="padding:1rem"><div class="skeleton" style="width:50%"></div><div class="skeleton mt2" style="width:70%"></div></div>`;
  try {
    const [sales, payments, expenses] = await Promise.all([
      listDocs('sales', { where: [['branchId', '==', branchId]], order: 'createdAt', max: 1000 }),
      listDocs('payments', { where: [['branchId', '==', branchId]], order: 'timestamp', max: 1000 }),
      listDocs('expenses', { where: [['branchId', '==', branchId]], order: 'createdAt', max: 1000 })
    ]);
    const sameDay = (ts) => {
      if (!ts) return false;
      const dt = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(dt)) return false;
      return dt.toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' }) === day;
    };
    const daySales = sales.filter(s => sameDay(s.createdAt) && s.status !== 'REFUNDED');
    const dayRefunds = sales.filter(s => sameDay(s.createdAt) && s.status === 'REFUNDED');
    const dayPay = payments.filter(p => sameDay(p.timestamp));
    const dayExp = expenses.filter(e => sameDay(e.createdAt));

    const totalSales = daySales.reduce((a, s) => a + Number(s.totals || 0), 0);
    const totalRefunds = dayRefunds.reduce((a, s) => a + Number(s.totals || 0), 0);
    const totalExp = dayExp.reduce((a, e) => a + Number(e.amount || 0), 0);
    const byMethod = {};
    for (const s of daySales) byMethod[s.paymentMethod || 'OTHER'] = (byMethod[s.paymentMethod || 'OTHER'] || 0) + Number(s.totals || 0);
    const cashIn = byMethod['CASH'] || 0;
    const expectedCash = cashIn - totalExp;

    summary = { branchId, day, totalSales, totalRefunds, totalExp, expectedCash, byMethod, cashIn };

    qs('#out').innerHTML = `
      <div class="stat-grid">
        <div class="stat stat--info"><div class="stat__label">Total sales</div><div class="stat__value">${fmtUGX(totalSales)}</div><div class="stat__meta">${daySales.length} transactions</div></div>
        <div class="stat stat--warn"><div class="stat__label">Total expenses</div><div class="stat__value">${fmtUGX(totalExp)}</div><div class="stat__meta">${dayExp.length} entries</div></div>
        <div class="stat stat--err"><div class="stat__label">Refunds</div><div class="stat__value">${fmtUGX(totalRefunds)}</div><div class="stat__meta">${dayRefunds.length} refunds</div></div>
        <div class="stat stat--ok"><div class="stat__label">Expected cash</div><div class="stat__value">${fmtUGX(expectedCash)}</div><div class="stat__meta">Cash sales − expenses</div></div>
      </div>

      <div class="grid-2 mt2">
        <div class="card">
          <div class="card__head"><h3>Sales by payment method</h3></div>
          <div class="card__body">
            ${Object.keys(byMethod).length ? `<table class="table"><thead><tr><th>Method</th><th class="num">Total</th></tr></thead><tbody>${Object.entries(byMethod).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmtUGX(v)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No sales on this day.</p>'}
          </div>
        </div>
        <div class="card">
          <div class="card__head"><h3>Physical cash</h3></div>
          <div class="card__body">
            <label class="field"><span>Physical cash counted (UGX)</span><input type="number" id="phys" placeholder="0"></label>
            <div class="alert alert--info" id="variance" hidden></div>
            <p class="muted small">Variance = physical − expected</p>
            <label class="field mt2"><span>Variance reason (if any)</span><textarea id="reason" rows="2"></textarea></label>
          </div>
        </div>
      </div>
    `;
    qs('#close').disabled = false;
    qs('#phys').addEventListener('input', () => {
      const phys = Number(qs('#phys').value) || 0;
      const variance = phys - expectedCash;
      const box = qs('#variance');
      box.hidden = false;
      box.className = 'alert ' + (variance === 0 ? 'alert--ok' : 'alert--warn');
      box.textContent = `Variance: ${fmtUGX(variance)}`;
    });
  } catch (e) {
    qs('#out').innerHTML = `<div class="empty">${esc(humanError(e))}</div>`;
  }
}

async function closeDay() {
  if (!summary) return;
  const phys = Number(qs('#phys').value);
  if (Number.isNaN(phys)) { toast('Enter physical cash count.', 'warn'); return; }
  const variance = phys - summary.expectedCash;
  const reason = qs('#reason').value.trim();
  if (variance !== 0 && !reason) { toast('Variance reason is required.', 'warn'); return; }
  if (!confirm(`Close day for ${fmtDate(summary.day)}?\nExpected: ${fmtUGX(summary.expectedCash)}\nPhysical: ${fmtUGX(phys)}\nVariance: ${fmtUGX(variance)}`)) return;

  const btn = qs('#close');
  btn.disabled = true; btn.textContent = 'Closing…';
  try {
    const ref = `BZ-CLS-${summary.branchId.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}`;
    await addDocAuto('cashClosures', {
      ref,
      branchId: summary.branchId,
      day: summary.day,
      totalSales: summary.totalSales,
      totalExpenses: summary.totalExp,
      totalRefunds: summary.totalRefunds,
      expected: summary.expectedCash,
      physical: phys,
      variance,
      reason: reason || null,
      byMethod: summary.byMethod,
      closedBy: profile.uid, closedByName: profile.fullName
    });
    await audit(profile, 'CASH_CLOSURE', { ref, branchId: summary.branchId, variance });
    toast('Day closed successfully.', 'success');
    btn.textContent = 'Closed';
    setTimeout(() => { btn.textContent = 'Close day'; btn.disabled = false; }, 1500);
  } catch (e) {
    toast(humanError(e), 'err');
    btn.disabled = false; btn.textContent = 'Close day';
  }
}