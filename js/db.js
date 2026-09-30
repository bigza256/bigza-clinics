import { db, collection, doc, getDoc, getDocs, query, where, orderBy, limit,
  startAfter, addDoc, setDoc, updateDoc, serverTimestamp } from './firebase.js';

export async function listDocs(coll, { where: whereArr = [], order, dir = 'desc', max = 100, start } = {}) {
  const parts = [collection(db, coll)];
  for (const w of whereArr) parts.push(where(w[0], w[1], w[2]));
  if (order) parts.push(orderBy(order, dir));
  parts.push(limit(max));
  if (start) parts.push(startAfter(start));
  const snap = await getDocs(query(...parts));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getOne(coll, id) {
  const s = await getDoc(doc(db, coll, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function addDocAuto(coll, data) {
  const ref = await addDoc(collection(db, coll), { ...data, createdAt: serverTimestamp() });
  return ref.id;
}

export async function update(coll, id, data) {
  await updateDoc(doc(db, coll, id), { ...data, updatedAt: serverTimestamp() });
}

export async function setDocAuto(coll, id, data) {
  await setDoc(doc(db, coll, id), data, { merge: true });
}

export function subscribeBranchScope(profile) {
  const scope = { where: [] };
  if (profile && profile.role !== 'SUPER_ADMIN' && profile.role !== 'ADMIN' && profile.branchId) {
    scope.where.push(['branchId', '==', profile.branchId]);
  }
  return scope;
}

/* Counter helper (transactional). Path: counters/{name} { value } */
import { runTransaction } from './firebase.js';
export async function nextCounter(name) {
  const ref = doc(db, 'counters', name);
  let value = 0;
  await runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    value = (s.exists() ? s.data().value : 0) + 1;
    tx.set(ref, { value }, { merge: true });
  });
  return value;
}