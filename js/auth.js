import { auth, db, onAuthStateChanged, doc, getDoc, setDoc, serverTimestamp, runTransaction }
  from './firebase.js';

let _user = null;
let _profile = null;
const listeners = new Set();
let _readyResolve;
export const authReady = new Promise(r => { _readyResolve = r; });

export function currentUser() { return _user; }
export function currentProfile() { return _profile; }

export function onUser(fn) {
  listeners.add(fn);
  if (_profile || _user === false) fn(_profile);
  return () => listeners.delete(fn);
}

function emit() { for (const fn of listeners) { try { fn(_profile); } catch (e) { console.error(e); } } }

onAuthStateChanged(auth, async (u) => {
  _user = u;
  if (!u) {
    _profile = null;
    emit();
    _readyResolve();
    return;
  }
  try {
    _profile = await ensureProfile(u);
  } catch (e) {
    console.error('Profile load failed', e);
    _profile = null;
  }
  emit();
  _readyResolve();
});

async function ensureProfile(u) {
  const ref = doc(db, 'users', u.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await setDoc(ref, { lastLogin: serverTimestamp() }, { merge: true });
    return { uid: u.uid, ...snap.data() };
  }
  // First-run bootstrap: if settings/bootstrap doesn't exist, this user becomes SUPER_ADMIN.
  let isFirst = false;
  try {
    await runTransaction(db, async (tx) => {
      const bs = await tx.get(doc(db, 'settings', 'bootstrap'));
      if (!bs.exists()) {
        tx.set(doc(db, 'settings', 'bootstrap'), { createdAt: serverTimestamp(), ownerUid: u.uid });
        isFirst = true;
      }
    });
  } catch (e) { console.error('bootstrap check failed', e); }

  const profile = {
    fullName: u.displayName || u.email?.split('@')[0] || 'User',
    email: u.email || '',
    phone: '',
    role: isFirst ? 'SUPER_ADMIN' : 'VIEWER',
    branchId: isFirst ? null : null,
    active: isFirst,
    createdAt: serverTimestamp(),
    lastLogin: serverTimestamp()
  };
  await setDoc(ref, profile);
  return { uid: u.uid, ...profile };
}

export async function requireAuth() {
  await authReady;
  if (!_user) { location.replace('login.html'); throw new Error('not authed'); }
  if (!_profile) throw new Error('Profile missing');
  if (_profile.active === false) {
    alert('Your account is pending activation. Please contact an administrator.');
    location.replace('login.html');
    throw new Error('inactive');
  }
  return _profile;
}