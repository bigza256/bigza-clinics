import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { listDocs, addDocAuto, nextCounter } from '../db.js';
import { clientId, el, qs, esc, toast, modal, formData, humanError, fmtDate, debounce } from '../utils.js';
import { audit } from '../ops.js';
import { can } from '../permissions.js';

const profile = await shellReady;
const root = qs('#page-root');

root.innerHTML = `
<div class="page-head">
  <div><h1>Clients</h1><p>${esc(profile.branchId || 'All branches')}</p></div>
  <div class="row">
    <input type="search" id="q" placeholder="Search by name, ID, phone…" style="min-width:240px">
    ${can(profile, 'clients.edit') ? '<button class="btn btn--primary" id="add">+ Register client</button>' : ''}
  </div>
</div>
<div id="list" class="table-wrap"><div style="padding:1.5rem"><div class="skeleton" style="width:60%"></div><div class="skeleton mt2" style="width:80%"></div></div></div>
`;

let rows = [];
qs('#q').addEventListener('input', debounce(paint, 200));
qs('#add')?.addEventListener('click', openForm);

await load();

async function load() {
  try {
    rows = await listDocs('clients', { order: 'createdAt', max: 500 });
    paint();
  } catch (e) { qs('#list').innerHTML = `<div class="empty">${esc(humanError(e))}</div>`; }
}

function paint() {
  const q = qs('#q').value.trim().toLowerCase();
  const f = q ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(q)) : rows;
  if (!f.length) { qs('#list').innerHTML = `<div class="empty"><div class="empty__ico">🧑‍⚕️</div><h3>No clients</h3><p class="muted">Register your first client.</p></div>`; return; }
  qs('#list').innerHTML = `<table class="table">
    <thead><tr><th>Client ID</th><th>Name</th><th>Sex</th><th>Phone</th><th>Branch</th><th>Registered</th><th></th></tr></thead>
    <tbody>${f.map(r => `
      <tr>
        <td class="mono">${esc(r.clientId || '—')}</td>
        <td><b>${esc(r.fullName)}</b><span class="subtle">${esc(r.nextOfKin || '')}</span></td>
        <td>${esc(r.sex || '—')}</td>
        <td>${esc(r.phone || '—')}</td>
        <td>${esc(r.branchId || '—')}</td>
        <td>${fmtDate(r.createdAt)}</td>
        <td class="actions">
          <a class="btn btn--sm" href="client-profile.html?id=${esc(r.id)}">Open</a>
        </td>
      </tr>`).join('')}</tbody></table>`;
}

function openForm() {
  modal({
    title: 'Register client',
    body: `
      <form id="cf">
        <div class="field-row">
          <label class="field"><span>Full name <span class="req">*</span></span><input name="fullName" required></label>
          <label class="field"><span>Sex</span><select name="sex"><option>Female</option><option>Male</option><option>Other</option></select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Date of birth</span><input type="date" name="dob"></label>
          <label class="field"><span>Phone</span><input name="phone" type="tel"></label>
        </div>
        <label class="field"><span>Address</span><input name="address"></label>
        <div class="field-row">
          <label class="field"><span>Next of kin</span><input name="nextOfKin"></label>
          <label class="field"><span>Emergency contact</span><input name="emergencyContact" type="tel"></label>
        </div>
        <label class="field"><span>Allergies</span><textarea name="allergies"></textarea></label>
        <label class="field"><span>Relevant medical info</span><textarea name="medicalInfo"></textarea></label>
      </form>
    `,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Register', class: 'btn--primary', close: false,
        onClick: async (e, close) => {
          const form = qs('#cf');
          if (!form.reportValidity()) return false;
          const data = formData(form);
          try {
            const seq = await nextCounter('clients');
            const cid = clientId(seq);
            const id = await addDocAuto('clients', {
              ...data,
              clientId: cid,
              branchId: profile.branchId || null,
              registeredBy: profile.uid,
              registeredByName: profile.fullName
            });
            await audit(profile, 'CLIENT_REGISTERED', { clientId: cid, id });
            toast(`Client ${cid} registered.`, 'success');
            close();
            load();
          } catch (err) { toast(humanError(err), 'err'); return false; }
        }
      }
    ]
  });
}