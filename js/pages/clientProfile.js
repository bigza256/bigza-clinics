import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { db, doc, getDoc, collection, query, where, orderBy, getDocs } from '../firebase.js';
import { listDocs } from '../db.js';
import { el, qs, esc, toast, modal, formData, humanError, fmtDate, fmtDateTime } from '../utils.js';
import { can } from '../permissions.js';

const profile = await shellReady;
const root = qs('#page-root');
const id = new URLSearchParams(location.search).get('id');

if (!id) {
  root.innerHTML = `<div class="empty"><div class="empty__ico">🧑‍⚕️</div><h3>No client selected</h3><p class="muted">Open a client from the Clients page.</p><a class="btn btn--primary mt2" href="clients.html">Back to clients</a></div>`;
} else {
  await load();
}

async function load() {
  root.innerHTML = `<div style="padding:1.5rem"><div class="skeleton" style="width:40%"></div><div class="skeleton mt2" style="width:60%"></div></div>`;
  try {
    const snap = await getDoc(doc(db, 'clients', id));
    if (!snap.exists()) {
      root.innerHTML = `<div class="empty"><div class="empty__ico">⚠️</div><h3>Client not found</h3></div>`;
      return;
    }
    const c = { id: snap.id, ...snap.data() };

    let visits = [];
    try {
      visits = await listDocs('visits', { where: [['clientId', '==', id]], order: 'createdAt', max: 200 });
    } catch (e) { /* index may not exist yet */ }

    let consultations = [];
    try {
      consultations = await listDocs('consultations', { where: [['clientId', '==', id]], order: 'createdAt', max: 200 });
    } catch (e) { /* noop */ }

    const canEdit = can(profile, 'clinical.edit');

    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>${esc(c.fullName)}</h1>
          <p>${esc(c.clientId || c.id)} · ${esc(c.sex || '')} · Registered ${fmtDate(c.createdAt)}</p>
        </div>
        <div class="row">
          <a class="btn" href="clients.html">← Clients</a>
          ${canEdit ? `<button class="btn btn--primary" id="new-visit">+ New visit</button>` : ''}
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card__head"><h3>Demographics</h3></div>
          <div class="card__body">
            <dl class="kv">
              <dt>Client ID</dt><dd class="mono">${esc(c.clientId || '—')}</dd>
              <dt>Sex</dt><dd>${esc(c.sex || '—')}</dd>
              <dt>Date of birth</dt><dd>${esc(c.dob || '—')}</dd>
              <dt>Phone</dt><dd>${esc(c.phone || '—')}</dd>
              <dt>Address</dt><dd>${esc(c.address || '—')}</dd>
              <dt>Next of kin</dt><dd>${esc(c.nextOfKin || '—')}</dd>
              <dt>Emergency</dt><dd>${esc(c.emergencyContact || '—')}</dd>
              <dt>Branch</dt><dd>${esc(c.branchId || '—')}</dd>
            </dl>
          </div>
        </div>
        <div class="card">
          <div class="card__head"><h3>Clinical notes</h3></div>
          <div class="card__body">
            <h4>Allergies</h4>
            <p>${esc(c.allergies || 'None recorded')}</p>
            <h4>Relevant medical info</h4>
            <p>${esc(c.medicalInfo || '—')}</p>
          </div>
        </div>
      </div>

      <div class="card mt2">
        <div class="card__head"><h3>Visit history</h3><span class="badge">${visits.length}</span></div>
        <div id="visits"></div>
      </div>

      <div class="card mt2">
        <div class="card__head"><h3>Consultations</h3><span class="badge">${consultations.length}</span></div>
        <div id="consults"></div>
      </div>
    `;

    qs('#visits').innerHTML = visits.length ? `<table class="table">
      <thead><tr><th>Date</th><th>Reason</th><th>Clinician</th><th>Status</th><th></th></tr></thead>
      <tbody>${visits.map(v => `<tr>
        <td>${fmtDateTime(v.createdAt)}</td>
        <td>${esc(v.reason || '—')}</td>
        <td>${esc(v.clinicianName || '—')}</td>
        <td>${esc(v.status || '—')}</td>
        <td class="actions">
          ${canEdit ? `<a class="btn btn--sm" href="consultation.html?visitId=${esc(v.id)}&clientId=${esc(c.id)}">Consult</a>` : ''}
        </td>
      </tr>`).join('')}</tbody></table>` : `<div class="empty small">No visits yet.</div>`;

    qs('#consults').innerHTML = consultations.length ? `<table class="table">
      <thead><tr><th>Date</th><th>Complaint</th><th>Diagnosis</th><th>Clinician</th></tr></thead>
      <tbody>${consultations.map(x => `<tr>
        <td>${fmtDateTime(x.createdAt)}</td>
        <td>${esc(x.chiefComplaint || '—')}</td>
        <td>${esc(x.diagnosis || '—')}</td>
        <td>${esc(x.clinicianName || '—')}</td>
      </tr>`).join('')}</tbody></table>` : `<div class="empty small">No consultations yet.</div>`;

    qs('#new-visit')?.addEventListener('click', () => openVisit(c));
  } catch (e) {
    root.innerHTML = `<div class="empty"><div class="empty__ico">⚠️</div><p>${esc(humanError(e))}</p></div>`;
  }
}

function openVisit(c) {
  modal({
    title: `New visit — ${c.fullName}`,
    body: `<form id="vf">
      <label class="field"><span>Reason for visit <span class="req">*</span></span>
        <input name="reason" required placeholder="e.g. Fever, cough">
      </label>
      <label class="field"><span>Clinician</span>
        <input name="clinicianName" value="${esc(profile.fullName)}">
      </label>
      <label class="field"><span>Notes</span><textarea name="notes"></textarea></label>
    </form>`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create visit', class: 'btn--primary', close: false,
        onClick: async (e, close) => {
          const form = qs('#vf');
          if (!form.reportValidity()) return false;
          const d = formData(form);
          try {
            const { addDocAuto } = await import('../db.js');
            const visitId = await addDocAuto('visits', {
              clientId: c.id,
              clientName: c.fullName,
              clientRef: c.clientId || null,
              branchId: c.branchId || profile.branchId || null,
              clinicianId: profile.uid,
              status: 'OPEN',
              reason: d.reason,
              clinicianName: d.clinicianName,
              notes: d.notes
            });
            const { audit } = await import('../ops.js');
            await audit(profile, 'VISIT_CREATED', { visitId, clientId: c.id });
            toast('Visit created.', 'success');
            close();
            location.href = `consultation.html?visitId=${visitId}&clientId=${c.id}`;
          } catch (err) { toast(humanError(err), 'err'); return false; }
        }
      }
    ]
  });
}