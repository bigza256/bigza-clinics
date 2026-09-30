export const qs = (s, r = document) => r.querySelector(s);
export const qsa = (s, r = document) => [...r.querySelectorAll(s)];

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export const fmtUGX = (n) => 'UGX ' + Math.round(Number(n) || 0).toLocaleString('en-UG');
export const fmtNum = (n) => (Number(n) || 0).toLocaleString('en-UG');

export function fmtDate(v) {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v));
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' });
}
export function fmtDateTime(v) {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v));
  if (isNaN(d)) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' });
}
export function todayISO() {
  const d = new Date();
  const tz = d.toLocaleString('en-GB', { timeZone: 'Africa/Kampala' });
  const [dd, mm, yyyy] = tz.split(',')[0].split('/');
  return `${yyyy}-${mm}-${dd}`;
}

export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* IDs */
export function branchCode(branchName = 'MAIN') {
  const m = branchName.match(/[A-Za-z]{3,}/g);
  return (m ? m[m.length - 1] : 'MAIN').slice(0, 3).toUpperCase();
}
export function makeRef(prefix, branch = 'MAIN', seq) {
  const n = String(seq).padStart(6, '0');
  return `BZ-${prefix}-${branchCode(branch)}-${n}`;
}
export function clientId(seq, year = new Date().getFullYear()) {
  return `BZC-${year}-${String(seq).padStart(6, '0')}`;
}

/* Toasts */
export function toast(msg, kind = 'info', ms = 3200) {
  const root = qs('#toasts') || (() => { const r = el('div', { id: 'toasts', class: 'toasts' }); document.body.append(r); return r; })();
  const t = el('div', { class: `toast toast--${kind}` }, [msg]);
  root.append(t);
  setTimeout(() => t.remove(), ms);
}

/* Modal */
export function modal({ title, body, actions = [], onMount }) {
  const root = qs('#modal-root') || (() => { const r = el('div', { id: 'modal-root' }); document.body.append(r); return r; })();
  const backdrop = el('div', { class: 'modal-backdrop' });
  const bodyNode = el('div', { class: 'modal__body' });
  if (typeof body === 'string') bodyNode.innerHTML = body; else bodyNode.append(body);
  const foot = el('div', { class: 'modal__foot' });
  const close = () => backdrop.remove();
  for (const a of actions) {
    foot.append(el('button', {
      class: `btn ${a.class || 'btn--ghost'}`,
      type: 'button',
      onclick: async (e) => {
        if (a.onClick) {
          const keep = await a.onClick(e, close);
          if (keep === false) return;
        }
        if (a.close !== false) close();
      }
    }, [a.label]));
  }
  const m = el('div', { class: 'modal' }, [
    el('div', { class: 'modal__head' }, [el('h3', {}, [title]), el('button', { class: 'icon-btn', type: 'button', onclick: close }, ['✕'])]),
    bodyNode,
    foot
  ]);
  backdrop.append(m);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  root.append(backdrop);
  if (onMount) onMount(bodyNode, close);
  return { close, body: bodyNode };
}

export function confirmDialog({ title = 'Confirm', message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    modal({
      title,
      body: `<p>${esc(message)}</p>`,
      actions: [
        { label: 'Cancel', onClick: () => resolve(false) },
        { label: confirmLabel, class: danger ? 'btn--danger' : 'btn--primary', onClick: () => resolve(true) }
      ]
    });
  });
}

/* Form helpers */
export function formData(formEl) {
  const out = {};
  for (const el of formEl.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value.trim ? el.value.trim() : el.value;
  }
  return out;
}

export function humanError(err, fallback = 'Something went wrong. Please try again.') {
  const code = err?.code || '';
  if (code.includes('permission-denied')) return 'You do not have permission to perform this action. Contact your branch manager.';
  if (code.includes('unavailable') || code.includes('network')) return 'Network problem. Please check your connection and retry.';
  if (code.includes('not-found')) return 'The requested record could not be found.';
  if (code.includes('already-exists')) return 'This record already exists.';
  if (code.includes('failed-precondition')) return 'Action cannot be completed in the current state.';
  if (code.includes('unauthenticated')) return 'Your session has expired. Please sign in again.';
  return err?.message || fallback;
}

/* Async button state */
export async function withBusy(btn, fn, busyLabel = 'Working…') {
  const prev = btn.textContent;
  btn.disabled = true; btn.textContent = busyLabel;
  try { return await fn(); }
  finally { btn.disabled = false; btn.textContent = prev; }
}

/* Escape key closes modal */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') qs('.modal-backdrop')?.remove();
});