import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { BatchDescriptor, Pm25Point, StoredBatchMetadata } from "./types.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

type IndexShape = Record<string, StoredBatchMetadata>;

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJsonFile(filePath: string, data: unknown) {
  const payload = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, payload, "utf8");
}

function computeDescriptorHash(descriptor: BatchDescriptor): string {
  const hash = createHash("sha1");
  hash.update(descriptor.batchId);
  hash.update("|");
  if (descriptor.deviceId) hash.update(descriptor.deviceId);
  hash.update("|");
  hash.update(descriptor.startTime);
  hash.update("|");
  hash.update(descriptor.endTime);
  hash.update("|");
  hash.update([
    descriptor.bbox.south.toFixed(4),
    descriptor.bbox.west.toFixed(4),
    descriptor.bbox.north.toFixed(4),
    descriptor.bbox.east.toFixed(4)
  ].join(","));
  return hash.digest("hex");
}

export class StorageManager {
  private readonly dataDir: string;
  private readonly indexFile: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.indexFile = path.join(dataDir, "index.json");
  }

  async loadIndex(): Promise<IndexShape> {
    const index = await readJsonFile<IndexShape>(this.indexFile);
    return index ?? {};
  }

  async saveIndex(next: IndexShape): Promise<void> {
    await writeJsonFile(this.indexFile, next);
  }

  async getEntry(batchId: string): Promise<StoredBatchMetadata | null> {
    const index = await this.loadIndex();
    return index[batchId] ?? null;
  }

  async setEntry(entry: StoredBatchMetadata): Promise<void> {
    const index = await this.loadIndex();
    index[entry.batchId] = entry;
    await this.saveIndex(index);
  }

  async listEntries(): Promise<StoredBatchMetadata[]> {
    const index = await this.loadIndex();
    return Object.values(index);
  }

  async removeEntry(batchId: string): Promise<void> {
    const index = await this.loadIndex();
    if (index[batchId]) {
      const { path: entryPath } = index[batchId];
      await this.safeUnlink(entryPath);
      delete index[batchId];
      await this.saveIndex(index);
    }
  }

  makeFilePath(hash: string): string {
    return path.join(this.dataDir, `${hash}.json.gz`);
  }

  descriptorToMetadata(descriptor: BatchDescriptor): { metadata: StoredBatchMetadata; filePath: string } {
    const hash = computeDescriptorHash(descriptor);
    const pathForEntry = this.makeFilePath(hash);
    const metadata: StoredBatchMetadata = {
      ...descriptor,
      hash,
      path: pathForEntry,
      updatedAt: new Date().toISOString()
    };
    return { metadata, filePath: pathForEntry };
  }

  async writePoints(filePath: string, points: Pm25Point[]): Promise<void> {
    const payload = JSON.stringify({ points });
    const compressed = await gzipAsync(payload);
    await fs.writeFile(filePath, compressed);
  }

  async readPoints(filePath: string): Promise<Pm25Point[] | null> {
    try {
      const compressed = await fs.readFile(filePath);
      const raw = await gunzipAsync(compressed);
      const parsed = JSON.parse(raw.toString("utf8")) as { points?: Pm25Point[] };
      return Array.isArray(parsed.points) ? parsed.points : [];
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
