import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { db, collection, getDocs, query, where, orderBy, limit } from '../firebase.js';
import { listDocs } from '../db.js';
import { el, qs, esc, fmtUGX, fmtNum, fmtDateTime, todayISO } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');

root.innerHTML = `
<div class="page-head">
  <div><h1>Dashboard</h1><p>Welcome back, ${esc(profile.fullName)} · ${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Africa/Kampala'})}</p></div>
  <div class="row">
    <button class="btn" id="refresh">⟳ Refresh</button>
  </div>
</div>
<div id="dash-loading" class="grid-3">
  <div class="card"><div class="card__body"><div class="skeleton" style="width:60%"></div><div class="skeleton mt2" style="width:40%;height:24px"></div></div></div>
  <div class="card"><div class="card__body"><div class="skeleton" style="width:60%"></div><div class="skeleton mt2" style="width:40%;height:24px"></div></div></div>
  <div class="card"><div class="card__body"><div class="skeleton" style="width:60%"></div><div class="skeleton mt2" style="width:40%;height:24px"></div></div></div>
</div>
<div id="dash-root"></div>
`;

qs('#refresh').addEventListener('click', load);
load();

async function load() {
  qs('#dash-loading').hidden = false;
  qs('#dash-root').innerHTML = '';
  try {
    const today = todayISO();
    const scopeBranch = profile.role === 'SUPER_ADMIN' || profile.role === 'ADMIN' ? null : profile.branchId;

    const [sales, expenses, batches, clients, payments, ledgerRecent] = await Promise.all([
      listDocs('sales', { where: scopeBranch ? [['branchId', '==', scopeBranch]] : [], order: 'createdAt', max: 500 }),
      listDocs('expenses', { where: scopeBranch ? [['branchId', '==', scopeBranch]] : [], order: 'createdAt', max: 500 }),
      listDocs('batches', { where: scopeBranch ? [['branchId', '==', scopeBranch]] : [], max: 2000 }),
      listDocs('clients', { where: scopeBranch ? [['branchId', '==', scopeBranch]] : [], order: 'createdAt', max: 500 }),
      listDocs('payments', { where: scopeBranch ? [['branchId', '==', scopeBranch]] : [], order: 'timestamp', max: 500 }),
      listDocs('financialLedger', { where: scopeBranch ? [['branchId', '==', scopeBranch]] : [], order: 'timestamp', max: 10 })
    ]);

    const todaySales = sales.filter(s => sameDay(s.createdAt, today));
    const todayPay = payments.filter(p => sameDay(p.timestamp, today));
    const todayExp = expenses.filter(e => sameDay(e.createdAt, today));
    const todayClients = clients.filter(c => sameDay(c.createdAt, today));

    const salesTotal = todaySales.reduce((a, s) => a + Number(s.totals || 0), 0);
    const payTotal = todayPay.reduce((a, p) => a + Number(p.amount || 0), 0);
    const expTotal = todayExp.reduce((a, e) => a + Number(e.amount || 0), 0);
    const netCash = salesTotal - expTotal;

    const stockValue = batches.reduce((a, b) => a + (Number(b.quantityRemaining || 0) * Number(b.buyingPrice || 0)), 0);
    const lowStock = batches.filter(b => Number(b.quantityRemaining || 0) > 0 && Number(b.quantityRemaining || 0) <= 20);
    const outOfStock = batches.filter(b => Number(b.quantityRemaining || 0) <= 0);
    const now = Date.now();
    const expiringSoon = batches.filter(b => {
      const d = new Date(b.expiryDate).getTime();
      return d > now && d - now < 1000 * 60 * 60 * 24 * 60;
    });
    const expired = batches.filter(b => new Date(b.expiryDate).getTime() <= now && Number(b.quantityRemaining || 0) > 0);

    const html = `
      <div class="stat-grid">
        ${stat('Today\'s Sales', fmtUGX(salesTotal), `${todaySales.length} transactions`, 'info', 'sales.html')}
        ${stat('Today\'s Payments', fmtUGX(payTotal), `${todayPay.length} payments`, 'ok', 'payments.html')}
        ${stat('Today\'s Expenses', fmtUGX(expTotal), `${todayExp.length} entries`, 'warn', 'expenses.html')}
        ${stat('Net Cash Movement', fmtUGX(netCash), 'Sales − Expenses', netCash >= 0 ? 'ok' : 'err', 'ledger.html')}
      </div>

      <div class="stat-grid">
        ${stat('Inventory Value', fmtUGX(stockValue), `${batches.length} batches`, 'info', 'inventory.html')}
        ${stat('Low Stock', lowStock.length, '≤ 20 remaining', 'warn', 'inventory.html')}
        ${stat('Out of Stock', outOfStock.length, 'Needs replenishment', 'err', 'inventory.html')}
        ${stat('Expiring ≤ 60 days', expiringSoon.length, `${expired.length} expired`, 'warn', 'batches.html')}
      </div>

      <div class="stat-grid">
        ${stat('Clients Registered', clients.length, `${todayClients.length} today`, 'info', 'clients.html')}
        ${stat('Today\'s Transactions', sales.length, 'All-time sales count', 'info', 'sales.html')}
      </div>

      <div class="grid-2 mt2">
        <div class="card">
          <div class="card__head"><h3>Recent Ledger Activity</h3><a href="ledger.html" class="link-btn">View all →</a></div>
          <div class="list-rows">
            ${ledgerRecent.length ? ledgerRecent.map(l => `
              <div>
                <div class="list-rows__main">
                  <b>${esc(l.reference || l.type)}</b>
                  <span>${esc(l.description || '')} · ${fmtDateTime(l.timestamp)}</span>
                </div>
                <div class="right">
                  <div style="font-weight:700;color:${l.type === 'SALE' || l.credit > 0 ? 'var(--green)' : 'var(--red)'}">
                    ${l.credit > 0 ? '+' : '−'}${fmtUGX(l.credit > 0 ? l.credit : l.debit)}
                  </div>
                  <div class="tiny muted">${esc(l.type)}</div>
                </div>
              </div>`).join('') : `<div class="empty small">No ledger entries yet.</div>`}
          </div>
        </div>

        <div class="card">
          <div class="card__head"><h3>Expiring & Low Stock</h3></div>
          <div class="list-rows">
            ${[...expired, ...expiringSoon, ...lowStock].slice(0, 8).map(b => `
              <div>
                <div class="list-rows__main">
                  <b>${esc(b.medicineName)}</b>
                  <span>Batch ${esc(b.batchNumber)} · Exp ${esc(b.expiryDate)}</span>
                </div>
                <div class="right">
                  <div style="font-weight:700">${fmtNum(b.quantityRemaining)} left</div>
                  <div class="tiny">${new Date(b.expiryDate).getTime() <= now ? '<span class="badge badge--err">EXPIRED</span>' : '<span class="badge badge--warn">EXPIRING</span>'}</div>
                </div>
              </div>`).join('') || `<div class="empty small">All good — no alerts.</div>`}
          </div>
        </div>
      </div>
    `;
    qs('#dash-root').innerHTML = html;
  } catch (e) {
    console.error(e);
    qs('#dash-root').innerHTML = `<div class="empty"><div class="empty__ico">⚠️</div><h3>Could not load dashboard</h3><p class="muted">${esc(e.message)}</p></div>`;
  } finally {
    qs('#dash-loading').hidden = true;
  }
}

function stat(label, value, meta, kind, href) {
  return `<a class="stat ${kind ? 'stat--' + kind : ''}" href="${href}">
    <div class="stat__label">${esc(label)}</div>
    <div class="stat__value">${value}</div>
    <div class="stat__meta">${esc(meta)}</div>
  </a>`;
}

function sameDay(ts, iso) {
  if (!ts) return false;
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return false;
  const s = d.toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' });
  return s === iso;
}