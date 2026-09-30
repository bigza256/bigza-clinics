import { db, doc, collection, serverTimestamp, runTransaction, increment, addDoc, getDoc, setDoc }
  from './firebase.js';
import { nextCounter } from './db.js';
import { branchCode, makeRef } from './utils.js';

/* ---------- AUDIT ---------- */
export async function audit(profile, action, detail = {}) {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      uid: profile?.uid || null,
      userName: profile?.fullName || 'Unknown',
      role: profile?.role || null,
      branchId: profile?.branchId || detail.branchId || null,
      action,
      detail,
      timestamp: serverTimestamp()
    });
  } catch (e) { console.warn('audit failed', e); }
}

/* ---------- SALE + STOCK + LEDGER (atomic) ---------- */
export async function completeSale(profile, { branchId, items, paymentMethod, amountPaid, clientId, clientName, notes }) {
  // items: [{ medicineId, medicineName, batchId, batchNumber, quantity, unitPrice }]
  if (!items?.length) throw new Error('Cart is empty');
  const branch = await getDoc(doc(db, 'branches', branchId));
  const branchName = branch.exists() ? branch.data().name : branchId;

  const seq = await nextCounter('sales');
  const saleRef = makeRef('SALE', branchName, seq);
  const receiptRef = makeRef('RCP', branchName, seq);
  const saleDocRef = doc(collection(db, 'sales'));

  const totals = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);

  await runTransaction(db, async (tx) => {
    // 1) Verify and deduct stock for each line
    for (const it of items) {
      const bRef = doc(db, 'batches', it.batchId);
      const bs = await tx.get(bRef);
      if (!bs.exists()) throw new Error(`Batch ${it.batchNumber} not found`);
      const bdata = bs.data();
      const remaining = Number(bdata.quantityRemaining || 0);
      if (remaining < it.quantity) throw new Error(`Insufficient stock in batch ${it.batchNumber}. Available: ${remaining}`);
      tx.update(bRef, { quantityRemaining: remaining - it.quantity, updatedAt: serverTimestamp() });
    }
    // 2) Write sale doc
    tx.set(saleDocRef, {
      ref: saleRef,
      receiptRef,
      branchId, branchName,
      items, totals,
      paymentMethod: paymentMethod || 'CASH',
      amountPaid: Number(amountPaid ?? totals),
      change: Math.max(0, Number(amountPaid ?? totals) - totals),
      clientId: clientId || null,
      clientName: clientName || null,
      notes: notes || null,
      performedBy: profile.uid,
      performedByName: profile.fullName,
      status: 'COMPLETED',
      createdAt: serverTimestamp()
    });
    // 3) Stock ledger entries
    for (const it of items) {
      tx.set(doc(collection(db, 'stockLedger')), {
        branchId,
        medicineId: it.medicineId,
        medicineName: it.medicineName,
        batchId: it.batchId,
        batchNumber: it.batchNumber,
        transactionType: 'SALE',
        referenceId: saleDocRef.id,
        reference: saleRef,
        quantityIn: 0,
        quantityOut: it.quantity,
        unitCost: it.unitPrice,
        reason: 'Pharmacy sale',
        performedBy: profile.uid,
        performedByName: profile.fullName,
        timestamp: serverTimestamp()
      });
    }
    // 4) Financial ledger
    tx.set(doc(collection(db, 'financialLedger')), {
      branchId,
      type: 'SALE',
      referenceId: saleDocRef.id,
      reference: saleRef,
      description: `Sale ${saleRef}`,
      debit: 0,
      credit: totals,
      paymentMethod: paymentMethod || 'CASH',
      performedBy: profile.uid,
      performedByName: profile.fullName,
      timestamp: serverTimestamp()
    });
    // 5) Payment record
    tx.set(doc(collection(db, 'payments')), {
      branchId,
      referenceId: saleDocRef.id,
      reference: saleRef,
      amount: Number(amountPaid ?? totals),
      paymentMethod: paymentMethod || 'CASH',
      clientId: clientId || null,
      direction: 'IN',
      status: 'COMPLETED',
      performedBy: profile.uid,
      performedByName: profile.fullName,
      timestamp: serverTimestamp()
    });
  });

  await audit(profile, 'SALE', { saleRef, totals, branchId, items: items.length });
  return { id: saleDocRef.id, ref: saleRef, receiptRef, totals };
}

/* ---------- RECEIVE STOCK (GRN) ---------- */
export async function receiveStock(profile, { branchId, supplierId, supplierName, invoiceNumber, items, purchaseDate }) {
  // items: [{ medicineId, medicineName, batchNumber, expiryDate, quantity, buyingPrice, sellingPrice }]
  if (!items?.length) throw new Error('No items to receive');
  const branch = await getDoc(doc(db, 'branches', branchId));
  const branchName = branch.exists() ? branch.data().name : branchId;
  const seq = await nextCounter('purchases');
  const purchaseRef = makeRef('PUR', branchName, seq);
  const purchaseDocRef = doc(collection(db, 'purchases'));

  let totalCost = 0;
  for (const it of items) totalCost += it.quantity * it.buyingPrice;

  const batchIds = [];

  await runTransaction(db, async (tx) => {
    // Create batches and update stock
    for (const it of items) {
      const batchRef = doc(collection(db, 'batches'));
      batchIds.push(batchRef.id);
      tx.set(batchRef, {
        medicineId: it.medicineId,
        medicineName: it.medicineName,
        branchId,
        batchNumber: it.batchNumber,
        expiryDate: it.expiryDate,
        quantityReceived: it.quantity,
        quantityRemaining: it.quantity,
        buyingPrice: it.buyingPrice,
        sellingPrice: it.sellingPrice ?? it.buyingPrice,
        supplierId: supplierId || null,
        supplierName: supplierName || null,
        receivedDate: purchaseDate || new Date().toISOString().slice(0, 10),
        receivedBy: profile.uid,
        receivedByName: profile.fullName,
        status: 'ACTIVE',
        createdAt: serverTimestamp()
      });
      tx.set(doc(collection(db, 'stockLedger')), {
        branchId,
        medicineId: it.medicineId,
        medicineName: it.medicineName,
        batchId: batchRef.id,
        batchNumber: it.batchNumber,
        transactionType: 'PURCHASE',
        referenceId: purchaseDocRef.id,
        reference: purchaseRef,
        quantityIn: it.quantity,
        quantityOut: 0,
        unitCost: it.buyingPrice,
        reason: 'Goods received',
        performedBy: profile.uid,
        performedByName: profile.fullName,
        timestamp: serverTimestamp()
      });
    }
    tx.set(purchaseDocRef, {
      ref: purchaseRef,
      branchId, branchName,
      supplierId: supplierId || null,
      supplierName: supplierName || null,
      invoiceNumber: invoiceNumber || null,
      purchaseDate: purchaseDate || new Date().toISOString().slice(0, 10),
      items: items.map((i, k) => ({ ...i, batchId: batchIds[k] })),
      totalCost,
      paymentStatus: 'CREDIT',
      receivedBy: profile.uid,
      receivedByName: profile.fullName,
      createdAt: serverTimestamp()
    });
    tx.set(doc(collection(db, 'financialLedger')), {
      branchId,
      type: 'PURCHASE',
      referenceId: purchaseDocRef.id,
      reference: purchaseRef,
      description: `Purchase from ${supplierName || 'supplier'}`,
      debit: totalCost,
      credit: 0,
      paymentMethod: 'CREDIT',
      performedBy: profile.uid,
      performedByName: profile.fullName,
      timestamp: serverTimestamp()
    });
  });

  await audit(profile, 'STOCK_RECEIPT', { purchaseRef, totalCost, branchId, lines: items.length });
  return { id: purchaseDocRef.id, ref: purchaseRef, totalCost };
}

/* ---------- EXPENSE ---------- */
export async function recordExpense(profile, { branchId, category, description, amount, paymentMethod, reference }) {
  const branch = await getDoc(doc(db, 'branches', branchId));
  const branchName = branch.exists() ? branch.data().name : branchId;
  const seq = await nextCounter('expenses');
  const expenseRef = makeRef('EXP', branchName, seq);
  const docRef = doc(collection(db, 'expenses'));
  await runTransaction(db, async (tx) => {
    tx.set(docRef, {
      ref: expenseRef,
      branchId, branchName,
      category, description,
      amount: Number(amount),
      paymentMethod: paymentMethod || 'CASH',
      reference: reference || null,
      createdBy: profile.uid,
      createdByName: profile.fullName,
      approvedBy: null,
      status: 'RECORDED',
      createdAt: serverTimestamp()
    });
    tx.set(doc(collection(db, 'financialLedger')), {
      branchId,
      type: 'EXPENSE',
      referenceId: docRef.id,
      reference: expenseRef,
      description: `${category} — ${description || ''}`,
      debit: Number(amount),
      credit: 0,
      paymentMethod: paymentMethod || 'CASH',
      performedBy: profile.uid,
      performedByName: profile.fullName,
      timestamp: serverTimestamp()
    });
  });
  await audit(profile, 'EXPENSE', { expenseRef, amount, branchId });
  return { id: docRef.id, ref: expenseRef };
}

/* ---------- STOCK ADJUSTMENT ---------- */
export async function adjustStock(profile, { branchId, batchId, medicineId, medicineName, batchNumber, adjustQty, reason }) {
  // adjustQty: signed. + = increase, - = decrease
  if (!reason) throw new Error('Reason is required');
  const sign = adjustQty >= 0 ? 1 : -1;
  const abs = Math.abs(adjustQty);
  const seq = await nextCounter('adjustments');
  const branch = await getDoc(doc(db, 'branches', branchId));
  const branchName = branch.exists() ? branch.data().name : branchId;
  const ref = makeRef('ADJ', branchName, seq);
  const adjRef = doc(collection(db, 'stockAdjustments'));
  await runTransaction(db, async (tx) => {
    const bRef = doc(db, 'batches', batchId);
    const bs = await tx.get(bRef);
    if (!bs.exists()) throw new Error('Batch not found');
    const remaining = Number(bs.data().quantityRemaining || 0);
    const next = remaining + adjustQty;
    if (next < 0) throw new Error(`Adjustment would make stock negative (current: ${remaining})`);
    tx.update(bRef, { quantityRemaining: next, updatedAt: serverTimestamp() });
    tx.set(adjRef, {
      ref, branchId,
      medicineId, medicineName, batchId, batchNumber,
      adjustQty, reason, performedBy: profile.uid, performedByName: profile.fullName,
      createdAt: serverTimestamp()
    });
    tx.set(doc(collection(db, 'stockLedger')), {
      branchId, medicineId, medicineName, batchId, batchNumber,
      transactionType: 'ADJUSTMENT',
      referenceId: adjRef.id, reference: ref,
      quantityIn: sign > 0 ? abs : 0,
      quantityOut: sign < 0 ? abs : 0,
      reason, performedBy: profile.uid, performedByName: profile.fullName,
      timestamp: serverTimestamp()
    });
  });
  await audit(profile, 'STOCK_ADJUSTMENT', { ref, adjustQty, reason, branchId });
  return { id: adjRef.id, ref };
}