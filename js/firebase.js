import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, collection, addDoc, setDoc, getDoc, getDocs, updateDoc,
  deleteDoc, query, where, orderBy, limit, startAfter, serverTimestamp,
  runTransaction, writeBatch, onSnapshot, increment, Timestamp, FieldValue
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBUck_mmEdRpxw5bcu9i3Fp0NIyIXzbFQ0",
  authDomain: "bigza-clinics.firebaseapp.com",
  projectId: "bigza-clinics",
  storageBucket: "bigza-clinics.firebasestorage.app",
  messagingSenderId: "296734576255",
  appId: "1:296734576255:web:2d6c38f3647092057a794a",
  measurementId: "G-CW5JPY37SF"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  doc, collection, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, serverTimestamp, runTransaction,
  writeBatch, onSnapshot, increment, Timestamp, FieldValue
};