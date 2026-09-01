import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { JournalEntry, UserProfile } from '../types';

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize Auth & Firestore
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || undefined);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

/**
 * Strict Undefined-Stripping (Zero-Crash Payload Hygiene)
 * Eliminates all undefined or invalid values before passing payloads to Firestore SDK.
 */
export function stripUndefined<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) => (value === undefined ? null : value))
  );
}

/**
 * Authentication Methods
 */
export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function logOut(): Promise<void> {
  await signOut(auth);
}

export function subscribeToAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

/**
 * User Profile & Database Sync
 */
export async function syncUserProfile(user: User): Promise<void> {
  try {
    const userRef = doc(db, 'users', user.uid);
    const profileData = stripUndefined({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      lastLoginAt: new Date().toISOString(),
    });
    await setDoc(userRef, profileData, { merge: true });
  } catch (error) {
    console.error('Failed to sync user profile:', error);
  }
}

/**
 * Journal Operations (Strict User Isolation: users/{userId}/entries/{entryId})
 */
export async function fetchUserEntries(userId: string): Promise<JournalEntry[]> {
  try {
    const entriesRef = collection(db, 'users', userId, 'entries');
    const q = query(entriesRef, orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);
    
    const entries: JournalEntry[] = [];
    snapshot.forEach((docSnapshot) => {
      entries.push(docSnapshot.data() as JournalEntry);
    });
    return entries;
  } catch (error) {
    console.error('Error fetching user entries from Firestore:', error);
    throw error;
  }
}

export async function saveUserEntry(userId: string, entry: JournalEntry): Promise<void> {
  try {
    const entryRef = doc(db, 'users', userId, 'entries', entry.id);
    const sanitized = stripUndefined({
      ...entry,
      userId,
      updatedAt: new Date().toISOString(),
    });
    await setDoc(entryRef, sanitized, { merge: true });
  } catch (error) {
    console.error(`Failed to save entry ${entry.id} to Firestore:`, error);
    throw error;
  }
}

export async function deleteUserEntry(userId: string, entryId: string): Promise<void> {
  try {
    const entryRef = doc(db, 'users', userId, 'entries', entryId);
    await deleteDoc(entryRef);
  } catch (error) {
    console.error(`Failed to delete entry ${entryId} from Firestore:`, error);
    throw error;
  }
}
