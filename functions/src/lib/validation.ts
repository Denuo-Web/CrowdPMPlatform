import { z } from "zod";
export const IngestPoint = z.object({
  device_id: z.string(),
  pollutant: z.enum(["pm25"]),
  value: z.number().finite(),
  unit: z.literal("µg/m³"),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  precision: z.number().optional(),
  timestamp: z.string().datetime(),
  flags: z.number().int().nonnegative().optional()
});
export const IngestBatch = z.object({ points: z.array(IngestPoint).min(1) });
export type IngestBatch = import("zod").infer<typeof IngestBatch>;

export const IngestPayload = IngestBatch
  .extend({ device_id: z.string().optional() })
  .passthrough();
export type IngestPayload = import("zod").infer<typeof IngestPayload>;
