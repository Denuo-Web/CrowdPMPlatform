import admin from "firebase-admin";
import type { IncomingHttpHeaders } from "node:http";
import type { FastifyRequest } from "fastify";
import type { Request } from "firebase-functions/v2/https";

type HeaderCarrier = Pick<Request, "headers"> | Pick<FastifyRequest, "headers">;

function getAuthorizationHeader(headers?: IncomingHttpHeaders) {
  const raw = headers?.authorization;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

export async function requireUser(req: HeaderCarrier) {
  const hdr = getAuthorizationHeader(req.headers);
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!token) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
  return admin.auth().verifyIdToken(token);
}
