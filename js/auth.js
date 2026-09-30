/* ============================================================
   BIGZA CLINICS — Authentication & Profile Module
   ------------------------------------------------------------
   Responsibilities:
   - Track Firebase Auth state
   - Load / bootstrap the user's profile from users/{uid}
   - Support first-run SUPER_ADMIN bootstrap (settings/bootstrap)
   - Support pre-authorised staff invites (userInvites/{email})
   - Expose currentUser / currentProfile / requireAuth
   - Emit profile changes to subscribers (shell / nav)
   ============================================================ */

import {
  auth, db,
  onAuthStateChanged,
  doc, getDoc, setDoc, deleteDoc, runTransaction, serverTimestamp
} from './firebase.js';

/* ---------- Module state ---------- */
let _user = null;               // Firebase Auth user or null
let _profile = null;            // Firestore profile (with uid merged) or null
let _initialised = false;       // true once the first snapshot has resolved
const listeners = new Set();    // onUser subscribers

/* authReady resolves after the first onAuthStateChanged tick finishes
   loading (or failing to load) the profile. Shell code awaits this. */
let _readyResolve;
export const authReady = new Promise(r => { _readyResolve = r; });

/* ---------- Public accessors ---------- */
export function currentUser() { return _user; }
export function currentProfile() { return _profile; }
export function isReady() { return _initialised; }

/* Subscribe to profile changes. Fires immediately if we already have
   a resolved state (profile OR null-after-ready). Returns unsubscribe. */
export function onUser(fn) {
  listeners.add(fn);
  if (_initialised) {
    try { fn(_profile); } catch (e) { console.error('[auth.onUser]', e); }
  }
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try { fn(_profile); } catch (e) { console.error('[auth.onUser]', e); }
  }
}

/* ---------- Firebase Auth wiring ---------- */
onAuthStateChanged(auth, async (u) => {
  _user = u;

  if (!u) {
    _profile = null;
    finishReady();
    return;
  }

  try {
    _profile = await ensureProfile(u);
  } catch (err) {
    console.error('[auth] profile load failed:', err);
    _profile = null;
  }
  finishReady();
});

function finishReady() {
  emit();
  if (!_initialised) {
    _initialised = true;
    _readyResolve();
  }
}

/* ============================================================
   Profile loading / creation
   ------------------------------------------------------------
   Priority of truth:
   1. If users/{uid} exists → use it (update lastLogin).
   2. Else if a userInvites/{email} exists → consume it, create profile.
   3. Else if settings/bootstrap doesn't exist → this user becomes
      SUPER_ADMIN and creates the bootstrap marker.
   4. Else → create a disabled VIEWER with no branch. Admin must
      activate them from the Staff page.
   ============================================================ */
async function ensureProfile(u) {
  const userRef = doc(db, 'users', u.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const data = snap.data();
    /* Never let a disabled account through. We still return the
       profile so the caller can decide; requireAuth() blocks shell. */
    try {
      await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.warn('[auth] lastLogin update failed:', e);
    }
    return { uid: u.uid, ...data, lastLogin: new Date() };
  }

  /* --- First-run SUPER_ADMIN bootstrap --- */
  let claimedBootstrap = false;
  try {
    await runTransaction(db, async (tx) => {
      const bsRef = doc(db, 'settings', 'bootstrap');
      const bs = await tx.get(bsRef);
      if (!bs.exists()) {
        tx.set(bsRef, {
          createdAt: serverTimestamp(),
          ownerUid: u.uid,
          ownerEmail: u.email || null
        });
        claimedBootstrap = true;
      }
    });
  } catch (e) {
    console.error('[auth] bootstrap transaction failed:', e);
    /* Non-fatal: fall through. If this races, we simply become a VIEWER
       and an admin will activate the account. */
  }

  /* --- Pre-authorised invite --- */
  const emailKey = (u.email || '').trim().toLowerCase();
  let invite = null;
  if (emailKey) {
    try {
      const inv = await getDoc(doc(db, 'userInvites', emailKey));
      if (inv.exists()) invite = { id: inv.id, ...inv.data() };
    } catch (e) {
      /* likely rules rejection while unauthenticated-as-staff; ignore */
      console.warn('[auth] invite lookup failed:', e);
    }
  }

  /* --- Decide the profile --- */
  const now = serverTimestamp();
  let profile;

  if (claimedBootstrap) {
    profile = {
      fullName: u.displayName || (u.email || 'Administrator').split('@')[0],
      email: u.email || '',
      phone: '',
      role: 'SUPER_ADMIN',
      branchId: null,
      active: true,
      createdAt: now,
      lastLogin: now,
      bootstrapOwner: true
    };
  } else if (invite) {
    profile = {
      fullName: invite.fullName || u.displayName || (u.email || 'User').split('@')[0],
      email: u.email || '',
      phone: invite.phone || '',
      role: invite.role || 'VIEWER',
      branchId: invite.branchId || null,
      active: true,
      createdAt: now,
      lastLogin: now,
      invitedBy: invite.invitedBy || null,
      invitedAt: invite.invitedAt || null
    };
  } else {
    profile = {
      fullName: u.displayName || (u.email || 'User').split('@')[0],
      email: u.email || '',
      phone: '',
      role: 'VIEWER',
      branchId: null,
      active: false,             // requires admin activation
      createdAt: now,
      lastLogin: now
    };
  }

  /* Write the profile. */
  try {
    await setDoc(userRef, profile);
  } catch (e) {
    console.error('[auth] profile write failed:', e);
    throw e;
  }

  /* Consume the invite only after we've safely persisted the profile. */
  if (invite && emailKey) {
    try { await deleteDoc(doc(db, 'userInvites', emailKey)); }
    catch (e) { console.warn('[auth] invite cleanup failed:', e); }
  }

  return { uid: u.uid, ...profile, lastLogin: new Date() };
}

/* ============================================================
   Route guard
   ------------------------------------------------------------
   - Waits for the first auth snapshot.
   - Redirects to login.html if there is no Firebase user.
   - Redirects to login.html if the profile is missing or inactive.
   - Returns the profile on success.
   ============================================================ */
export async function requireAuth() {
  await authReady;

  if (!_user) {
    safeRedirect('login.html');
    throw new Error('not-authenticated');
  }

  if (!_profile) {
    /* Firebase says we're signed in, but we couldn't load a profile.
       Most likely the rules rejected the read. Force re-login. */
    try { await auth.signOut(); } catch (e) { /* noop */ }
    safeRedirect('login.html');
    throw new Error('profile-missing');
  }

  if (_profile.active === false) {
    try { await auth.signOut(); } catch (e) { /* noop */ }
    alert('Your account is not active yet. Please contact a BIGZA Clinics administrator.');
    safeRedirect('login.html');
    throw new Error('account-inactive');
  }

  return _profile;
}

/* ============================================================
   Optional helpers used by other modules
   ============================================================ */

/* True for SUPER_ADMIN and ADMIN — these roles are not branch-scoped. */
export function isGlobalRole() {
  const r = _profile?.role;
  return r === 'SUPER_ADMIN' || r === 'ADMIN';
}

/* Return the branch id to scope a query to, or null for "all branches".
   Global roles pass null; everyone else gets their own branch. */
export function effectiveBranchId() {
  if (!_profile) return null;
  if (isGlobalRole()) return null;
  return _profile.branchId || null;
}

function safeRedirect(url) {
  /* Preserve the original target so we can bounce back after login
     if the caller sets ?next= on the login page. */
  try {
    const here = location.pathname.split('/').pop() || '';
    if (here && here !== 'login.html' && here !== 'index.html') {
      sessionStorage.setItem('bigza.next', here + location.search);
    }
  } catch (e) { /* noop */ }
  location.replace(url);
}