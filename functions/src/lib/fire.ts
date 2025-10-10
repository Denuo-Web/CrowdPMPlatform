import admin from "firebase-admin";
let inited = false;
export function app() { if (!inited) { admin.initializeApp(); inited = true; } return admin; }
export const db = () => app().firestore();
export const bucket = () => app().storage().bucket();
export function hourBucket(ts: Date) {
  const y = ts.getUTCFullYear(), m = String(ts.getUTCMonth()+1).padStart(2,"0");
  const d = String(ts.getUTCDate()).padStart(2,"0"), h = String(ts.getUTCHours()).padStart(2,"0");
  return `${y}${m}${d}${h}`;
}
