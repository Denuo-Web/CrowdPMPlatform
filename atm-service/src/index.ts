import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import cron from "node-cron";
import { loadConfig } from "./config.js";
import { StorageManager } from "./storage.js";
import { BatchProcessor } from "./processor.js";
import { pm25Routes } from "./routes/pm25.js";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(thisDir, "..");
const envFiles = [".env", ".env.local"];
for (const file of envFiles) {
  loadEnv({ path: path.join(serviceRoot, file), override: true });
}

async function bootstrap() {
  const config = loadConfig();

  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL
    }
  });

  await fastify.register(cors, {
    origin: true
  });
  await fastify.register(compress);
  await fastify.register(sensible);

  const storage = new StorageManager(config.DATA_DIR);
  const processor = new BatchProcessor(config, storage, fastify.log);

  await fastify.register(pm25Routes, { processor, config });

  fastify.get("/healthz", async () => {
    return { ok: true, timestamp: new Date().toISOString() };
  });

  const schedule = config.CRON_SCHEDULE;
  if (schedule) {
    cron.schedule(schedule, async () => {
      fastify.log.info({ schedule }, "Running scheduled PM2.5 refresh");
      try {
        await processor.refreshAll();
      }
      catch (err) {
        fastify.log.error({ err }, "Scheduled refresh failed");
      }
    });
  }

  void processor.refreshAll().catch((err) => {
    fastify.log.error({ err }, "Initial PM2.5 refresh failed");
  });

  const close = async () => {
    fastify.log.info("Shutting down");
    await fastify.close();
    process.exit(0);
  };

  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  try {
    await fastify.listen({
      port: config.port,
      host: config.host
    });
    fastify.log.info(`PM2.5 service listening on http://${config.host}:${config.port}`);
  }
  catch (err) {
    fastify.log.error({ err }, "Failed to start PM2.5 service");
    process.exit(1);
  }
}

void bootstrap();
