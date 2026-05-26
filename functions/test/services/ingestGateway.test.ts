import { describe, expect, it, vi } from "vitest";
import { RateLimitError } from "../../src/lib/rateLimiter.js";
import { httpError } from "../../src/lib/httpError.js";
import { ingestGatewayHandler } from "../../src/services/ingestGateway.js";

type MockResponse = {
  statusCode: number | null;
  payload: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockResponse;
  end: () => void;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

function createMockResponse(): MockResponse {
  const response: MockResponse = {
    statusCode: null,
    payload: null,
    headers: {},
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    end() {
      response.payload = null;
    },
    json(payload: unknown) {
      response.payload = payload;
    },
    setHeader(name: string, value: string) {
      response.headers[name.toLowerCase()] = value;
    },
  };
  return response;
}

function createRequest(overrides?: Partial<Record<string, unknown>>) {
  const headers = {
    host: "localhost:5001",
    ...((overrides?.headers as Record<string, string> | undefined) ?? {}),
  };

  const req = {
    method: "POST",
    url: "/",
    query: {},
    body: {},
    headers,
    rawBody: undefined,
    get(name: string) {
      const key = name.toLowerCase();
      return headers[key] ?? headers[name] ?? undefined;
    },
    header(name: string) {
      const key = name.toLowerCase();
      return headers[key] ?? headers[name] ?? undefined;
    },
    ...overrides,
  };

  return req;
}

describe("ingestGatewayHandler", () => {
  it("returns normalized JSON when bearer auth is missing", async () => {
    const deps = {
      verifyDeviceAccessToken: vi.fn(),
      verifyDpopProof: vi.fn(),
      checkDpopReplay: vi.fn(),
      ingest: vi.fn(),
    };

    const req = createRequest();
    const res = createMockResponse();

    await ingestGatewayHandler(req as never, res, deps as never);

    expect(deps.verifyDeviceAccessToken).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.payload).toMatchObject({
      error: "invalid_request",
      message: "missing bearer token",
    });
  });

  it("returns JSON and retry-after headers for rate-limited failures", async () => {
    const deps = {
      verifyDeviceAccessToken: vi.fn(async () => { throw new RateLimitError(9); }),
      verifyDpopProof: vi.fn(),
      checkDpopReplay: vi.fn(),
      ingest: vi.fn(),
    };

    const req = createRequest({ headers: { host: "localhost:5001", authorization: "Bearer token" } });
    const res = createMockResponse();

    await ingestGatewayHandler(req as never, res, deps as never);

    expect(res.statusCode).toBe(429);
    expect(res.headers).toMatchObject({ "retry-after": "9" });
    expect(res.payload).toEqual({ error: "rate_limited", retry_after: 9 });
  });

  it("returns success payload for valid ingest requests", async () => {
    const deps = {
      verifyDeviceAccessToken: vi.fn(async () => ({ cnf: { jkt: "jkt-1" }, device_id: "device-123", jti: "token-jti-1" })),
      verifyDpopProof: vi.fn(async () => ({ thumbprint: "jkt-1", jti: "proof-jti-1", iat: 1_700_000_000 })),
      checkDpopReplay: vi.fn(),
      ingest: vi.fn(async () => ({
        accepted: true,
        batchId: "batch-1",
        deviceId: "device-123",
        storagePath: "ingest/v2/user-123/device-123/batch-1.json.gz",
        visibility: "private",
      })),
    };

    const req = createRequest({
      headers: {
        host: "localhost:5001",
        authorization: "Bearer test-token",
        dpop: "proof-token",
      },
      body: {
        device_id: "device-123",
        points: [{ device_id: "device-123", pollutant: "pm25", value: 10, timestamp: "2024-01-01T00:00:00.000Z" }],
      },
      rawBody: JSON.stringify({
        device_id: "device-123",
        points: [{ device_id: "device-123", pollutant: "pm25", value: 10, timestamp: "2024-01-01T00:00:00.000Z" }],
      }),
      query: { visibility: "private" },
    });
    const res = createMockResponse();

    await ingestGatewayHandler(req as never, res, deps as never);

    expect(res.statusCode).toBe(202);
    expect(res.payload).toMatchObject({ accepted: true, batchId: "batch-1", deviceId: "device-123" });
    expect(deps.verifyDeviceAccessToken).toHaveBeenCalledWith("test-token");
    expect(deps.verifyDpopProof).toHaveBeenCalledWith("proof-token", expect.objectContaining({
      htu: "http://127.0.0.1:5001/crowdpm-local/us-central1/ingestGateway",
      acceptableHtu: ["http://127.0.0.1:5001/"],
      allowMissingAthOnHtu: ["http://127.0.0.1:5001/"],
      expectedAth: expect.any(String),
      expectedThumbprint: "jkt-1",
    }));
    expect(deps.checkDpopReplay).toHaveBeenCalledWith(expect.objectContaining({
      accessTokenJti: "token-jti-1",
      jti: "proof-jti-1",
      thumbprint: "jkt-1",
    }));
    expect(deps.ingest).toHaveBeenCalled();
  });

  it("rejects replayed DPoP proof identifiers before ingesting", async () => {
    const deps = {
      verifyDeviceAccessToken: vi.fn(async () => ({ cnf: { jkt: "jkt-1" }, device_id: "device-123", jti: "token-jti-1" })),
      verifyDpopProof: vi.fn(async () => ({ thumbprint: "jkt-1", jti: "proof-jti-1", iat: 1_700_000_000 })),
      checkDpopReplay: vi.fn(async () => {
        throw httpError(401, "invalid_token", "DPoP proof replay detected");
      }),
      ingest: vi.fn(),
    };

    const req = createRequest({
      headers: {
        host: "localhost:5001",
        authorization: "Bearer test-token",
        dpop: "proof-token",
      },
      body: { device_id: "device-123", points: [] },
    });
    const res = createMockResponse();

    await ingestGatewayHandler(req as never, res, deps as never);

    expect(res.statusCode).toBe(401);
    expect(res.payload).toMatchObject({
      error: "invalid_token",
      message: "DPoP proof replay detected",
    });
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it("normalizes downstream structured failures", async () => {
    const deps = {
      verifyDeviceAccessToken: vi.fn(async () => {
        throw httpError(403, "DEVICE_FORBIDDEN", "device not allowed");
      }),
      verifyDpopProof: vi.fn(),
      checkDpopReplay: vi.fn(),
      ingest: vi.fn(),
    };

    const req = createRequest({ headers: { host: "localhost:5001", authorization: "Bearer test-token" } });
    const res = createMockResponse();

    await ingestGatewayHandler(req as never, res, deps as never);

    expect(res.statusCode).toBe(403);
    expect(res.payload).toMatchObject({
      error: "device_forbidden",
      message: "device not allowed",
    });
  });
});
