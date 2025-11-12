import pino from "pino";
import type { ServiceConfig } from "./config.js";

export function createLogger(config: ServiceConfig) {
  return pino({
    level: config.LOG_LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime
  });
}
