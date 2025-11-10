import crypto from "node:crypto";

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 characters, avoids confusing glyphs.

export function generateDeviceCode(): string {
  return crypto.randomBytes(16).toString("hex"); // 128-bit opaque value
}

function randomAlphabetChar(): string {
  const index = crypto.randomInt(USER_CODE_ALPHABET.length);
  return USER_CODE_ALPHABET.charAt(index);
}

function computeChecksum(payload: string): string {
  const digest = crypto.createHash("sha256").update(payload).digest();
  const checksumIndex = digest[0] % USER_CODE_ALPHABET.length;
  return USER_CODE_ALPHABET.charAt(checksumIndex);
}

export function generateUserCode(): string {
  const payloadLength = 10; // 50 bits of entropy (10 base32 chars).
  let payload = "";
  for (let i = 0; i < payloadLength; i += 1) {
    payload += randomAlphabetChar();
  }
  const checksum = computeChecksum(payload);
  const left = payload.slice(0, 5);
  const right = payload.slice(5);
  return `${left}-${right}-${checksum}`;
}

export function fingerprintForPublicKey(pubKey: Buffer): string {
  return crypto.createHash("sha256").update(pubKey).digest("hex").slice(0, 8);
}
