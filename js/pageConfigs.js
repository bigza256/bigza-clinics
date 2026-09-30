export const CONFIGS = {
  medicines: {
    title: 'Medicines',
    collection: 'medicines',
    perm: 'inventory.view',
    columns: [
      { key: 'genericName', label: 'Generic' },
      { key: 'strength', label: 'Strength' },
      { key: 'dosageForm', label: 'Form' },
      { key: 'category', label: 'Category' },
      { key: 'sellingPrice', label: 'Selling (UGX)', fmt: 'ugx', num: true },
      { key: 'reorderLevel', label: 'Reorder', num: true }
    ],
    form: [
      { name: 'genericName', label: 'Generic name', required: true },
      { name: 'brandName', label: 'Brand name' },
      { name: 'strength', label: 'Strength (e.g. 500mg)' },
      { name: 'dosageForm', label: 'Dosage form', type: 'select', options: ['Tablet','Capsule','Syrup','Suspension','Injection','IV Fluid','Cream','Ointment','Drops','Inhaler','Suppository'] },
      { name: 'category', label: 'Category' },
      { name: 'unit', label: 'Unit', type: 'select', options: ['tablet','capsule','bottle','vial','ampoule','tube','sachet','pack','box','litre','piece','pair'] },
      { name: 'packSize', label: 'Pack size (units per pack)', type: 'number' },
      { name: 'sellingPrice', label: 'Default selling price (UGX)', type: 'number', required: true },
      { name: 'reorderLevel', label: 'Reorder level', type: 'number' },
      { name: 'barcode', label: 'Barcode / SKU' }
    ]
  },
  suppliers: {
    title: 'Suppliers',
    collection: 'suppliers',
    perm: 'suppliers.view',
    columns: [
      { key: 'name', label: 'Supplier' },
      { key: 'company', label: 'Company' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' }
    ],
    form: [
      { name: 'name', label: 'Supplier name', required: true },
      { name: 'company', label: 'Company' },
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' },
      { name: 'address', label: 'Address', type: 'textarea' },
      { name: 'license', label: 'Licence / details' }
    ]
  },
  branches: {
    title: 'Branches',
    collection: 'branches',
    perm: 'branches.view',
    columns: [
      { key: 'name', label: 'Branch' },
      { key: 'location', label: 'Location' },
      { key: 'phone', label: 'Phone' },
      { key: 'active', label: 'Active', fmt: 'bool' }
    ],
    form: [
      { name: 'name', label: 'Branch name', required: true },
      { name: 'location', label: 'Location' },
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' },
      { name: 'active', label: 'Active', type: 'checkbox', default: true }
    ]
  },
  staff: {
    title: 'Staff',
    collection: 'users',
    perm: 'staff.view',
    columns: [
      { key: 'fullName', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
      { key: 'branchId', label: 'Branch' },
      { key: 'active', label: 'Active', fmt: 'bool' }
    ],
    form: [
      { name: 'fullName', label: 'Full name', required: true },
      { name: 'email', label: 'Email', required: true },
      { name: 'phone', label: 'Phone' },
      { name: 'role', label: 'Role', type: 'select', required: true, options: ['SUPER_ADMIN','ADMIN','BRANCH_MANAGER','CLINICIAN','NURSE','DISPENSER','CASHIER','STOREKEEPER','LAB','VIEWER'] },
      { name: 'branchId', label: 'Branch ID' },
      { name: 'active', label: 'Active', type: 'checkbox', default: true }
    ]
  },
  batches: {
    title: 'Batches',
    collection: 'batches',
    perm: 'inventory.view',
    readOnly: true,
    columns: [
      { key: 'medicineName', label: 'Medicine' },
      { key: 'batchNumber', label: 'Batch #' },
      { key: 'expiryDate', label: 'Expiry', fmt: 'date' },
      { key: 'quantityReceived', label: 'Received', num: true },
      { key: 'quantityRemaining', label: 'Remaining', num: true },
      { key: 'buyingPrice', label: 'Buying (UGX)', fmt: 'ugx', num: true }
    ]
  },
  purchases: {
    title: 'Purchases',
    collection: 'purchases',
    perm: 'purchases.view',
    readOnly: true,
    columns: [
      { key: 'ref', label: 'Ref' },
      { key: 'supplierName', label: 'Supplier' },
      { key: 'invoiceNumber', label: 'Invoice' },
      { key: 'totalCost', label: 'Total (UGX)', fmt: 'ugx', num: true },
      { key: 'paymentStatus', label: 'Status' },
      { key: 'purchaseDate', label: 'Date', fmt: 'date' }
    ]
  },
  payments: {
    title: 'Payments',
    collection: 'payments',
    perm: 'payments.view',
    readOnly: true,
    columns: [
      { key: 'reference', label: 'Ref' },
      { key: 'amount', label: 'Amount (UGX)', fmt: 'ugx', num: true },
      { key: 'paymentMethod', label: 'Method' },
      { key: 'direction', label: 'Direction' },
      { key: 'performedByName', label: 'By' },
      { key: 'timestamp', label: 'When', fmt: 'datetime' }
    ]
  },
  laboratory: {
    title: 'Laboratory Requests',
    collection: 'laboratory',
    perm: 'laboratory.view',
    columns: [
      { key: 'clientName', label: 'Client' },
      { key: 'test', label: 'Test' },
      { key: 'status', label: 'Status' },
      { key: 'result', label: 'Result' },
      { key: 'createdAt', label: 'Requested', fmt: 'datetime' }
    ],
    form: [
      { name: 'clientName', label: 'Client name', required: true },
      { name: 'test', label: 'Test', required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['REQUESTED','IN_PROGRESS','COMPLETED','CANCELLED'] },
      { name: 'result', label: 'Result', type: 'textarea' }
    ]
  },
  notifications: {
    title: 'Notifications',
    collection: 'notifications',
    perm: 'notifications.view',
    readOnly: true,
    columns: [
      { key: 'type', label: 'Type' },
      { key: 'title', label: 'Title' },
      { key: 'message', label: 'Message' },
      { key: 'createdAt', label: 'When', fmt: 'datetime' }
    ]
  },
  'stock-adjustments': {
    title: 'Stock Adjustments',
    collection: 'stockAdjustments',
    perm: 'stock.adjust',
    readOnly: true,
    columns: [
      { key: 'ref', label: 'Ref' },
      { key: 'medicineName', label: 'Medicine' },
      { key: 'batchNumber', label: 'Batch' },
      { key: 'adjustQty', label: 'Qty', num: true },
      { key: 'reason', label: 'Reason' },
      { key: 'performedByName', label: 'By' },
      { key: 'createdAt', label: 'When', fmt: 'datetime' }
    ]
  },
  visits: {
    title: 'Visits',
    collection: 'visits',
    perm: 'clinical.view',
    columns: [
      { key: 'clientName', label: 'Client' },
      { key: 'reason', label: 'Reason' },
      { key: 'clinicianName', label: 'Clinician' },
      { key: 'status', label: 'Status' },
      { key: 'createdAt', label: 'When', fmt: 'datetime' }
    ],
    form: [
      { name: 'clientName', label: 'Client name', required: true },
      { name: 'reason', label: 'Reason for visit', required: true },
      { name: 'clinicianName', label: 'Clinician' },
      { name: 'status', label: 'Status', type: 'select', options: ['OPEN','CLOSED','CANCELLED'] },
      { name: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  consultation: {
    title: 'Consultations',
    collection: 'consultations',
    perm: 'clinical.edit',
    columns: [
      { key: 'clientName', label: 'Client' },
      { key: 'chiefComplaint', label: 'Complaint' },
      { key: 'diagnosis', label: 'Diagnosis' },
      { key: 'createdAt', label: 'When', fmt: 'datetime' }
    ],
    form: [
      { name: 'clientName', label: 'Client name', required: true },
      { name: 'chiefComplaint', label: 'Chief complaint', type: 'textarea' },
      { name: 'history', label: 'History', type: 'textarea' },
      { name: 'examination', label: 'Examination findings', type: 'textarea' },
      { name: 'assessment', label: 'Assessment', type: 'textarea' },
      { name: 'diagnosis', label: 'Diagnosis' },
      { name: 'treatmentPlan', label: 'Treatment plan', type: 'textarea' },
      { name: 'followUp', label: 'Follow-up instructions', type: 'textarea' }
    ]
  },
  dispensing: {
    title: 'Dispensing Queue',
    collection: 'prescriptions',
    perm: 'dispense',
    readOnly: true,
    columns: [
      { key: 'clientName', label: 'Client' },
      { key: 'medicineName', label: 'Medicine' },
      { key: 'quantity', label: 'Qty', num: true },
      { key: 'status', label: 'Status' },
      { key: 'createdAt', label: 'When', fmt: 'datetime' }
    ]
  }
};