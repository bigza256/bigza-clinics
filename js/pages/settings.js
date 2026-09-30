import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { db, doc, getDoc, setDoc, serverTimestamp } from '../firebase.js';
import { audit } from '../ops.js';
import { el, qs, esc, toast, humanError, formData } from '../utils.js';

const profile = await shellReady;
const root = qs('#page-root');
root.innerHTML = `
<div class="page-head"><div><h1>Settings</h1><p>System configuration</p></div></div>
<div class="grid-2">
  <div class="card">
    <div class="card__head"><h3>Clinic profile</h3></div>
    <div class="card__body"><form id="clinic-form">
      <label class="field"><span>Clinic name</span><input name="clinicName" placeholder="BIGZA Clinics"></label>
      <label class="field"><span>Phone</span><input name="phone" type="tel"></label>
      <label class="field"><span>Email</span><input name="email" type="email"></label>
      <label class="field"><span>Address</span><textarea name="address"></textarea></label>
      <button class="btn btn--primary" type="submit">Save clinic</button>
    </form></div>
  </div>
  <div class="card">
    <div class="card__head"><h3>Inventory thresholds</h3></div>
    <div class="card__body"><form id="inv-form">
      <label class="field"><span>Low-stock threshold</span><input type="number" name="lowStockThreshold" placeholder="20"></label>
      <label class="field"><span>Expiry warning (days)</span><input type="number" name="expiryWarningDays" placeholder="60"></label>
      <label class="field"><span>Adjustment approval threshold (UGX)</span><input type="number" name="adjustmentThreshold" placeholder="50000"></label>
      <button class="btn btn--primary" type="submit">Save inventory</button>
    </form></div>
  </div>
  <div class="card">
    <div class="card__head"><h3>Finance</h3></div>
    <div class="card__body"><form id="fin-form">
      <label class="field"><span>Currency</span><input name="currency" value="UGX"></label>
      <label class="field"><span>Receipt prefix</span><input name="receiptPrefix" value="BZ-RCP"></label>
      <button class="btn btn--primary" type="submit">Save finance</button>
    </form></div>
  </div>
  <div class="card">
    <div class="card__head"><h3>Payment methods</h3></div>
    <div class="card__body">
      <label class="check"><input type="checkbox" checked disabled> Cash</label><br>
      <label class="check"><input type="checkbox" checked disabled> Mobile Money</label><br>
      <label class="check"><input type="checkbox" checked disabled> Bank</label><br>
      <label class="check"><input type="checkbox" checked disabled> Card</label><br>
      <label class="check"><input type="checkbox" checked disabled> Insurance</label>
      <p class="muted small mt2">Payment methods are configurable in a future release.</p>
    </div>
  </div>
</div>`;

await loadAll();

async function loadAll() {
  for (const key of ['clinic', 'inventory', 'finance']) {
    try {
      const s = await getDoc(doc(db, 'settings', key));
      if (s.exists()) fill(key, s.data());
    } catch (e) { console.warn(e); }
  }
}

function fill(key, data) {
  const form = qs(`#${key}-form`);
  if (!form) return;
  for (const [k, v] of Object.entries(data)) {
    const el = form.elements[k];
    if (el) el.value = v ?? '';
  }
}

qs('#clinic-form').addEventListener('submit', e => save('clinic', e));
qs('#inv-form').addEventListener('submit', e => save('inventory', e));
qs('#fin-form').addEventListener('submit', e => save('finance', e));

async function save(key, e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const data = formData(e.target);
    await setDoc(doc(db, 'settings', key), { ...data, updatedAt: serverTimestamp(), updatedBy: profile.uid }, { merge: true });
    await audit(profile, 'SETTINGS_UPDATE', { key });
    toast('Settings saved.', 'success');
  } catch (err) { toast(humanError(err), 'err'); }
  finally { btn.disabled = false; }
}