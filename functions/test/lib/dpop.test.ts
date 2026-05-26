import crypto from "node:crypto";
import { exportJWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyDpopProof } from "../../src/lib/dpop.js";

async function buildProof(args: { htu: string; method?: string; ath?: string }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicJwk = await exportJWK(publicKey);
  const payload: Record<string, string> = {
    htm: args.method ?? "POST",
    htu: args.htu,
  };
  if (args.ath) {
    payload.ath = args.ath;
  }

  return new SignJWT(payload)
    .setProtectedHeader({
      alg: "EdDSA",
      typ: "dpop+jwt",
      jwk: publicJwk,
    })
    .setIssuedAt()
    .setJti("proof-jti-1")
    .sign(privateKey);
}

describe("verifyDpopProof", () => {
  it("accepts the canonical endpoint URL", async () => {
    const htu = "https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi/device/access-token";
    const proof = await buildProof({ htu });

    await expect(verifyDpopProof(proof, {
      method: "POST",
      htu,
    })).resolves.toMatchObject({
      jti: "proof-jti-1",
    });
  });

  it("accepts an explicitly allowed legacy function-relative URL", async () => {
    const canonicalHtu = "https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi/device/access-token";
    const legacyHtu = "https://us-central1-crowdpmplatform.cloudfunctions.net/device/access-token";
    const proof = await buildProof({ htu: legacyHtu });

    await expect(verifyDpopProof(proof, {
      method: "POST",
      htu: canonicalHtu,
      acceptableHtu: [legacyHtu],
    })).resolves.toMatchObject({
      jti: "proof-jti-1",
    });
  });

  it("rejects mismatched URLs outside the compatibility list", async () => {
    const proof = await buildProof({
      htu: "https://us-central1-crowdpmplatform.cloudfunctions.net/not-the-right-path",
    });

    await expect(verifyDpopProof(proof, {
      method: "POST",
      htu: "https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi/device/access-token",
      acceptableHtu: ["https://us-central1-crowdpmplatform.cloudfunctions.net/device/access-token"],
    })).rejects.toMatchObject({
      statusCode: 401,
      message: "DPoP htu mismatch",
    });
  });

  it("allows missing ath only on explicitly grandfathered legacy URLs", async () => {
    const canonicalHtu = "https://us-central1-crowdpmplatform.cloudfunctions.net/ingestGateway";
    const legacyHtu = "https://us-central1-crowdpmplatform.cloudfunctions.net/";
    const proof = await buildProof({ htu: legacyHtu });

    await expect(verifyDpopProof(proof, {
      method: "POST",
      htu: canonicalHtu,
      acceptableHtu: [legacyHtu],
      allowMissingAthOnHtu: [legacyHtu],
      expectedAth: "expected-ath",
    })).resolves.toMatchObject({
      jti: "proof-jti-1",
    });
  });

  it("still requires ath on the canonical URL", async () => {
    const canonicalHtu = "https://us-central1-crowdpmplatform.cloudfunctions.net/ingestGateway";
    const proof = await buildProof({ htu: canonicalHtu });

    await expect(verifyDpopProof(proof, {
      method: "POST",
      htu: canonicalHtu,
      allowMissingAthOnHtu: ["https://us-central1-crowdpmplatform.cloudfunctions.net/"],
      expectedAth: "expected-ath",
    })).rejects.toMatchObject({
      statusCode: 401,
      message: "DPoP ath mismatch",
    });
  });
});
