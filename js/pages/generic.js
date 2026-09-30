import { shellReady } from '../shell.js';
import { currentProfile } from '../auth.js';
import { CONFIGS } from '../pageConfigs.js';
import { listDocs, addDocAuto, update } from '../db.js';
import { can } from '../permissions.js';
import { el, qs, esc, fmtUGX, fmtDate, fmtDateTime, toast, modal, formData, humanError, confirmDialog, debounce } from '../utils.js';
import { audit } from '../ops.js';

const profile = await shellReady;
const pageId = document.body.dataset.page;
const cfg = CONFIGS[pageId];
const root = qs('#page-root');

if (!cfg) { root.innerHTML = `<div class="empty">Page not configured.</div>`; }
else if (!can(profile, cfg.perm)) {
  root.innerHTML = `<div class="empty"><div class="empty__ico">🔒</div><h2>Access denied</h2><p class="muted">You do not have permission to view this page.</p></div>`;
} else {
  render(cfg);
}

function render(cfg) {
  const title = el('h1', {}, [cfg.title]);
  const head = el('div', { class: 'page-head' }, [
    el('div', {}, [title, el('p', {}, [`${cfg.collection} · ${profile.branchId || 'All branches'}`])]),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn', type: 'button', onclick: () => refresh() }, ['⟳ Refresh']),
      !cfg.readOnly && can(profile, cfg.perm) ? el('button', { class: 'btn btn--primary', type: 'button', onclick: () => openForm() }, ['+ New']) : null
    ])
  ]);
  const search = el('input', { type: 'search', placeholder: 'Search…' });
  const toolbar = el('div', { class: 'toolbar' }, [el('div', { class: 'grow' }, [search])]);
  const tableWrap = el('div', { class: 'table-wrap' });
  root.innerHTML = '';
  root.append(head, toolbar, tableWrap);

  let rows = [];
  search.addEventListener('input', debounce(() => paint(), 200));

  async function refresh() {
    tableWrap.innerHTML = `<div style="padding:1.5rem"><div class="skeleton" style="width:60%"></div><div class="skeleton mt2" style="width:80%"></div><div class="skeleton mt2" style="width:50%"></div></div>`;
    try {
      rows = await listDocs(cfg.collection, { max: 200 });
      paint();
    } catch (e) {
      tableWrap.innerHTML = `<div class="empty"><div class="empty__ico">⚠️</div><p>${esc(humanError(e))}</p></div>`;
    }
  }

  function paint() {
    const q = search.value.trim().toLowerCase();
    const filtered = q ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(q)) : rows;
    if (!filtered.length) {
      tableWrap.innerHTML = `<div class="empty"><div class="empty__ico">📭</div><h3>No records</h3><p class="muted">${cfg.readOnly ? 'Nothing to show yet.' : 'Click + New to create the first record.'}</p></div>`;
      return;
    }
    const thead = `<thead><tr>${cfg.columns.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')}${!cfg.readOnly ? '<th></th>' : ''}</tr></thead>`;
    const tbody = filtered.map(r => {
      const tds = cfg.columns.map(c => {
        let v = r[c.key];
        if (c.fmt === 'ugx') v = fmtUGX(v);
        else if (c.fmt === 'date') v = fmtDate(v);
        else if (c.fmt === 'datetime') v = fmtDateTime(v);
        else if (c.fmt === 'bool') v = v ? '<span class="badge badge--ok">Yes</span>' : '<span class="badge">No</span>';
        else v = esc(v ?? '—');
        return `<td${c.num ? ' class="num"' : ''}>${v}</td>`;
      }).join('');
      const actions = !cfg.readOnly ? `<td class="actions">
        <button class="btn btn--sm" data-edit="${esc(r.id)}">Edit</button>
      </td>` : '';
      return `<tr>${tds}${actions}</tr>`;
    }).join('');
    tableWrap.innerHTML = `<table class="table">${thead}<tbody>${tbody}</tbody></table>`;
    if (!cfg.readOnly) {
      tableWrap.querySelectorAll('[data-edit]').forEach(b => {
        b.addEventListener('click', () => openForm(filtered.find(x => x.id === b.dataset.edit)));
      });
    }
  }

  function openForm(existing) {
    const fields = cfg.form.map(f => fieldHTML(f, existing?.[f.name])).join('');
    modal({
      title: existing ? `Edit ${cfg.title.slice(0, -1) || cfg.title}` : `New ${cfg.title.slice(0, -1) || cfg.title}`,
      body: `<form id="crud-form">${fields}</form>`,
      actions: [
        { label: 'Cancel' },
        {
          label: existing ? 'Save changes' : 'Create', class: 'btn--primary', close: false,
          onClick: async (e, close) => {
            const form = qs('#crud-form');
            if (!form.reportValidity()) return false;
            const data = formData(form);
            try {
              if (existing) await update(cfg.collection, existing.id, data);
              else await addDocAuto(cfg.collection, { ...data, branchId: data.branchId || profile.branchId || null, createdBy: profile.uid });
              await audit(profile, existing ? 'UPDATE' : 'CREATE', { collection: cfg.collection, id: existing?.id });
              toast('Saved.', 'success');
              close();
              refresh();
            } catch (err) { toast(humanError(err), 'err'); return false; }
          }
        }
      ]
    });
  }

  refresh();
}

function fieldHTML(f, v) {
  const val = v ?? f.default ?? '';
  const req = f.required ? ' required' : '';
  const star = f.required ? ' <span class="req">*</span>' : '';
  const label = `<span>${esc(f.label)}${star}</span>`;
  if (f.type === 'textarea') return `<label class="field">${label}<textarea name="${f.name}"${req}>${esc(val)}</textarea></label>`;
  if (f.type === 'select') {
    const opts = (f.options || []).map(o => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('');
    return `<label class="field">${label}<select name="${f.name}"${req}>${opts}</select></label>`;
  }
  if (f.type === 'checkbox') return `<label class="field check"><input type="checkbox" name="${f.name}"${val ? ' checked' : ''}> <span>${esc(f.label)}</span></label>`;
  return `<label class="field">${label}<input type="${f.type || 'text'}" name="${f.name}" value="${esc(val)}"${req}></label>`;
}