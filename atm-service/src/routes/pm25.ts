import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import type { BatchProcessor } from "../processor.js";
import type { ServiceConfig } from "../config.js";
import type { BoundingBox } from "../types.js";

const querySchema = z.object({
  batchId: z.string().min(1),
  deviceId: z.string().optional(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  bbox: z.string().min(3),
  force: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => {
      if (typeof value === "boolean") return value;
      if (typeof value !== "string") return false;
      return value === "1" || value.toLowerCase() === "true";
    }),
  allowStale: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => {
      if (typeof value === "boolean") return value;
      if (typeof value !== "string") return false;
      return value === "1" || value.toLowerCase() === "true";
    })
});

function parseBoundingBox(raw: string): BoundingBox {
  const parts = raw.split(",").map((token) => Number.parseFloat(token.trim()));
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
    throw new Error("Invalid bbox parameter. Expected south,west,north,east.");
  }
  const [south, west, north, east] = parts;
  return { south, west, north, east };
}

export interface Pm25RouteOptions extends FastifyPluginOptions {
  processor: BatchProcessor;
  config: ServiceConfig;
}

export async function pm25Routes(fastify: FastifyInstance, options: Pm25RouteOptions) {
  const { processor } = options;

  fastify.get("/pm25", async (request, reply) => {
    const parsed = querySchema.parse(request.query);
    const bbox = parseBoundingBox(parsed.bbox);
    const descriptor = {
      batchId: parsed.batchId,
      deviceId: parsed.deviceId,
      bbox,
      startTime: parsed.start,
      endTime: parsed.end
    };

    const result = await processor.ensure(descriptor, {
      force: parsed.force,
      allowStale: parsed.allowStale
    });

    reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");

    return {
      batchId: result.batchId,
      deviceId: result.deviceId,
      bbox: result.bbox,
      startTime: result.startTime,
      endTime: result.endTime,
      updatedAt: result.updatedAt,
      points: result.points
    };
  });
}
