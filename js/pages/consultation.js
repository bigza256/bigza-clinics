import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { db, doc, getDoc } from '../firebase.js';
import { addDocAuto, listDocs, update } from '../db.js';
import { audit } from '../ops.js';
import { el, qs, esc, toast, formData, humanError, fmtDateTime, modal } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');
const params = new URLSearchParams(location.search);
const visitId = params.get('visitId');
const clientId = params.get('clientId');

if (!visitId && !clientId) {
  root.innerHTML = `
    <div class="page-head"><div><h1>Consultation</h1><p>Record a new clinical encounter</p></div></div>
    <div class="card"><div class="card__body">
      <p class="muted">Open a visit from the <a href="visits.html">Visits</a> or <a href="clients.html">Clients</a> page to record a consultation.</p>
      <div class="field mt2">
        <label class="field"><span>Or enter client name to consult directly</span><input id="cn" placeholder="Client name"></label>
        <button class="btn btn--primary" id="go">Start consultation</button>
      </div>
    </div></div>`;
  qs('#go').onclick = () => {
    const name = qs('#cn').value.trim();
    if (!name) return;
    location.href = `consultation.html?clientId=manual&clientName=${encodeURIComponent(name)}`;
  };
} else {
  await start();
}

async function start() {
  let visit = null;
  let client = null;
  try {
    if (visitId) visit = await getDoc(doc(db, 'visits', visitId)).then(s => s.exists() ? { id: s.id, ...s.data() } : null);
    if (visit?.clientId) client = await getDoc(doc(db, 'clients', visit.clientId)).then(s => s.exists() ? { id: s.id, ...s.data() } : null);
    if (!client && clientId && clientId !== 'manual') client = await getDoc(doc(db, 'clients', clientId)).then(s => s.exists() ? { id: s.id, ...s.data() } : null);
  } catch (e) { console.warn(e); }

  const clientName = client?.fullName || params.get('clientName') || 'Unknown client';
  const clientRef = client?.clientId || (client ? client.id : '');

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Consultation</h1>
        <p>${esc(clientName)} ${clientRef ? '· ' + esc(clientRef) : ''} ${visit ? '· Visit ' + esc(visit.id.slice(0, 8)) : ''}</p>
      </div>
      <div class="row"><a class="btn" href="visits.html">← Visits</a></div>
    </div>

    <form id="cf" class="grid-2">
      <div class="card">
        <div class="card__head"><h3>Chief complaint &amp; history</h3></div>
        <div class="card__body">
          <label class="field"><span>Chief complaint</span><textarea name="chiefComplaint" rows="3"></textarea></label>
          <label class="field"><span>History</span><textarea name="history" rows="3"></textarea></label>
          <label class="field"><span>Examination findings</span><textarea name="examination" rows="3"></textarea></label>
        </div>
      </div>
      <div class="card">
        <div class="card__head"><h3>Assessment &amp; plan</h3></div>
        <div class="card__body">
          <label class="field"><span>Assessment</span><textarea name="assessment" rows="3"></textarea></label>
          <label class="field"><span>Diagnosis</span><input name="diagnosis" placeholder="e.g. Uncomplicated malaria"></label>
          <label class="field"><span>Treatment plan</span><textarea name="treatmentPlan" rows="3"></textarea></label>
          <label class="field"><span>Follow-up</span><textarea name="followUp" rows="2"></textarea></label>
        </div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <div class="card__head"><h3>Vital signs</h3></div>
        <div class="card__body">
          <div class="field-row">
            <label class="field"><span>Temperature (°C)</span><input name="temp" type="number" step="0.1"></label>
            <label class="field"><span>BP (mmHg)</span><input name="bp" placeholder="120/80"></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Pulse</span><input name="pulse" type="number"></label>
            <label class="field"><span>Resp rate</span><input name="resp" type="number"></label>
          </div>
          <div class="field-row">
            <label class="field"><span>O₂ sat (%)</span><input name="spo2" type="number"></label>
            <label class="field"><span>Weight (kg)</span><input name="weight" type="number" step="0.1"></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Height (cm)</span><input name="height" type="number"></label>
            <label class="field"><span>Blood glucose</span><input name="glucose" type="number" step="0.1"></label>
          </div>
          <label class="field"><span>Pain score (0–10)</span><input name="pain" type="number" min="0" max="10"></label>
        </div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <div class="card__head"><h3>Prescription</h3></div>
        <div class="card__body">
          <div class="row" style="gap:.5rem;flex-wrap:wrap">
            <button type="button" class="btn" id="add-rx">+ Add medicine</button>
            <span class="muted small" id="rx-count">0 items</span>
          </div>
          <div id="rx-list" class="mt2"><div class="empty small">No medicines added.</div></div>
        </div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <div class="card__foot" style="justify-content:flex-end">
          <button class="btn btn--primary" type="submit" id="save">Save consultation</button>
        </div>
      </div>
    </form>
  `;

  const rxItems = [];
  qs('#add-rx').onclick = () => openRxPicker(rxItems, paintRx);
  function paintRx() {
    qs('#rx-count').textContent = `${rxItems.length} items`;
    if (!rxItems.length) { qs('#rx-list').innerHTML = `<div class="empty small">No medicines added.</div>`; return; }
    qs('#rx-list').innerHTML = `<table class="table">
      <thead><tr><th>Medicine</th><th>Dose</th><th>Freq</th><th>Days</th><th class="num">Qty</th><th></th></tr></thead>
      <tbody>${rxItems.map((r, i) => `<tr>
        <td>${esc(r.medicineName)}<span class="subtle">${esc(r.strength || '')}</span></td>
        <td>${esc(r.dosage || '—')}</td>
        <td>${esc(r.frequency || '—')}</td>
        <td>${esc(r.duration || '—')}</td>
        <td class="num">${r.quantity}</td>
        <td class="actions"><button type="button" class="btn btn--sm" data-rxdel="${i}">✕</button></td>
      </tr>`).join('')}</tbody></table>`;
    qs('#rx-list').querySelectorAll('[data-rxdel]').forEach(b => b.onclick = () => { rxItems.splice(+b.dataset.rxdel, 1); paintRx(); });
  }

  qs('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('#save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const data = formData(qs('#cf'));
      const vitals = {
        temp: data.temp, bp: data.bp, pulse: data.pulse, resp: data.resp,
        spo2: data.spo2, weight: data.weight, height: data.height,
        glucose: data.glucose, pain: data.pain
      };
      const payload = {
        clientId: client?.id || null,
        clientName,
        clientRef,
        visitId: visitId || null,
        branchId: client?.branchId || profile.branchId || null,
        clinicianId: profile.uid,
        clinicianName: profile.fullName,
        chiefComplaint: data.chiefComplaint,
        history: data.history,
        examination: data.examination,
        assessment: data.assessment,
        diagnosis: data.diagnosis,
        treatmentPlan: data.treatmentPlan,
        followUp: data.followUp,
        vitals,
        prescriptionCount: rxItems.length
      };
      const conId = await addDocAuto('consultations', payload);

      if (rxItems.length) {
        const { addDoc } = await import('../firebase.js');
        const { collection, serverTimestamp } = await import('../firebase.js');
        for (const r of rxItems) {
          await addDoc(collection(db, 'prescriptions'), {
            consultationId: conId,
            clientId: client?.id || null,
            clientName,
            visitId: visitId || null,
            branchId: payload.branchId,
            medicineId: r.medicineId,
            medicineName: r.medicineName,
            strength: r.strength || null,
            dosage: r.dosage || null,
            frequency: r.frequency || null,
            duration: r.duration || null,
            quantity: r.quantity,
            instructions: r.instructions || null,
            status: 'PENDING',
            createdBy: profile.uid,
            createdByName: profile.fullName,
            createdAt: serverTimestamp()
          });
        }
      }

      if (visitId) {
        try { await update('visits', visitId, { status: 'CLOSED', consultationId: conId }); } catch (err) { console.warn(err); }
      }
      await audit(profile, 'CONSULTATION_CREATED', { consultationId: conId, clientId: client?.id, rxCount: rxItems.length });
      toast('Consultation saved.', 'success');
      setTimeout(() => location.href = client?.id ? `client-profile.html?id=${client.id}` : 'visits.html', 800);
    } catch (err) {
      toast(humanError(err), 'err');
      btn.disabled = false; btn.textContent = 'Save consultation';
    }
  });
}

function openRxPicker(items, onSave) {
  Promise.all([listDocs('medicines', { max: 500 })]).then(([meds]) => {
    modal({
      title: 'Add medicine',
      body: `<form id="rxf">
        <label class="field"><span>Medicine <span class="req">*</span></span>
          <select name="medicineId" required>
            <option value="">Select…</option>
            ${meds.map(m => `<option value="${esc(m.id)}" data-name="${esc(m.genericName)} ${esc(m.strength || '')}" data-strength="${esc(m.strength || '')}">${esc(m.genericName)} ${esc(m.strength || '')} (${esc(m.dosageForm || '')})</option>`).join('')}
          </select>
        </label>
        <div class="field-row">
          <label class="field"><span>Dose</span><input name="dosage" placeholder="1 tablet"></label>
          <label class="field"><span>Frequency</span><input name="frequency" placeholder="3× daily"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Duration</span><input name="duration" placeholder="5 days"></label>
          <label class="field"><span>Quantity</span><input name="quantity" type="number" min="1" required></label>
        </div>
        <label class="field"><span>Instructions</span><textarea name="instructions" rows="2"></textarea></label>
      </form>`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Add', class: 'btn--primary', close: false,
          onClick: async (e, close) => {
            const form = qs('#rxf');
            if (!form.reportValidity()) return false;
            const d = formData(form);
            const sel = form.elements['medicineId'].selectedOptions[0];
            items.push({
              medicineId: d.medicineId,
              medicineName: sel.dataset.name,
              strength: sel.dataset.strength,
              dosage: d.dosage, frequency: d.frequency,
              duration: d.duration, quantity: Number(d.quantity),
              instructions: d.instructions
            });
            onSave();
            close();
            return true;
          }
        }
      ]
    });
  });
}