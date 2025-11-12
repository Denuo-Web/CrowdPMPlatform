import type { Logger } from "pino";
import { downloadForecast } from "./camsClient.js";
import type { ServiceConfig } from "./config.js";
import { extractPoints } from "./netcdf.js";
import { StorageManager } from "./storage.js";
import type { BatchDescriptor, ProcessedBatch, StoredBatchMetadata } from "./types.js";

type EnsureOptions = {
  force?: boolean;
  allowStale?: boolean;
};

export class BatchProcessor {
  private readonly config: ServiceConfig;
  private readonly storage: StorageManager;
  private readonly logger: Logger;
  private readonly inFlight = new Map<string, Promise<ProcessedBatch>>();

  constructor(config: ServiceConfig, storage: StorageManager, logger: Logger) {
    this.config = config;
    this.storage = storage;
    this.logger = logger;
  }

  async ensure(descriptor: BatchDescriptor, options?: EnsureOptions): Promise<ProcessedBatch> {
    const key = descriptor.batchId;
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key)!;
    }

    const job = this.ensureInternal(descriptor, options)
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, job);
    return job;
  }

  private async ensureInternal(descriptor: BatchDescriptor, options?: EnsureOptions): Promise<ProcessedBatch> {
    const { metadata, filePath } = this.storage.descriptorToMetadata(descriptor);
    const existing = await this.storage.getEntry(descriptor.batchId);

    if (existing && existing.hash !== metadata.hash) {
      await this.storage.safeUnlink(existing.path);
    }

    if (existing && existing.hash === metadata.hash && !options?.force) {
      const points = await this.storage.readPoints(existing.path);
      if (points && points.length > 0) {
        const ageMs = Date.now() - new Date(existing.updatedAt).getTime();
        if (ageMs < this.config.CACHE_TTL_MINUTES * 60_000 || options?.allowStale) {
          return {
            ...existing,
            points
          };
        }
      }
      this.logger.warn({ batchId: descriptor.batchId }, "Existing PM2.5 dataset missing or stale, refreshing");
    }

    return this.refresh(descriptor, metadata, filePath);
  }

  async refresh(descriptor: BatchDescriptor, metadata?: StoredBatchMetadata, filePath?: string): Promise<ProcessedBatch> {
    const targetMetadata = metadata ?? this.storage.descriptorToMetadata(descriptor).metadata;
    const targetPath = filePath ?? targetMetadata.path;
    this.logger.info({ batchId: descriptor.batchId }, "Requesting CAMS NetCDF");
    const netcdf = await downloadForecast(this.config, descriptor);
    this.logger.debug({ batchId: descriptor.batchId, bytes: netcdf.byteLength }, "Downloaded NetCDF");

    const points = extractPoints(this.config, descriptor, netcdf);
    this.logger.debug({ batchId: descriptor.batchId, pointCount: points.length }, "Extracted PM2.5 grid");

    await this.storage.writePoints(targetPath, points);
    const nextMetadata: StoredBatchMetadata = {
      ...targetMetadata,
      updatedAt: new Date().toISOString()
    };
    await this.storage.setEntry(nextMetadata);

    return {
      ...nextMetadata,
      points
    };
  }

  async refreshAll(): Promise<void> {
    const entries = await this.storage.listEntries();
    if (!entries.length) return;

    const sorted = [...entries].sort((a, b) => {
      const aAge = Date.parse(a.updatedAt);
      const bAge = Date.parse(b.updatedAt);
      return aAge - bAge;
    });

    const concurrency = Math.max(1, Math.min(this.config.MAX_PARALLEL_JOBS, 4));

    const queue = [...sorted];
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const entry = queue.shift();
        if (!entry) return;
        const descriptor: BatchDescriptor = {
          batchId: entry.batchId,
          deviceId: entry.deviceId,
          bbox: entry.bbox,
          startTime: entry.startTime,
          endTime: entry.endTime
        };

        const ageMs = Date.now() - new Date(entry.updatedAt).getTime();
        if (ageMs < this.config.CACHE_TTL_MINUTES * 60_000) {
          this.logger.debug({ batchId: entry.batchId }, "Skipping refresh; cache still fresh");
          continue;
        }

        try {
          await this.ensure(descriptor, { force: true });
        }
        catch (err) {
          this.logger.error({ batchId: entry.batchId, err }, "Failed to refresh PM2.5 dataset");
        }
      }
    });

    await Promise.allSettled(workers);
  }
}
