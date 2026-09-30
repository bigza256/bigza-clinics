export const NAV = [
  { group: 'Overview' },
  { id: 'dashboard',     label: 'Dashboard',     href: 'dashboard.html',     ico: '📊', perm: 'dashboard.view' },

  { group: 'Clinical' },
  { id: 'clients',       label: 'Clients',       href: 'clients.html',       ico: '🧑', perm: 'clients.view' },
  { id: 'visits',        label: 'Visits',        href: 'visits.html',        ico: '🗂️', perm: 'clinical.view' },
  { id: 'consultation',  label: 'Consultation',  href: 'consultation.html',  ico: '🩺', perm: 'clinical.edit' },
  { id: 'laboratory',    label: 'Laboratory',    href: 'laboratory.html',    ico: '🧪', perm: 'laboratory.view' },

  { group: 'Pharmacy & Stock' },
  { id: 'pharmacy',      label: 'Pharmacy POS',  href: 'pharmacy.html',      ico: '💊', perm: 'pharmacy.sell' },
  { id: 'dispensing',    label: 'Dispensing',    href: 'dispensing.html',    ico: '📤', perm: 'dispense' },
  { id: 'medicines',     label: 'Medicines',     href: 'medicines.html',     ico: '🧾', perm: 'inventory.view' },
  { id: 'batches',       label: 'Batches',       href: 'batches.html',       ico: '🏷️', perm: 'inventory.view' },
  { id: 'inventory',     label: 'Inventory',     href: 'inventory.html',     ico: '📦', perm: 'inventory.view' },
  { id: 'stock-receive', label: 'Receive Stock', href: 'stock-receive.html', ico: '📥', perm: 'stock.receive' },
  { id: 'stock-transfers', label: 'Transfers',   href: 'stock-transfers.html', ico: '🔄', perm: 'stock.transfer' },
  { id: 'stock-count',   label: 'Stock Count',   href: 'stock-count.html',   ico: '🔢', perm: 'stock.count' },
  { id: 'stock-adjustments', label: 'Adjustments', href: 'stock-adjustments.html', ico: '⚖️', perm: 'stock.adjust' },
  { id: 'suppliers',     label: 'Suppliers',     href: 'suppliers.html',     ico: '🏢', perm: 'suppliers.view' },
  { id: 'purchases',     label: 'Purchases',     href: 'purchases.html',     ico: '🛒', perm: 'purchases.view' },

  { group: 'Finance' },
  { id: 'sales',         label: 'Sales',         href: 'sales.html',         ico: '🧮', perm: 'sales.view' },
  { id: 'payments',      label: 'Payments',      href: 'payments.html',      ico: '💳', perm: 'payments.view' },
  { id: 'expenses',      label: 'Expenses',      href: 'expenses.html',      ico: '📉', perm: 'expenses.view' },
  { id: 'ledger',        label: 'Ledger',        href: 'ledger.html',        ico: '📒', perm: 'ledger.view' },
  { id: 'cash-closure',  label: 'Cash Closure',  href: 'cash-closure.html',  ico: '💰', perm: 'cash.close' },

  { group: 'Admin' },
  { id: 'reports',       label: 'Reports',       href: 'reports.html',       ico: '📈', perm: 'reports.view' },
  { id: 'audit-logs',    label: 'Audit Logs',    href: 'audit-logs.html',    ico: '🛡️', perm: 'audit.view' },
  { id: 'notifications', label: 'Notifications', href: 'notifications.html', ico: '🔔', perm: 'notifications.view' },
  { id: 'branches',      label: 'Branches',      href: 'branches.html',      ico: '🏥', perm: 'branches.view' },
  { id: 'staff',         label: 'Staff',         href: 'staff.html',         ico: '👥', perm: 'staff.view' },
  { id: 'settings',      label: 'Settings',      href: 'settings.html',      ico: '⚙️', perm: 'settings.view' }
];

export const BOTTOM_NAV = ['dashboard', 'clients', 'pharmacy', 'sales', 'notifications'];

import { can } from './permissions.js';

export function visibleNav(profile) {
  const groups = [];
  let cur = null;
  for (const item of NAV) {
    if (item.group) { cur = { group: item.group, items: [] }; groups.push(cur); continue; }
    if (!can(profile, item.perm)) continue;
    cur.items.push(item);
  }
  return groups.filter(g => g.items.length);
}