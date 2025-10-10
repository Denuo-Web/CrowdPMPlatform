import crypto from "node:crypto";
export function verifyHmac(raw: string, sig?: string, secret = process.env.INGEST_HMAC_SECRET || "") {
  const mac = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (!sig) {
    const error = Object.assign(new Error("bad signature"), { statusCode: 401 });
    throw error;
  }

  const expected = new Uint8Array(Buffer.from(mac, "utf8"));
  const provided = new Uint8Array(Buffer.from(sig, "utf8"));

  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    const error = Object.assign(new Error("bad signature"), { statusCode: 401 });
    throw error;
  }
}
