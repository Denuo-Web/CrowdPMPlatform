import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID,
} = import.meta.env;

function requireEnv(value: string | undefined, key: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing ${key} in environment configuration.`);
  }
  return value;
}

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      apiKey: requireEnv(VITE_FIREBASE_API_KEY, "VITE_FIREBASE_API_KEY"),
      authDomain: requireEnv(VITE_FIREBASE_AUTH_DOMAIN, "VITE_FIREBASE_AUTH_DOMAIN"),
      projectId: requireEnv(VITE_FIREBASE_PROJECT_ID, "VITE_FIREBASE_PROJECT_ID"),
      storageBucket: requireEnv(VITE_FIREBASE_STORAGE_BUCKET, "VITE_FIREBASE_STORAGE_BUCKET"),
      messagingSenderId: requireEnv(VITE_FIREBASE_MESSAGING_SENDER_ID, "VITE_FIREBASE_MESSAGING_SENDER_ID"),
      appId: requireEnv(VITE_FIREBASE_APP_ID, "VITE_FIREBASE_APP_ID"),
    });

export const auth = getAuth(app);

