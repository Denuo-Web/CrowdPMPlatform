import admin from "firebase-admin";
import type { IncomingHttpHeaders } from "node:http";
import type { FastifyRequest } from "fastify";
import type { Request } from "firebase-functions/v2/https";
import type { DecodedIdToken } from "firebase-admin/auth";
import { httpError } from "../lib/httpError.js";

type HeaderCarrier = Pick<Request, "headers"> | Pick<FastifyRequest, "headers">;

function getAuthorizationHeader(headers?: IncomingHttpHeaders) {
  const raw = headers?.authorization;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

export type RequireUserOptions = {
  requireSecondFactorIfEnrolled?: boolean;
};

export async function requireUser(req: HeaderCarrier, options?: RequireUserOptions): Promise<DecodedIdToken> {
  const hdr = getAuthorizationHeader(req.headers);
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!token) throw httpError(401, "unauthorized", "Authentication required");
  const decoded = await admin.auth().verifyIdToken(token);
  if (options?.requireSecondFactorIfEnrolled) {
    const userRecord = await admin.auth().getUser(decoded.uid);
    const hasMfa = Boolean(userRecord.multiFactor?.enrolledFactors?.length);
    if (hasMfa && !(decoded.firebase && typeof decoded.firebase === "object" && "sign_in_second_factor" in decoded.firebase)) {
      throw httpError(401, "second_factor_required", "Second factor required");
    }
  }
  return decoded;
}
