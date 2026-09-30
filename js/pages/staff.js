import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs, update } from '../db.js';
import { db, doc, setDoc, serverTimestamp } from '../firebase.js';
import { audit } from '../ops.js';
import { el, qs, esc, toast, modal, formData, humanError, fmtDate, debounce } from '../utils.js';
import { can } from '../permissions.js';

const profile = await shellReady;
const root = qs('#page-root');

const ROLE_OPTIONS = ['SUPER_ADMIN','ADMIN','BRANCH_MANAGER','CLINICIAN','NURSE','DISPENSER','CASHIER','STOREKEEPER','LAB','VIEWER'];

root.innerHTML = `
<div class="page-head">
  <div><h1>Staff</h1><p>User accounts &amp; role assignment</p></div>
  <div class="row">
    <input id="q" type="search" placeholder="Search name, email, role…" style="min-width:220px">
    ${can(profile, 'staff.edit') ? `<button class="btn" id="preprov">+ Pre-authorise staff</button>` : ''}
  </div>
</div>
<div class="alert alert--info">
  <b>How to add staff:</b> create their Firebase Auth account first at
  <code>login.html</code> (they sign in once), then assign role &amp; branch here.
  Alternatively, use <b>Pre-authorise</b> below to reserve an email — they inherit the assigned role on first sign-in.
</div>
<div id="list" class="table-wrap"></div>`;

let rows = [];
let branches = [];
qs('#q').addEventListener('input', debounce(paint, 150));
qs('#preprov')?.addEventListener('click', openPreprov);

await loadAll();

async function loadAll() {
  try {
    [rows, branches] = await Promise.all([
      listDocs('users', { max: 300 }),
      listDocs('branches', { max: 100 })
    ]);
    paint();
  } catch (e) { qs('#list').innerHTML = `<div class="empty">${esc(humanError(e))}</div>`; }
}

function paint() {
  const q = qs('#q').value.trim().toLowerCase();
  const f = q ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(q)) : rows;
  if (!f.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">👥</div><p class="muted">No staff.</p></div>`; return; }
  qs('#list').innerHTML = `<table class="table">
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Active</th><th>Created</th><th></th></tr></thead>
    <tbody>${f.map(u => `<tr>
      <td><b>${esc(u.fullName || '—')}</b></td>
      <td>${esc(u.email || '—')}</td>
      <td><span class="badge badge--info">${esc(u.role || '—')}</span></td>
      <td>${esc(branchName(u.branchId))}</td>
      <td>${u.active ? '<span class="badge badge--ok">Active</span>' : '<span class="badge badge--err">Inactive</span>'}</td>
      <td>${fmtDate(u.createdAt)}</td>
      <td class="actions">
        ${can(profile, 'staff.edit') ? `<button class="btn btn--sm" data-edit="${esc(u.id)}">Edit</button>` : ''}
      </td>
    </tr>`).join('')}</tbody></table>`;
  qs('#list').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editUser(rows.find(x => x.id === b.dataset.edit)));
}

function branchName(id) { if (!id) return 'All'; return (branches.find(b => b.id === id) || {}).name || id; }

function editUser(u) {
  modal({
    title: `Edit ${u.fullName || u.email}`,
    body: `<form id="uf">
      <label class="field"><span>Full name</span><input name="fullName" value="${esc(u.fullName || '')}"></label>
      <label class="field"><span>Phone</span><input name="phone" value="${esc(u.phone || '')}"></label>
      <label class="field"><span>Role <span class="req">*</span></span>
        <select name="role" required>${ROLE_OPTIONS.map(r => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Branch</span>
        <select name="branchId">
          <option value="">— All branches —</option>
          ${branches.map(b => `<option value="${esc(b.id)}"${b.id === u.branchId ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}
        </select>
      </label>
      <label class="check"><input type="checkbox" name="active"${u.active !== false ? ' checked' : ''}> <span>Active</span></label>
    </form>`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', class: 'btn--primary', close: false,
        onClick: async (e, close) => {
          const form = qs('#uf');
          if (!form.reportValidity()) return false;
          const d = formData(form);
          try {
            await update('users', u.id, { ...d, active: !!d.active });
            await audit(profile, 'USER_UPDATED', { userId: u.id, role: d.role, active: d.active });
            toast('User updated.', 'success');
            close(); loadAll();
          } catch (err) { toast(humanError(err), 'err'); return false; }
        }
      }
    ]
  });
}

function openPreprov() {
  modal({
    title: 'Pre-authorise staff',
    body: `<p class="muted small">Create a reserved account. When someone signs in with this email for the first time, they'll get the role and branch you set here.</p>
    <form id="pf">
      <label class="field"><span>Email <span class="req">*</span></span><input type="email" name="email" required></label>
      <label class="field"><span>Full name</span><input name="fullName"></label>
      <label class="field"><span>Role <span class="req">*</span></span>
        <select name="role" required>${ROLE_OPTIONS.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Branch</span>
        <select name="branchId"><option value="">— All branches —</option>${branches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select>
      </label>
    </form>`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create invite', class: 'btn--primary', close: false,
        onClick: async (e, close) => {
          const form = qs('#pf');
          if (!form.reportValidity()) return false;
          const d = formData(form);
          try {
            // Store invite by email — the sign-in flow in auth.js can pick this up
            await setDoc(doc(db, 'userInvites', d.email.toLowerCase()), {
              ...d, active: true, invitedBy: profile.uid, invitedAt: serverTimestamp()
            });
            await audit(profile, 'USER_INVITE', { email: d.email, role: d.role });
            toast('Invite created.', 'success');
            close();
          } catch (err) { toast(humanError(err), 'err'); return false; }
        }
      }
    ]
  });
}