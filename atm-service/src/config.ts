import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().optional(),
  HOST: z.string().optional(),
  CAMS_API_KEY: z.string().min(1),
  CAMS_API_URL: z.string().url().default("https://ads.atmosphere.copernicus.eu/api/v2"),
  CAMS_DATASET_ID: z.string().default("cams-global-atmospheric-composition-forecasts"),
  CAMS_PM_VARIABLE: z.string().default("pm2p5"),
  DATA_DIR: z.string().default(path.join(process.cwd(), "var", "pm25")),
  CRON_SCHEDULE: z.string().default("0 * * * *"),
  CACHE_TTL_MINUTES: z.coerce.number().default(90),
  API_TIMEOUT_MS: z.coerce.number().default(10 * 60 * 1000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  MAX_PARALLEL_JOBS: z.coerce.number().default(2)
});

export type ServiceConfig = z.infer<typeof envSchema> & {
  port: number;
  host: string;
};

export function loadConfig(): ServiceConfig {
  const parsed = envSchema.parse({
    ...process.env,
    PORT: process.env.PORT ?? process.env.ATM_SERVICE_PORT,
    DATA_DIR: process.env.DATA_DIR ?? process.env.ATM_DATA_DIR
  });

  if (!existsSync(parsed.DATA_DIR)) {
    mkdirSync(parsed.DATA_DIR, { recursive: true });
  }

  return {
    ...parsed,
    port: parsed.PORT ?? 4010,
    host: parsed.HOST ?? "0.0.0.0"
  };
}
