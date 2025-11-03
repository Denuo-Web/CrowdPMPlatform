import type { FirebaseOptions } from "firebase/app";
import { getApp, getApps, initializeApp } from "firebase/app";

function readEnv(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing Firebase configuration: ${key}`);
  }
  return value.trim();
}

const firebaseConfig: FirebaseOptions = {
  apiKey: readEnv("VITE_FIREBASE_API_KEY"),
  authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: readEnv("VITE_FIREBASE_PROJECT_ID"),
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() || undefined,
};

export function getFirebaseApp() {
  if (getApps().length) return getApp();
  return initializeApp(firebaseConfig);
}
