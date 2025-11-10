import { calculateJwkThumbprint, type JWK } from "jose";
import type { firestore } from "firebase-admin";
import { db } from "../lib/fire.js";
import { decodeBase64Url, encodeBase64Url } from "../lib/encoding.js";
import { fingerprintForPublicKey, generateDeviceCode, generateUserCode } from "../lib/pairingCodes.js";
import { getVerificationUri } from "../lib/runtimeConfig.js";

type DocumentData = firestore.DocumentData;
type DocumentReference = firestore.DocumentReference<DocumentData>;
type DocumentSnapshot = firestore.DocumentSnapshot<DocumentData>;

const COLLECTION = "pairing_sessions";
const TTL_MS = 15 * 60 * 1000; // 15 minutes

export type SessionStatus = "pending" | "authorized" | "redeemed" | "expired";

export type PairingSession = {
  id: string;
  deviceCode: string;
  userCode: string;
  userCodeCanonical: string;
  pubKeJwk: JWK;
  pubKeThumbprint: string;
  model: string;
  version: string;
  nonce: string | null;
  status: SessionStatus;
  createdAt: Date;
  expiresAt: Date;
  pollInterval: number;
  requesterIp: string | null;
  requesterAsn: string | null;
  fingerprint: string;
  accId: string | null;
  authorizedAt: Date | null;
  authorizedBy: string | null;
  registrationTokenJti: string | null;
  registrationTokenExpiresAt: Date | null;
  lastPollAt: Date | null;
  deviceId: string | null;
};

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return Number.isFinite(value) ? new Date(value) : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  if (typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    try {
      return (value as { toDate: () => Date }).toDate();
    }
    catch {
      return null;
    }
  }
  return null;
}

function canonicalizeUserCode(input: string): string {
  return (input || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function normalizeSession(id: string, data: DocumentData): PairingSession {
  return {
    id,
    deviceCode: typeof data.deviceCode === "string" ? data.deviceCode : id,
    userCode: typeof data.userCode === "string" ? data.userCode : "",
    userCodeCanonical: typeof data.userCodeCanonical === "string"
      ? data.userCodeCanonical
      : canonicalizeUserCode(typeof data.userCode === "string" ? data.userCode : ""),
    pubKeJwk: (typeof data.pubKeJwk === "object" && data.pubKeJwk) ? data.pubKeJwk as JWK : { kty: "OKP", crv: "Ed25519", x: "" },
    pubKeThumbprint: typeof data.pubKeThumbprint === "string" ? data.pubKeThumbprint : "",
    model: typeof data.model === "string" ? data.model : "unknown",
    version: typeof data.version === "string" ? data.version : "unknown",
    nonce: typeof data.nonce === "string" ? data.nonce : null,
    status: (["pending", "authorized", "redeemed", "expired"] as SessionStatus[]).includes(data.status)
      ? data.status
      : "pending",
    createdAt: toDate(data.createdAt) ?? new Date(0),
    expiresAt: toDate(data.expiresAt) ?? new Date(0),
    pollInterval: typeof data.pollInterval === "number" ? data.pollInterval : 5,
    requesterIp: typeof data.requesterIp === "string" ? data.requesterIp : null,
    requesterAsn: typeof data.requesterAsn === "string" ? data.requesterAsn : null,
    fingerprint: typeof data.fingerprint === "string" ? data.fingerprint : "",
    accId: typeof data.accId === "string" ? data.accId : null,
    authorizedAt: toDate(data.authorizedAt),
    authorizedBy: typeof data.authorizedBy === "string" ? data.authorizedBy : null,
    registrationTokenJti: typeof data.registrationTokenJti === "string" ? data.registrationTokenJti : null,
    registrationTokenExpiresAt: toDate(data.registrationTokenExpiresAt),
    lastPollAt: toDate(data.lastPollAt),
    deviceId: typeof data.deviceId === "string" ? data.deviceId : null,
  };
}

function now(): Date {
  return new Date();
}

function ensureActive(session: PairingSession) {
  if (session.status === "expired" || session.status === "redeemed") {
    throw httpError(410, "Pairing flow no longer valid");
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw httpError(410, "Pairing flow expired");
  }
}

export type SessionSnapshot = PairingSession & { ref: DocumentReference };

async function wrapSession(doc: DocumentSnapshot): Promise<SessionSnapshot> {
  if (!doc.exists) {
    throw httpError(404, "Pairing session not found");
  }
  return { ...normalizeSession(doc.id, doc.data() ?? {}), ref: doc.ref };
}

export async function startPairingSession(args: {
  pubKe: string;
  model: string;
  version: string;
  nonce?: string;
  pollInterval?: number;
  requesterIp?: string | null;
  requesterAsn?: string | null;
}): Promise<{ session: PairingSession; verificationUri: string; verificationUriComplete: string }> {
  const pubKey = decodeBase64Url(args.pubKe);
  if (pubKey.byteLength !== 32) {
    throw httpError(400, "pub_ke must be a base64url-encoded 32 byte Ed25519 key");
  }
  const jwk: JWK = { kty: "OKP", crv: "Ed25519", x: encodeBase64Url(pubKey) };
  const thumbprint = await calculateJwkThumbprint(jwk, "sha256");
  if (args.nonce) {
    const existing = await db().collection(COLLECTION).where("nonce", "==", args.nonce).limit(5).get();
    for (const doc of existing.docs) {
      const session = normalizeSession(doc.id, doc.data() ?? {});
      if (session.pubKeThumbprint === thumbprint && session.status !== "redeemed") {
        if (session.expiresAt.getTime() <= Date.now()) {
          await doc.ref.set({ status: "expired" }, { merge: true });
          continue;
        }
        return {
          session,
          verificationUri: getVerificationUri(),
          verificationUriComplete: `${getVerificationUri()}?code=${encodeURIComponent(session.userCode)}`,
        };
      }
    }
  }

  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + TTL_MS);
  const sessionDoc = {
    deviceCode,
    userCode,
    userCodeCanonical: canonicalizeUserCode(userCode),
    pubKeJwk: jwk,
    pubKeThumbprint: thumbprint,
    model: args.model,
    version: args.version,
    nonce: args.nonce ?? null,
    status: "pending" as SessionStatus,
    createdAt,
    expiresAt,
    pollInterval: args.pollInterval ?? 5,
    requesterIp: args.requesterIp ?? null,
    requesterAsn: args.requesterAsn ?? null,
    fingerprint: fingerprintForPublicKey(pubKey),
  };
  await db().collection(COLLECTION).doc(deviceCode).set(sessionDoc);
  return {
    session: { ...sessionDoc, id: deviceCode, accId: null, authorizedAt: null, authorizedBy: null, registrationTokenJti: null, registrationTokenExpiresAt: null, lastPollAt: null, deviceId: null },
    verificationUri: getVerificationUri(),
    verificationUriComplete: `${getVerificationUri()}?code=${encodeURIComponent(userCode)}`,
  };
}

export async function findSessionByUserCode(userCode: string): Promise<SessionSnapshot> {
  const canonical = canonicalizeUserCode(userCode);
  const snap = await db().collection(COLLECTION).where("userCodeCanonical", "==", canonical).limit(1).get();
  if (snap.empty) {
    throw httpError(404, "Pairing code not found");
  }
  return wrapSession(snap.docs[0]);
}

export async function findSessionByDeviceCode(deviceCode: string): Promise<SessionSnapshot> {
  const doc = await db().collection(COLLECTION).doc(deviceCode).get();
  return wrapSession(doc);
}

export async function authorizeSession(userCode: string, accountId: string): Promise<PairingSession> {
  const canonical = canonicalizeUserCode(userCode);
  const snap = await db().collection(COLLECTION).where("userCodeCanonical", "==", canonical).limit(1).get();
  if (snap.empty) {
    throw httpError(404, "Pairing code not found");
  }
  const ref = snap.docs[0].ref;
  return db().runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const session = normalizeSession(fresh.id, fresh.data() ?? {});
    if (session.expiresAt.getTime() <= Date.now()) {
      tx.update(ref, { status: "expired" });
      throw httpError(410, "Pairing code expired");
    }
    if (session.status === "redeemed") {
      throw httpError(409, "Pairing session already redeemed");
    }
    if (session.status === "authorized" && session.accId === accountId) {
      return session;
    }
    if (session.status !== "pending") {
      throw httpError(409, "Pairing session no longer pending");
    }
    tx.update(ref, {
      status: "authorized",
      accId: accountId,
      authorizedAt: now(),
      authorizedBy: accountId,
    });
    return { ...session, status: "authorized", accId: accountId, authorizedAt: now(), authorizedBy: accountId };
  });
}

export async function updatePollMetadata(deviceCode: string, pollInterval: number): Promise<void> {
  await db().collection(COLLECTION).doc(deviceCode).set({
    lastPollAt: now(),
    pollInterval,
  }, { merge: true });
}

export async function recordRegistrationToken(deviceCode: string, jti: string, expiresAt: Date): Promise<void> {
  await db().collection(COLLECTION).doc(deviceCode).set({
    registrationTokenJti: jti,
    registrationTokenExpiresAt: expiresAt,
  }, { merge: true });
}

export async function markSessionRedeemed(deviceCode: string, deviceId: string): Promise<void> {
  await db().collection(COLLECTION).doc(deviceCode).set({
    status: "redeemed",
    deviceId,
    redeemedAt: now(),
  }, { merge: true });
}

export function sessionForClient(session: PairingSession) {
  return {
    device_code: session.deviceCode,
    user_code: session.userCode,
    model: session.model,
    version: session.version,
    status: session.status,
    fingerprint: session.fingerprint,
    requested_at: session.createdAt.toISOString(),
    expires_at: session.expiresAt.toISOString(),
    requester_ip: session.requesterIp,
    requester_asn: session.requesterAsn,
    poll_interval: session.pollInterval,
  };
}

export function ensureSessionActive(session: PairingSession) {
  ensureActive(session);
}

export function sessionExpired(session: PairingSession): boolean {
  return session.expiresAt.getTime() <= Date.now();
}

export function registrationTokenIsFresh(session: PairingSession): boolean {
  if (!session.registrationTokenJti || !session.registrationTokenExpiresAt) return false;
  return session.registrationTokenExpiresAt.getTime() > Date.now();
}
