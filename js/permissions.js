export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  CLINICIAN: 'CLINICIAN',
  NURSE: 'NURSE',
  DISPENSER: 'DISPENSER',
  CASHIER: 'CASHIER',
  STOREKEEPER: 'STOREKEEPER',
  LAB: 'LAB',
  VIEWER: 'VIEWER'
};

export const PERMS = {
  SUPER_ADMIN: ['*'],

  ADMIN: [
    'dashboard.view','branches.view','staff.view','staff.edit','clients.view','clients.edit',
    'clinical.view','clinical.edit','pharmacy.view','pharmacy.sell','dispense',
    'inventory.view','inventory.edit','stock.receive','stock.transfer','stock.count','stock.adjust',
    'suppliers.view','suppliers.edit','purchases.view','purchases.edit','laboratory.view','laboratory.edit',
    'sales.view','sales.refund','payments.view','payments.create','expenses.view','expenses.create',
    'ledger.view','cash.close','reports.view','reports.clinical','audit.view','notifications.view',
    'settings.view','settings.edit','export.data'
  ],

  BRANCH_MANAGER: [
    'dashboard.view','staff.view','clients.view','clients.edit','clinical.view',
    'pharmacy.view','pharmacy.sell','dispense','inventory.view','inventory.edit',
    'stock.receive','stock.transfer','stock.count','stock.adjust',
    'suppliers.view','suppliers.edit','purchases.view','purchases.edit','laboratory.view','laboratory.edit',
    'sales.view','sales.refund','payments.view','payments.create','expenses.view','expenses.create',
    'ledger.view','cash.close','reports.view','reports.clinical','notifications.view','export.data'
  ],

  /* Clinician: full clinical + can request labs. Does NOT sell or adjust stock. */
  CLINICIAN: [
    'dashboard.view','clients.view','clients.edit','clinical.view','clinical.edit',
    'pharmacy.view','inventory.view','laboratory.view','laboratory.edit','reports.clinical'
  ],

  /* Nurse: expanded — records vitals, writes notes, sells drugs,
     dispenses against prescriptions, and can adjust/count stock
     as authorised by a branch manager. Cannot refund or edit finance. */
  NURSE: [
    'dashboard.view',
    'clients.view','clients.edit',
    'clinical.view','clinical.edit',
    'pharmacy.view','pharmacy.sell','dispense',
    'inventory.view','inventory.edit',
    'stock.count',
    'laboratory.view',
    'notifications.view'
  ],

  DISPENSER: [
    'dashboard.view','clients.view','pharmacy.view','pharmacy.sell','dispense',
    'inventory.view','inventory.edit','stock.count','notifications.view'
  ],

  CASHIER: [
    'dashboard.view','clients.view','sales.view','payments.view','payments.create',
    'ledger.view','cash.close','notifications.view'
  ],

  STOREKEEPER: [
    'dashboard.view','inventory.view','inventory.edit',
    'stock.receive','stock.transfer','stock.count','stock.adjust',
    'suppliers.view','suppliers.edit','purchases.view','purchases.edit','notifications.view'
  ],

  LAB: [
    'dashboard.view','clients.view','laboratory.view','laboratory.edit',
    'inventory.view','notifications.view'
  ],

  VIEWER: ['dashboard.view']
};

export function can(user, perm) {
  if (!user) return false;
  const list = PERMS[user.role] || [];
  if (list.includes('*')) return true;
  return list.includes(perm);
}

export function isBranchScoped(user) {
  if (!user) return true;
  return user.role !== ROLES.SUPER_ADMIN && user.role !== ROLES.ADMIN;
}

export function canAccessBranch(user, branchId) {
  if (!user) return false;
  if (!isBranchScoped(user)) return true;
  return user.branchId === branchId;
}