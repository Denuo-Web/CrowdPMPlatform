import type { firestore } from "firebase-admin";
import type { DecodedIdToken } from "firebase-admin/auth";

declare module "fastify" {
  interface FastifyRequest {
    user?: DecodedIdToken;
    deviceDoc?: firestore.DocumentSnapshot<firestore.DocumentData>;
  }
}

export {};
