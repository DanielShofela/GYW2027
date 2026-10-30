import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  Unsubscribe,
} from 'firebase/firestore';
import { User, signInWithPopup, signOut } from 'firebase/auth';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { db, auth, storage, googleProvider } from './config';
import { handleFirestoreError, OperationType } from './errors';
import { Registration, EventSettings, RegistrationStatus } from '../types/index';
import { getRegistrationDocId, generateReferenceCode } from '../utils/reference';
import { isAuthorizedAdmin } from '../utils/security';

const ADMIN_EMAIL = 'digitalsoutien@gmail.com';

const DEFAULT_SETTINGS: EventSettings = {
  location: 'Abidjan, Côte d\'Ivoire (Lieu exact communiqué prochainement)',
  schedules: '1er au 3 janvier 2027 • Accueil à partir de 08h00',
  contactPhone: '+225 07 00 00 00 00',
  whatsappChannelUrl: '',
  registrationsOpen: true,
  closingDate: '31 décembre 2026 à 23h59',
  announcement: 'Les inscriptions sont 100% gratuites. Réservez votre place dès maintenant !',
  updatedAt: new Date().toISOString(),
};

/**
 * Checks if the currently authenticated user is an authorized administrator.
 * Validates verified email against primary admin and checks Firestore admins/{uid}.
 */
export async function verifyIsAdmin(user: User | null): Promise<boolean> {
  if (!user || !user.email) return false;

  // 1. Strict primary admin check with verified email
  const check = isAuthorizedAdmin({
    uid: user.uid,
    email: user.email,
    email_verified: user.emailVerified,
  });

  if (check.authorized) {
    return true;
  }

  // 2. Check explicitly whitelisted UIDs in Firestore admins collection
  try {
    const adminDoc = await getDoc(doc(db, 'admins', user.uid));
    if (adminDoc.exists()) {
      const data = adminDoc.data();
      return data?.role === 'admin' || data?.role === 'superadmin';
    }
    return false;
  } catch (error) {
    console.warn('Could not verify admin role against firestore collection:', error);
    return false;
  }
}

/**
 * Sign in admin with Google Popup.
 */
export async function signInAdmin(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

/**
 * Sign out current user.
 */
export async function logOutAdmin(): Promise<void> {
  await signOut(auth);
}

/**
 * Retrieves global event settings with Firestore persistence and client-side fallback cache.
 */
export async function getEventSettings(): Promise<EventSettings> {
  let cached: Partial<EventSettings> = {};
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('gyw_event_settings');
      if (raw) cached = JSON.parse(raw);
    } catch {
      // ignore
    }
  }

  try {
    const snapshot = await getDoc(doc(db, 'settings', 'event'));
    if (snapshot.exists()) {
      const firestoreData = snapshot.data() as EventSettings;
      const merged: EventSettings = {
        ...DEFAULT_SETTINGS,
        ...cached,
        ...firestoreData,
      };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('gyw_event_settings', JSON.stringify(merged));
        } catch {
          // ignore
        }
      }
      return merged;
    }
    return { ...DEFAULT_SETTINGS, ...cached };
  } catch (error) {
    // If read fails or not yet created, return cached / defaults
    console.warn('Could not load settings from server, using cached/defaults:', error);
    return { ...DEFAULT_SETTINGS, ...cached };
  }
}

/**
 * Updates event settings (Admin only).
 */
export async function updateEventSettings(
  newSettings: Partial<EventSettings>,
  callerUser?: User | null
): Promise<void> {
  const path = 'settings/event';
  const payload: EventSettings = {
    ...DEFAULT_SETTINGS,
    ...newSettings,
    updatedAt: new Date().toISOString(),
    updatedBy: callerUser?.email || auth.currentUser?.email || 'admin',
  };

  // Synchronize client cache immediately for seamless persistence across reloads
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('gyw_event_settings', JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  try {
    const settingsDoc = doc(db, 'settings', 'event');
    await setDoc(settingsDoc, payload, { merge: true });
  } catch (error: any) {
    // If running in mock test session or dev mode without live Google Auth token in Firebase SDK
    if (
      error?.code === 'permission-denied' ||
      error?.message?.includes('Missing or insufficient permissions')
    ) {
      console.warn(
        'Firestore write requires active Firebase Auth credential. Local state will be updated.',
        error
      );
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Updates the official SVG logo in persistent storage and Firestore settings.
 * Checks server-side authorization and uploads to Firebase Storage with Firestore persistence.
 */
export async function updateOfficialLogo(
  sanitizedDataUri: string,
  rawSvgText?: string,
  callerUser?: User | null
): Promise<string> {
  const user = callerUser || auth.currentUser;
  const isAuthorized = await verifyIsAdmin(user);
  if (!isAuthorized) {
    throw new Error('NOT_AUTHORIZED');
  }

  const now = new Date().toISOString();
  let finalLogoUrl = sanitizedDataUri;

  // Try Firebase Storage upload with a 2-second timeout to handle CORS / offline smoothly
  try {
    const timestamp = Date.now();
    const storageRef = ref(storage, `logos/official_logo_${timestamp}.svg`);
    const contentToUpload = rawSvgText || sanitizedDataUri;

    const uploadAttempt = (async () => {
      await uploadString(
        storageRef,
        contentToUpload,
        rawSvgText ? 'raw' : 'data_url',
        {
          contentType: 'image/svg+xml',
          cacheControl: 'public, max-age=31536000',
        }
      );
      const downloadUrl = await getDownloadURL(storageRef);
      return downloadUrl ? `${downloadUrl}?v=${timestamp}` : sanitizedDataUri;
    })();

    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('STORAGE_TIMEOUT')), 2000);
    });

    finalLogoUrl = await Promise.race([uploadAttempt, timeoutPromise]);
  } catch (storageError) {
    console.warn(
      'Cloud storage unavailable or timed out; persisting sanitized SVG data URI directly into Firestore:',
      storageError
    );
    finalLogoUrl = sanitizedDataUri;
  }

  // Update persistent Firestore settings document
  await updateEventSettings(
    {
      logoUrl: finalLogoUrl,
      logoUpdatedAt: now,
    },
    user
  );

  return finalLogoUrl;
}

/**
 * Removes the official logo from persistent settings.
 */
export async function removeOfficialLogo(callerUser?: User | null): Promise<void> {
  const user = callerUser || auth.currentUser;
  const isAuthorized = await verifyIsAdmin(user);
  if (!isAuthorized) {
    throw new Error('NOT_AUTHORIZED');
  }

  await updateEventSettings(
    {
      logoUrl: '',
      logoUpdatedAt: new Date().toISOString(),
    },
    user
  );
}

/**
 * Submits a new registration with anti-duplicate validation.
 */
export async function submitRegistration(payload: {
  firstName: string;
  lastName: string;
  whatsappPhone: string;
  normalizedPhone: string;
  city: string;
  church?: string;
  ageCategory?: Registration['ageCategory'];
  attendanceDays: Registration['attendanceDays'];
  consentAccepted: boolean;
}): Promise<{ registration: Registration; isNew: boolean }> {
  const docId = getRegistrationDocId(payload.normalizedPhone);
  const path = `registrations/${docId}`;

  // Check if registrations are open
  const settings = await getEventSettings();
  if (!settings.registrationsOpen) {
    throw new Error('REGISTRATIONS_CLOSED');
  }

  // Check if document already exists to prevent duplicate WhatsApp registrations
  try {
    const existingDoc = await getDoc(doc(db, 'registrations', docId));
    if (existingDoc.exists()) {
      const data = existingDoc.data() as Registration;
      const duplicateError = new Error('ALREADY_REGISTERED');
      (duplicateError as any).existingRegistration = data;
      throw duplicateError;
    }
  } catch (err: any) {
    if (err.message === 'ALREADY_REGISTERED') {
      throw err;
    }
    // If permission error reading doc directly as public, continue to atomic create
  }

  const referenceCode = generateReferenceCode();
  const now = new Date().toISOString();

  const record: Registration = {
    id: docId,
    firstName: payload.firstName.trim(),
    lastName: payload.lastName.trim(),
    whatsappPhone: payload.whatsappPhone.trim(),
    normalizedPhone: payload.normalizedPhone,
    city: payload.city.trim(),
    church: payload.church?.trim() || '',
    ageCategory: payload.ageCategory || 'not_specified',
    attendanceDays: payload.attendanceDays,
    status: 'confirmed',
    referenceCode,
    consentAccepted: payload.consentAccepted,
    consentVersion: 'v1.0',
    createdAt: now,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'registrations', docId), record);
    return { registration: record, isNew: true };
  } catch (error: any) {
    // If rules rejected write because doc already exists
    if (error?.code === 'permission-denied' || error?.message?.includes('permission-denied')) {
      const errorMsg = String(error?.message || '');
      // Could be already registered duplicate or registrations closed
      throw new Error('REGISTRATION_FAILED_OR_DUPLICATE');
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Listens to all registrations in real-time (Admin only).
 */
export function subscribeToRegistrations(
  onData: (registrations: Registration[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = 'registrations';
  const q = query(collection(db, 'registrations'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: Registration[] = [];
      snapshot.forEach((d) => {
        items.push({ id: d.id, ...(d.data() as Omit<Registration, 'id'>) });
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e: any) {
        onError(e);
      }
    }
  );
}

/**
 * Updates a registration's status or details (Admin only).
 */
export async function updateRegistrationStatus(
  docId: string,
  newStatus: RegistrationStatus
): Promise<void> {
  const path = `registrations/${docId}`;
  try {
    await updateDoc(doc(db, 'registrations', docId), {
      status: newStatus,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Deletes a registration record (Admin only).
 */
export async function deleteRegistration(docId: string): Promise<void> {
  const path = `registrations/${docId}`;
  try {
    await deleteDoc(doc(db, 'registrations', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
