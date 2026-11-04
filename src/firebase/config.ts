import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Initialize Firestore with the provisioned database ID (critical for AI Studio Firestore)
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Initialize Firebase App Check with reCAPTCHA Enterprise
// Preserves normal visitor access without blocking when unconfigured.
if (typeof window !== 'undefined') {
  const recaptchaKey =
    (firebaseConfig as any).recaptchaSiteKey ||
    (import.meta as any).env?.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;

  if (recaptchaKey && typeof recaptchaKey === 'string' && recaptchaKey.trim().length > 0) {
    try {
      if (import.meta.env.DEV) {
        (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(recaptchaKey.trim()),
        isTokenAutoRefreshEnabled: true,
      });
      console.info('Firebase App Check (reCAPTCHA Enterprise) initialized.');
    } catch (appCheckError) {
      console.warn('App Check initialization skipped or failed:', appCheckError);
    }
  } else if (import.meta.env.DEV) {
    console.info('Firebase App Check: recaptchaSiteKey is not yet configured. Normal visitor access is active.');
  }
}

// Test connection on boot as mandated by the Firebase skill
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
