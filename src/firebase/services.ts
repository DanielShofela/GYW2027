import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  query,
  orderBy,
  Unsubscribe,
} from 'firebase/firestore';
import { User, signInWithPopup, signOut } from 'firebase/auth';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { db, auth, storage, googleProvider } from './config';
import { handleFirestoreError, OperationType } from './errors';
import { Registration, EventSettings, RegistrationStatus, LogoAssetReference } from '../types/index';
import { getRegistrationDocId, generateReferenceCode } from '../utils/reference';
import { isAuthorizedAdmin } from '../utils/security';

const ADMIN_EMAIL = 'digitalsoutien@gmail.com';

/**
 * Maximum chunk size in bytes/characters for logo asset segmentation.
 * Kept strictly under 256 KiB to respect the 350 KiB Firestore rule limit
 * and prevent settings/event document from ever exceeding 1 MiB (BUG-02).
 */
export const CHUNK_SIZE = 250 * 1024;

/**
 * Maximum inline logo size stored directly in the settings/event document (400 KiB).
 * SVG logos under this threshold fit safely under Firestore's 1 MiB document limit,
 * ensuring instant cross-device persistence without needing Firebase Storage or subcollections.
 * Larger assets (> 400 KiB up to 2 MiB) are chunked into the subcollection.
 */
export const MAX_INLINE_LOGO_SIZE = 400 * 1024;

const DEFAULT_SETTINGS: EventSettings = {
  location: 'Abidjan, Côte d\'Ivoire (Lieu exact communiqué prochainement)',
  schedules: '1er au 3 janvier 2027 • Accueil à partir de 08h00',
  contactPhone: '+225 07 00 00 00 00',
  whatsappChannelUrl: '',
  registrationsOpen: true,
  closingDate: '31 décembre 2026 à 23h59',
  announcement: 'Les inscriptions sont 100% gratuites. Réservez votre place dès maintenant !',
  logoUrl: '',
  logoUpdatedAt: '',
  headerLogoUrl: '',
  headerLogoUpdatedAt: '',
  updatedAt: new Date().toISOString(),
};

/**
 * Splits a large string (e.g. Base64 SVG data URI) into deterministic chunks.
 */
export function splitIntoChunks(data: string, maxChunkSize = CHUNK_SIZE): string[] {
  if (!data) return [];
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += maxChunkSize) {
    chunks.push(data.slice(i, i + maxChunkSize));
  }
  return chunks;
}

/**
 * Reassembles a chunked SVG logo from Firestore subcollection.
 * Uses browser localStorage cache when available for zero-latency instant rendering.
 */
export async function assembleLogoFromChunks(assetRef?: LogoAssetReference): Promise<string | null> {
  if (!assetRef || !assetRef.assetId || !assetRef.totalChunks) {
    return null;
  }

  const cacheKey = `gyw_asset_${assetRef.assetId}`;
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached && (assetRef.totalSize ? cached.length === assetRef.totalSize : true)) {
        return cached;
      }
    } catch {
      // ignore
    }
  }

  try {
    const chunkPromises = Array.from({ length: assetRef.totalChunks }, (_, idx) =>
      getDoc(doc(db, 'settings', 'event', 'logo_assets', assetRef.assetId, 'chunks', String(idx)))
    );

    const snapshots = await Promise.all(chunkPromises);
    const pieces: string[] = [];

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      if (!snap.exists()) {
        console.warn(`Missing chunk ${i} for asset ${assetRef.assetId}`);
        return null;
      }
      const data = snap.data();
      pieces.push(data?.data || '');
    }

    const reassembled = pieces.join('');
    if (typeof window !== 'undefined' && reassembled) {
      try {
        localStorage.setItem(cacheKey, reassembled);
      } catch {
        // ignore
      }
    }
    return reassembled;
  } catch (err) {
    console.warn(`Failed to reassemble logo asset ${assetRef.assetId} from chunks:`, err);
    return null;
  }
}

/**
 * Persists a large SVG data URI across segmented chunk documents in the Firestore subcollection.
 * Guarantees every chunk document stays under 256 KiB, solving BUG-02.
 */
export async function saveChunkedLogoAsset(
  type: 'main' | 'header',
  dataUri: string,
  callerUser?: User | null
): Promise<LogoAssetReference> {
  const user = callerUser || auth.currentUser;
  const isAuthorized = await verifyIsAdmin(user);
  if (!isAuthorized) {
    throw new Error('NOT_AUTHORIZED');
  }

  const now = new Date().toISOString();
  const assetId = `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const chunks = splitIntoChunks(dataUri, CHUNK_SIZE);

  const writePromises = chunks.map((chunk, index) => {
    const chunkDoc = doc(db, 'settings', 'event', 'logo_assets', assetId, 'chunks', String(index));
    return setDoc(chunkDoc, {
      chunkIndex: index,
      totalChunks: chunks.length,
      data: chunk,
      assetId,
      createdAt: now,
    });
  });

  await Promise.all(writePromises);

  const mimeMatch = dataUri.match(/^data:([^;]+);base64,/);
  const detectedFormat = mimeMatch ? mimeMatch[1] : 'image/svg+xml';

  const assetRef: LogoAssetReference = {
    assetId,
    totalChunks: chunks.length,
    totalSize: dataUri.length,
    format: detectedFormat,
    updatedAt: now,
  };

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`gyw_asset_${assetId}`, dataUri);
    } catch {
      // ignore
    }
  }

  return assetRef;
}

/**
 * Returns locally cached event settings synchronously to eliminate first-load layout shift and flashes.
 * Automatically hydrates chunked logo assets from localStorage cache if available.
 */
export function getInitialCachedSettings(): EventSettings {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('gyw_event_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Hydrate chunked assets from local storage if available
        if (parsed.logoAsset?.assetId && !parsed.logoUrl) {
          const cachedAsset = localStorage.getItem(`gyw_asset_${parsed.logoAsset.assetId}`);
          if (cachedAsset) {
            parsed.logoUrl = cachedAsset;
          }
        }
        if (parsed.headerLogoAsset?.assetId && !parsed.headerLogoUrl) {
          const cachedAsset = localStorage.getItem(`gyw_asset_${parsed.headerLogoAsset.assetId}`);
          if (cachedAsset) {
            parsed.headerLogoUrl = cachedAsset;
          }
        }
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      // ignore
    }
  }
  return DEFAULT_SETTINGS;
}

/**
 * Checks if the currently authenticated user is an authorized administrator.
 * Validates verified email against primary admin and checks Firestore admins/{uid}.
 */
export async function verifyIsAdmin(user: User | null): Promise<boolean> {
  if (!user || !user.email) return false;

  const isGoogleProvider = (user as any).providerData?.some(
    (p: any) => p?.providerId === 'google.com'
  );
  const isVerified =
    (user as any).emailVerified === true ||
    (user as any).email_verified === true ||
    isGoogleProvider === true;

  // 1. Strict primary admin check with verified email
  const check = isAuthorizedAdmin({
    uid: user.uid,
    email: user.email,
    email_verified: isVerified,
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
 * Appends or updates the cache-busting version parameter on a URL,
 * safely preserving existing query parameters (such as Firebase Storage access tokens and alt=media).
 */
export function appendVersionParam(rawUrl: string, timestamp: number): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('v', String(timestamp));
    return url.toString();
  } catch {
    const sep = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${sep}v=${timestamp}`;
  }
}

/**
 * Retrieves global event settings with Firestore persistence and client-side fallback cache.
 * Automatically reassembles chunked logos from Firestore subcollection if needed.
 */
export async function getEventSettings(): Promise<EventSettings> {
  const cached = getInitialCachedSettings();

  try {
    const snapshot = await getDoc(doc(db, 'settings', 'event'));
    if (snapshot.exists()) {
      const firestoreData = snapshot.data() as EventSettings;
      const merged: EventSettings = {
        ...DEFAULT_SETTINGS,
        ...firestoreData,
      };

      // If logoAsset was deleted in Firestore, ensure it's not present in merged
      if (!firestoreData.logoAsset) {
        delete (merged as any).logoAsset;
      }
      if (!firestoreData.headerLogoAsset) {
        delete (merged as any).headerLogoAsset;
      }

      // Reassemble main logo if stored as chunked asset
      if (firestoreData.logoAsset?.assetId) {
        const assembled = await assembleLogoFromChunks(firestoreData.logoAsset);
        if (assembled) {
          merged.logoUrl = assembled;
        }
      }

      // Reassemble header logo if stored as chunked asset
      if (firestoreData.headerLogoAsset?.assetId) {
        const assembled = await assembleLogoFromChunks(firestoreData.headerLogoAsset);
        if (assembled) {
          merged.headerLogoUrl = assembled;
        }
      }

      if (typeof window !== 'undefined') {
        try {
          // Store lightweight settings in localStorage without repeating huge Base64 strings
          const storable: EventSettings = { ...merged };
          if (storable.logoAsset && storable.logoUrl?.startsWith('data:')) {
            storable.logoUrl = '';
          }
          if (storable.headerLogoAsset && storable.headerLogoUrl?.startsWith('data:')) {
            storable.headerLogoUrl = '';
          }
          localStorage.setItem('gyw_event_settings', JSON.stringify(storable));
        } catch {
          // ignore
        }
      }
      return merged;
    }
    return cached;
  } catch (error) {
    console.warn('Could not load settings from server, using cached/defaults:', error);
    return cached;
  }
}

/**
 * Updates event settings (Admin only).
 * Strictly enforces successful Firestore persistence BEFORE updating client cache.
 * ONLY writes legitimate fields explicitly present in newSettings, preventing blind-merge
 * of large Base64 logos from client cache back into the settings/event document (Point 1).
 */
export async function updateEventSettings(
  newSettings: Partial<EventSettings>,
  callerUser?: User | null
): Promise<EventSettings> {
  const path = 'settings/event';
  const user = callerUser || auth.currentUser;
  const isAuthorized = await verifyIsAdmin(user);
  if (!isAuthorized) {
    throw new Error('NOT_AUTHORIZED');
  }

  // 1. Build strict firestorePatch containing ONLY explicitly modified fields
  const firestorePatch: Record<string, any> = {
    updatedAt: new Date().toISOString(),
    updatedBy: user?.email || 'admin',
  };

  const allowedKeys: (keyof EventSettings)[] = [
    'location',
    'schedules',
    'contactPhone',
    'whatsappChannelUrl',
    'registrationsOpen',
    'closingDate',
    'announcement',
    'logoUrl',
    'logoUpdatedAt',
    'headerLogoUrl',
    'headerLogoUpdatedAt',
    'logoAsset',
    'headerLogoAsset',
  ];

  for (const key of allowedKeys) {
    if (key in newSettings) {
      const val = newSettings[key];
      if (val === undefined) continue;

      // Crucial safeguard: Only blank out direct logoUrl if the asset exceeds MAX_INLINE_LOGO_SIZE
      // and is being chunked. SVGs <= MAX_INLINE_LOGO_SIZE can safely be persisted directly in settings/event.
      if (key === 'logoUrl' || key === 'headerLogoUrl') {
        if (typeof val === 'string' && val.length > MAX_INLINE_LOGO_SIZE) {
          firestorePatch[key] = '';
          continue;
        }
      }

      firestorePatch[key] = val;
    }
  }

  const settingsDoc = doc(db, 'settings', 'event');

  try {
    // 2. Strict write to Firestore server
    await setDoc(settingsDoc, firestorePatch, { merge: true });
  } catch (error: any) {
    console.error('Firestore write to settings failed:', error);
    handleFirestoreError(error, OperationType.WRITE, path);
    throw error;
  }

  // 3. Synchronize local cache safely without corrupting JSON with Firestore sentinels
  const existingCache = getInitialCachedSettings();
  const updatedCache: EventSettings = {
    ...existingCache,
    updatedAt: firestorePatch.updatedAt,
    updatedBy: firestorePatch.updatedBy,
  };

  for (const [key, val] of Object.entries(newSettings)) {
    if (val && typeof val === 'object' && (val as any)._methodName === 'deleteField') {
      delete (updatedCache as any)[key];
    } else if (val === null) {
      delete (updatedCache as any)[key];
    } else if (val !== undefined) {
      (updatedCache as any)[key] = val;
    }
  }

  if (typeof window !== 'undefined') {
    try {
      const storableCache: EventSettings = { ...updatedCache };
      if (storableCache.logoAsset && storableCache.logoUrl?.startsWith('data:')) {
        storableCache.logoUrl = '';
      }
      if (storableCache.headerLogoAsset && storableCache.headerLogoUrl?.startsWith('data:')) {
        storableCache.headerLogoUrl = '';
      }
      localStorage.setItem('gyw_event_settings', JSON.stringify(storableCache));
    } catch {
      // ignore
    }
  }

  return updatedCache;
}

/**
 * Updates the official main SVG logo in persistent storage and Firestore settings.
 * Checks server-side authorization and uploads to Firebase Storage with Firestore persistence.
 * If Storage is unavailable or times out, directly writes inline if <= 400 KiB,
 * or segments into subcollection chunk documents (< 256 KiB) if > 400 KiB up to 2 MiB (BUG-02).
 */
export async function updateOfficialLogo(
  sanitizedDataUri: string,
  rawSvgText?: string,
  callerUser?: User | null
): Promise<EventSettings> {
  const user = callerUser || auth.currentUser;
  const isAuthorized = await verifyIsAdmin(user);
  if (!isAuthorized) {
    throw new Error('NOT_AUTHORIZED');
  }

  const now = new Date().toISOString();
  let uploadedHttpsUrl: string | null = null;
  let uploadTimedOut = false;

  // Try Firebase Storage upload with a 2-second timeout to handle CORS / offline smoothly
  try {
    const mimeMatch = sanitizedDataUri.match(/^data:([^;]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : (rawSvgText ? 'image/svg+xml' : 'image/png');
    let ext = 'svg';
    if (mimeType.includes('png')) ext = 'png';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('webp')) ext = 'webp';

    const timestamp = Date.now();
    const storageRef = ref(storage, `logos/official_logo_${timestamp}.${ext}`);
    const contentToUpload = rawSvgText || sanitizedDataUri;

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        uploadTimedOut = true;
        resolve(null);
      }, 2000);
    });

    const uploadAttempt = (async () => {
      try {
        await uploadString(
          storageRef,
          contentToUpload,
          rawSvgText ? 'raw' : 'data_url',
          {
            contentType: mimeType,
            cacheControl: 'public, max-age=31536000',
          }
        );
        if (uploadTimedOut) return null;
        const downloadUrl = await getDownloadURL(storageRef);
        if (uploadTimedOut) return null;
        return downloadUrl ? appendVersionParam(downloadUrl, timestamp) : null;
      } catch {
        return null;
      }
    })();

    uploadedHttpsUrl = await Promise.race([uploadAttempt, timeoutPromise]);
  } catch (storageError) {
    console.warn(
      'Cloud storage unavailable or timed out; falling back to direct Firestore storage or chunks:',
      storageError
    );
  }

  // Clear previous chunked asset cache if exists
  const prevSettings = getInitialCachedSettings();
  if (prevSettings.logoAsset?.assetId && typeof window !== 'undefined') {
    try {
      localStorage.removeItem(`gyw_asset_${prevSettings.logoAsset.assetId}`);
    } catch {
      // ignore
    }
  }

  if (uploadedHttpsUrl) {
    // 1. Storage succeeded: store direct URL in settings/event and clear chunk asset reference
    return await updateEventSettings(
      {
        logoUrl: uploadedHttpsUrl,
        logoAsset: deleteField() as any,
        logoUpdatedAt: now,
      },
      user
    );
  } else if (sanitizedDataUri.length <= MAX_INLINE_LOGO_SIZE) {
    // 2. Direct inline Firestore storage: SVG <= 400 KiB easily fits in settings/event (< 1 MiB limit)
    return await updateEventSettings(
      {
        logoUrl: sanitizedDataUri,
        logoAsset: deleteField() as any,
        logoUpdatedAt: now,
      },
      user
    );
  } else {
    // 3. Fallback for very large SVG (> 400 KiB): save chunks in subcollection settings/event/logo_assets/{id}/chunks/{idx}
    const assetRef = await saveChunkedLogoAsset('main', sanitizedDataUri, user);
    const updated = await updateEventSettings(
      {
        logoUrl: '',
        logoAsset: assetRef,
        logoUpdatedAt: now,
      },
      user
    );

    // Hydrate local cache with the full data URI for immediate instant rendering
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`gyw_asset_${assetRef.assetId}`, sanitizedDataUri);
      } catch {
        // ignore
      }
    }
    return {
      ...updated,
      logoUrl: sanitizedDataUri,
    };
  }
}

/**
 * Removes the official main logo from persistent settings.
 */
export async function removeOfficialLogo(callerUser?: User | null): Promise<EventSettings> {
  const user = callerUser || auth.currentUser;
  const isAuthorized = await verifyIsAdmin(user);
  if (!isAuthorized) {
    throw new Error('NOT_AUTHORIZED');
  }

  const prevSettings = getInitialCachedSettings();
  if (prevSettings.logoAsset?.assetId && typeof window !== 'undefined') {
    try {
      localStorage.removeItem(`gyw_asset_${prevSettings.logoAsset.assetId}`);
    } catch {
      // ignore
    }
  }

  const now = new Date().toISOString();
  const updated = await updateEventSettings(
    {
      logoUrl: '',
      logoAsset: deleteField() as any,
      logoUpdatedAt: now,
    },
    user
  );

  return {
    ...updated,
    logoUrl: '',
    logoAsset: undefined,
  };
}

/**
 * Updates the official header SVG logo in persistent storage and Firestore settings.
 * Uses Storage if available, with direct inline (< 400 KiB) or subcollection chunk documents as fallback.
 */
export async function updateHeaderLogo(
  sanitizedDataUri: string,
  rawSvgText?: string,
  callerUser?: User | null
): Promise<EventSettings> {
  const user = callerUser || auth.currentUser;
  const isAuthorized = await verifyIsAdmin(user);
  if (!isAuthorized) {
    throw new Error('NOT_AUTHORIZED');
  }

  const now = new Date().toISOString();
  let uploadedHttpsUrl: string | null = null;
  let uploadTimedOut = false;

  try {
    const mimeMatch = sanitizedDataUri.match(/^data:([^;]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : (rawSvgText ? 'image/svg+xml' : 'image/png');
    let ext = 'svg';
    if (mimeType.includes('png')) ext = 'png';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('webp')) ext = 'webp';

    const timestamp = Date.now();
    const storageRef = ref(storage, `logos/header_logo_${timestamp}.${ext}`);
    const contentToUpload = rawSvgText || sanitizedDataUri;

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        uploadTimedOut = true;
        resolve(null);
      }, 2000);
    });

    const uploadAttempt = (async () => {
      try {
        await uploadString(
          storageRef,
          contentToUpload,
          rawSvgText ? 'raw' : 'data_url',
          {
            contentType: mimeType,
            cacheControl: 'public, max-age=31536000',
          }
        );
        if (uploadTimedOut) return null;
        const downloadUrl = await getDownloadURL(storageRef);
        if (uploadTimedOut) return null;
        return downloadUrl ? appendVersionParam(downloadUrl, timestamp) : null;
      } catch {
        return null;
      }
    })();

    uploadedHttpsUrl = await Promise.race([uploadAttempt, timeoutPromise]);
  } catch (storageError) {
    console.warn(
      'Storage fallback for header logo, direct Firestore storage or chunks:',
      storageError
    );
  }

  const prevSettings = getInitialCachedSettings();
  if (prevSettings.headerLogoAsset?.assetId && typeof window !== 'undefined') {
    try {
      localStorage.removeItem(`gyw_asset_${prevSettings.headerLogoAsset.assetId}`);
    } catch {
      // ignore
    }
  }

  if (uploadedHttpsUrl) {
    return await updateEventSettings(
      {
        headerLogoUrl: uploadedHttpsUrl,
        headerLogoAsset: deleteField() as any,
        headerLogoUpdatedAt: now,
      },
      user
    );
  } else if (sanitizedDataUri.length <= MAX_INLINE_LOGO_SIZE) {
    return await updateEventSettings(
      {
        headerLogoUrl: sanitizedDataUri,
        headerLogoAsset: deleteField() as any,
        headerLogoUpdatedAt: now,
      },
      user
    );
  } else {
    const assetRef = await saveChunkedLogoAsset('header', sanitizedDataUri, user);
    const updated = await updateEventSettings(
      {
        headerLogoUrl: '',
        headerLogoAsset: assetRef,
        headerLogoUpdatedAt: now,
      },
      user
    );

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`gyw_asset_${assetRef.assetId}`, sanitizedDataUri);
      } catch {
        // ignore
      }
    }
    return {
      ...updated,
      headerLogoUrl: sanitizedDataUri,
    };
  }
}

/**
 * Removes the header logo from persistent settings (falls back to GYW default emblem).
 */
export async function removeHeaderLogo(callerUser?: User | null): Promise<EventSettings> {
  const user = callerUser || auth.currentUser;
  const isAuthorized = await verifyIsAdmin(user);
  if (!isAuthorized) {
    throw new Error('NOT_AUTHORIZED');
  }

  const prevSettings = getInitialCachedSettings();
  if (prevSettings.headerLogoAsset?.assetId && typeof window !== 'undefined') {
    try {
      localStorage.removeItem(`gyw_asset_${prevSettings.headerLogoAsset.assetId}`);
    } catch {
      // ignore
    }
  }

  const now = new Date().toISOString();
  const updated = await updateEventSettings(
    {
      headerLogoUrl: '',
      headerLogoAsset: deleteField() as any,
      headerLogoUpdatedAt: now,
    },
    user
  );

  return {
    ...updated,
    headerLogoUrl: '',
    headerLogoAsset: undefined,
  };
}

/**
 * Clones the active main logo to be used as the header logo.
 */
export async function useMainLogoAsHeaderLogo(callerUser?: User | null): Promise<EventSettings> {
  const user = callerUser || auth.currentUser;
  const isAuthorized = await verifyIsAdmin(user);
  if (!isAuthorized) {
    throw new Error('NOT_AUTHORIZED');
  }

  const currentSettings = getInitialCachedSettings();
  let mainUrl = currentSettings.logoUrl || '';
  if (!mainUrl && currentSettings.logoAsset?.assetId && typeof window !== 'undefined') {
    mainUrl = localStorage.getItem(`gyw_asset_${currentSettings.logoAsset.assetId}`) || '';
  }

  if (!mainUrl && !currentSettings.logoAsset) {
    throw new Error('NO_MAIN_LOGO');
  }

  const now = new Date().toISOString();

  if (currentSettings.logoAsset) {
    const clonedAsset: LogoAssetReference = {
      ...currentSettings.logoAsset,
      updatedAt: now,
    };
    if (mainUrl && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`gyw_asset_${clonedAsset.assetId}`, mainUrl);
      } catch {
        // ignore
      }
    }
    const updated = await updateEventSettings(
      {
        headerLogoUrl: '',
        headerLogoAsset: clonedAsset,
        headerLogoUpdatedAt: now,
      },
      user
    );
    return {
      ...updated,
      headerLogoUrl: mainUrl,
    };
  } else {
    return await updateEventSettings(
      {
        headerLogoUrl: mainUrl,
        headerLogoAsset: deleteField() as any,
        headerLogoUpdatedAt: now,
      },
      user
    );
  }
}

/**
 * Submits a new registration with strict anti-duplicate validation and differentiated error diagnostics.
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

  // 1. Verify if registrations are open
  const settings = await getEventSettings();
  if (!settings.registrationsOpen) {
    throw new Error('REGISTRATIONS_CLOSED');
  }

  // 2. Pre-validate fields matching Firestore rule requirements
  const trimmedFirst = payload.firstName.trim();
  const trimmedLast = payload.lastName.trim();
  const trimmedCity = payload.city.trim();
  const trimmedChurch = payload.church?.trim() || '';

  if (trimmedFirst.length < 2 || trimmedFirst.length > 80) {
    throw new Error('INVALID_FIRSTNAME');
  }
  if (trimmedLast.length < 2 || trimmedLast.length > 80) {
    throw new Error('INVALID_LASTNAME');
  }
  if (trimmedCity.length < 2 || trimmedCity.length > 100) {
    throw new Error('INVALID_CITY');
  }
  if (trimmedChurch.length > 120) {
    throw new Error('INVALID_CHURCH');
  }
  if (!payload.attendanceDays || payload.attendanceDays.length < 1 || payload.attendanceDays.length > 3) {
    throw new Error('INVALID_DAYS');
  }
  if (!payload.consentAccepted) {
    throw new Error('CONSENT_REQUIRED');
  }

  // 3. Check if document already exists to prevent duplicate WhatsApp registrations
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
    // If permission error reading doc directly as unauthenticated public, proceed to atomic create
  }

  const referenceCode = generateReferenceCode();
  const now = new Date().toISOString();

  const record: Registration = {
    id: docId,
    firstName: trimmedFirst,
    lastName: trimmedLast,
    whatsappPhone: payload.whatsappPhone.trim(),
    normalizedPhone: payload.normalizedPhone,
    city: trimmedCity,
    church: trimmedChurch,
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
    const errCode = error?.code || '';
    const errMsg = String(error?.message || '').toLowerCase();

    // 4. Distinguish network errors
    if (
      errCode === 'unavailable' ||
      errCode === 'deadline-exceeded' ||
      errMsg.includes('network') ||
      errMsg.includes('offline')
    ) {
      throw new Error('NETWORK_ERROR');
    }

    // 5. Distinguish permission-denied without falsely claiming duplicate
    if (errCode === 'permission-denied' || errMsg.includes('permission-denied')) {
      // Re-verify if registrations were closed on server
      try {
        const freshSettings = await getDoc(doc(db, 'settings', 'event'));
        if (freshSettings.exists() && freshSettings.data()?.registrationsOpen === false) {
          throw new Error('REGISTRATIONS_CLOSED');
        }
      } catch (checkErr: any) {
        if (checkErr.message === 'REGISTRATIONS_CLOSED') throw checkErr;
      }

      // Neutral, non-misleading rejection
      throw new Error('SUBMISSION_REJECTED');
    }

    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
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
