import { calculateJwkThumbprint, compactVerify, importJWK, type JWK } from "jose";

type VerifyOptions = {
  method: string;
  htu: string;
  maxAgeSeconds?: number;
  clockSkewSeconds?: number;
  expectedThumbprint?: string;
  expectedAth?: string;
};

export type VerifiedDpop = {
  thumbprint: string;
  jwk: JWK;
  iat: number;
  jti: string;
  ath?: string;
};

const decoder = new TextDecoder();
const DEFAULT_DPOP_MAX_AGE_SECONDS = 120;
const DEFAULT_DPOP_CLOCK_SKEW_SECONDS = 5;

function unauthorized(message: string) {
  return Object.assign(new Error(message), { statusCode: 401 });
}

export async function verifyDpopProof(proof: string | undefined, options: VerifyOptions): Promise<VerifiedDpop> {
  if (!proof || typeof proof !== "string") {
    throw unauthorized("DPoP proof is required");
  }
  let protectedJwk: JWK | undefined;
  const { payload } = await compactVerify(proof, async (header) => {
    if (header.alg !== "EdDSA") {
      throw unauthorized("DPoP must use EdDSA");
    }
    if (!header.jwk) {
      throw unauthorized("DPoP missing public key");
    }
    if (protectedJwk === undefined) {
      protectedJwk = header.jwk as JWK;
    }
    return importJWK(header.jwk as JWK, "Ed25519");
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payload));
  }
  catch {
    throw unauthorized("Invalid DPoP payload");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw unauthorized("Invalid DPoP payload");
  }

  const { htm, htu, iat, jti, ath } = parsed as Record<string, unknown>;
  if (typeof htm !== "string" || !htm) throw unauthorized("DPoP missing htm");
  if (typeof htu !== "string" || !htu) throw unauthorized("DPoP missing htu");
  if (typeof iat !== "number" || !Number.isFinite(iat)) throw unauthorized("DPoP missing iat");
  if (typeof jti !== "string" || !jti) throw unauthorized("DPoP missing jti");

  const method = options.method.toUpperCase();
  if (htm.toUpperCase() !== method) {
    throw unauthorized("DPoP htm mismatch");
  }

  if (htu !== options.htu) {
    throw unauthorized("DPoP htu mismatch");
  }

  const maxAge = options.maxAgeSeconds ?? DEFAULT_DPOP_MAX_AGE_SECONDS;
  const skew = options.clockSkewSeconds ?? DEFAULT_DPOP_CLOCK_SKEW_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  if (iat < now - maxAge - skew || iat > now + skew) {
    throw unauthorized("DPoP iat outside acceptable window");
  }

  if (options.expectedAth && (!ath || typeof ath !== "string" || ath !== options.expectedAth)) {
    throw unauthorized("DPoP ath mismatch");
  }

  if (!protectedJwk) {
    throw unauthorized("DPoP missing key");
  }

  const thumbprint = await calculateJwkThumbprint(protectedJwk, "sha256");
  if (options.expectedThumbprint && thumbprint !== options.expectedThumbprint) {
    throw unauthorized("DPoP key mismatch");
  }

  return { thumbprint, jwk: protectedJwk, iat, jti, ath: typeof ath === "string" ? ath : undefined };
}
