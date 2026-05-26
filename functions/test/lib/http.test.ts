import { describe, expect, it } from "vitest";
import {
  buildCanonicalEndpointUrl,
  buildFunctionRelativeEndpointUrl,
  deriveNetworkHint,
  extractClientIp,
  stripApiEntryPrefix,
} from "../../src/lib/http.js";

function withRuntimeEnv(overrides: {
  NODE_ENV?: string;
  FUNCTIONS_EMULATOR?: string;
  FIREBASE_EMULATOR_HUB?: string;
}, run: () => void) {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFunctionsEmulator = process.env.FUNCTIONS_EMULATOR;
  const previousEmulatorHub = process.env.FIREBASE_EMULATOR_HUB;

  if (overrides.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = overrides.NODE_ENV;

  if (overrides.FUNCTIONS_EMULATOR === undefined) delete process.env.FUNCTIONS_EMULATOR;
  else process.env.FUNCTIONS_EMULATOR = overrides.FUNCTIONS_EMULATOR;

  if (overrides.FIREBASE_EMULATOR_HUB === undefined) delete process.env.FIREBASE_EMULATOR_HUB;
  else process.env.FIREBASE_EMULATOR_HUB = overrides.FIREBASE_EMULATOR_HUB;

  try {
    run();
  }
  finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousFunctionsEmulator === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = previousFunctionsEmulator;

    if (previousEmulatorHub === undefined) delete process.env.FIREBASE_EMULATOR_HUB;
    else process.env.FIREBASE_EMULATOR_HUB = previousEmulatorHub;
  }
}

describe("stripApiEntryPrefix", () => {
  it("strips the hosting /api prefix for nested routes", () => {
    expect(stripApiEntryPrefix("/api/v1/public/batches")).toBe("/v1/public/batches");
    expect(stripApiEntryPrefix("/api/health")).toBe("/health");
  });

  it("preserves query strings when stripping the /api prefix", () => {
    expect(stripApiEntryPrefix("/api/v1/public/batches?limit=20")).toBe("/v1/public/batches?limit=20");
    expect(stripApiEntryPrefix("/api?check=1")).toBe("/?check=1");
  });

  it("leaves non-matching paths unchanged", () => {
    expect(stripApiEntryPrefix("/v1/public/batches")).toBe("/v1/public/batches");
    expect(stripApiEntryPrefix("/apiv1/public/batches")).toBe("/apiv1/public/batches");
    expect(stripApiEntryPrefix(undefined)).toBe("/");
  });
});

describe("buildCanonicalEndpointUrl", () => {
  it("joins route paths onto the configured function base URL", () => {
    expect(buildCanonicalEndpointUrl(
      "https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi",
      "/device/token"
    )).toBe("https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi/device/token");
  });

  it("keeps root requests anchored to the configured function URL", () => {
    expect(buildCanonicalEndpointUrl(
      "http://127.0.0.1:5001/crowdpm-local/us-central1/ingestGateway",
      "/"
    )).toBe("http://127.0.0.1:5001/crowdpm-local/us-central1/ingestGateway");
  });

  it("preserves root query strings without inventing a trailing slash", () => {
    expect(buildCanonicalEndpointUrl(
      "http://127.0.0.1:5001/crowdpm-local/us-central1/ingestGateway",
      "?visibility=public"
    )).toBe("http://127.0.0.1:5001/crowdpm-local/us-central1/ingestGateway?visibility=public");
  });
});

describe("buildFunctionRelativeEndpointUrl", () => {
  it("builds the legacy function-relative URL for crowdpmApi routes", () => {
    expect(buildFunctionRelativeEndpointUrl(
      "https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi",
      "/device/access-token"
    )).toBe("https://us-central1-crowdpmplatform.cloudfunctions.net/device/access-token");
  });

  it("builds the legacy function-relative URL for ingest root requests", () => {
    expect(buildFunctionRelativeEndpointUrl(
      "https://us-central1-crowdpmplatform.cloudfunctions.net/ingestGateway",
      "/"
    )).toBe("https://us-central1-crowdpmplatform.cloudfunctions.net/");
  });

  it("preserves root query strings for legacy ingest URLs", () => {
    expect(buildFunctionRelativeEndpointUrl(
      "https://us-central1-crowdpmplatform.cloudfunctions.net/ingestGateway",
      "?visibility=public"
    )).toBe("https://us-central1-crowdpmplatform.cloudfunctions.net/?visibility=public");
  });
});

describe("extractClientIp", () => {
  it("trusts the platform-injected App Engine IP header outside local runtime", () => {
    withRuntimeEnv({}, () => {
      expect(extractClientIp({
        "x-appengine-user-ip": "203.0.113.8",
        "x-forwarded-for": "198.51.100.20",
      })).toBe("203.0.113.8");
    });
  });

  it("ignores spoofable forwarded IP headers outside local runtime", () => {
    withRuntimeEnv({}, () => {
      expect(extractClientIp({
        "x-forwarded-for": "198.51.100.20",
        "x-real-ip": "198.51.100.21",
      })).toBeNull();
    });
  });

  it("allows forwarded IP headers in local emulator and test runtimes", () => {
    withRuntimeEnv({ NODE_ENV: "test" }, () => {
      expect(extractClientIp({
        "x-forwarded-for": "198.51.100.20, 10.0.0.1",
      })).toBe("198.51.100.20");
    });
  });
});

describe("deriveNetworkHint", () => {
  it("uses explicit local ASN hints in local runtime", () => {
    withRuntimeEnv({ NODE_ENV: "test" }, () => {
      expect(deriveNetworkHint({ "x-client-asn": "64512" }, "198.51.100.20")).toBe("AS64512");
    });
  });

  it("falls back to coarse IP prefixes outside local runtime", () => {
    withRuntimeEnv({}, () => {
      expect(deriveNetworkHint({ "x-client-asn": "64512" }, "198.51.100.20")).toBe("v4-198.51");
    });
  });
});
