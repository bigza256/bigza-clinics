import { requireAuth, currentProfile, onUser } from './auth.js';
import { visibleNav, BOTTOM_NAV } from './navigation.js';
import { auth, signOut } from './firebase.js';
import { el, qs, esc, toast } from './utils.js';

export const shellReady = (async () => {
  const profile = await requireAuth();
  const mount = qs('#app-shell') || (() => { const m = el('div', { id: 'app-shell' }); document.body.prepend(m); return m; })();
  mount.innerHTML = '';
  const page = document.body.dataset.page || '';
  const groups = visibleNav(profile);

  const sidebar = el('aside', { class: 'sidebar' });
  sidebar.append(el('div', { class: 'brand' }, [
    el('div', { class: 'brand-mark' }, ['BZ']),
    el('div', { class: 'brand-text' }, [el('b', {}, ['BIGZA']), el('span', {}, ['Clinics'])]),
    el('button', { class: 'icon-btn', style: 'margin-left:auto;color:#fff', onclick: () => document.body.classList.remove('nav-open') }, ['✕'])
  ]));
  const navUl = el('ul', { class: 'nav' });
  for (const g of groups) {
    navUl.append(el('li', { class: 'nav__group' }, [g.group]));
    for (const it of g.items) {
      navUl.append(el('li', {}, [el('a', { href: it.href, class: it.id === page ? 'active' : '' }, [
        el('span', { class: 'ico' }, [it.ico]), it.label
      ])]));
    }
  }
  sidebar.append(navUl);
  sidebar.append(el('div', { class: 'nav__foot' }, [
    `v1.0 · ${esc(profile.role)}`
  ]));

  const initials = (profile.fullName || 'U').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

  const topbar = el('header', { class: 'topbar' });
  topbar.append(el('div', { class: 'tb-left' }, [
    el('button', { class: 'icon-btn', id: 'nav-toggle', onclick: () => document.body.classList.toggle('nav-open') }, ['☰']),
    el('div', {}, [
      el('h1', { class: 'tb-title', id: 'tb-title' }, [document.title.split(' · ')[0] || 'Dashboard']),
      el('div', { class: 'tb-branch', id: 'tb-branch' }, [profile.branchId ? `📍 Branch: ${profile.branchId}` : '📍 All branches'])
    ])
  ]));
  topbar.append(el('div', { class: 'tb-search' }, [
    el('span', { class: 'ico' }, ['🔍']),
    el('input', { type: 'search', placeholder: 'Search…', id: 'global-search' })
  ]));
  topbar.append(el('button', { class: 'icon-btn', onclick: () => location.href = 'notifications.html', title: 'Notifications' }, ['🔔']));
  const userBtn = el('div', { class: 'tb-user', onclick: openUserMenu });
  userBtn.append(el('div', { class: 'tb-avatar' }, [initials]));
  userBtn.append(el('div', { class: 'tb-user-info' }, [
    el('b', {}, [profile.fullName || profile.email]),
    el('span', {}, [roleLabel(profile.role)])
  ]));
  topbar.append(userBtn);

  const main = el('main', { class: 'main' }, [el('div', { id: 'page-root' })]);
  const scrim = el('div', { class: 'nav-scrim', onclick: () => document.body.classList.remove('nav-open') });
  const bottom = el('nav', { class: 'bottom-nav' });
  for (const id of BOTTOM_NAV) {
    const item = findNav(id);
    if (!item) continue;
    if (!can(profile, item.perm)) continue;
    bottom.append(el('a', { href: item.href, class: id === page ? 'active' : '' }, [
      el('span', { class: 'ico' }, [item.ico]),
      el('span', {}, [item.label])
    ]));
  }

  const shell = el('div', { class: 'shell' }, [sidebar, topbar, main, scrim, bottom]);
  mount.append(shell);

  qs('#global-search').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      toast('Global search is limited in this build. Use page filters.', 'info');
    }
  });

  onUser((p) => { if (!p) location.replace('login.html'); });
  return profile;
})();

function findNav(id) {
  for (const it of (window.__NAV_CACHE || [])) return null;
  // fallback: look through imported nav
  return null;
}
// Small helper to look up nav item
import { NAV } from './navigation.js';
function findNavItem(id) { return NAV.find(n => n.id === id); }
// patch bottom nav build
(function patch() {})()

function roleLabel(r) {
  return ({
    SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin / Head Office', BRANCH_MANAGER: 'Branch Manager',
    CLINICIAN: 'Clinician', NURSE: 'Nurse', DISPENSER: 'Pharmacy Staff', CASHIER: 'Cashier',
    STOREKEEPER: 'Storekeeper', LAB: 'Lab Staff', VIEWER: 'Viewer'
  })[r] || r || '—';
}

function openUserMenu() {
  import('./utils.js').then(({ modal }) => {
    const p = currentProfile() || {};
    const html = `
      <dl class="kv">
        <dt>Name</dt><dd>${esc(p.fullName || '—')}</dd>
        <dt>Email</dt><dd>${esc(p.email || '—')}</dd>
        <dt>Role</dt><dd>${esc(roleLabel(p.role))}</dd>
        <dt>Branch</dt><dd>${esc(p.branchId || 'All branches')}</dd>
      </dl>`;
    modal({
      title: 'Account', body: html,
      actions: [
        { label: 'Close' },
        { label: 'Sign out', class: 'btn--danger', onClick: async () => { await signOut(auth); location.replace('login.html'); } }
      ]
    });
  });
}

// Fix bottom nav: rebuild with proper lookup
import { can } from './permissions.js';