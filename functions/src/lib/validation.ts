import { z } from "zod";

const DeviceId = z.string().trim().min(1).max(128);

export const IngestPoint = z.object({
  device_id: DeviceId,
  pollutant: z.enum(["pm25"]),
  value: z.number().finite(),
  unit: z.literal("µg/m³"),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  precision: z.number().optional(),
  timestamp: z.string().datetime(),
  flags: z.number().int().nonnegative().optional()
}).strict();
export const IngestBatch = z.object({ points: z.array(IngestPoint).min(1) }).strict();
export type IngestBatch = import("zod").infer<typeof IngestBatch>;

export const IngestPayload = IngestBatch
  .extend({ device_id: DeviceId.optional() })
  .strict();
export type IngestPayload = import("zod").infer<typeof IngestPayload>;
