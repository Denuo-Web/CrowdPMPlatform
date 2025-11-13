import { config as loadEnvFile } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

let loaded = false;

function projectRoot() {
  return path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
}

export function loadLocalEnv() {
  if (loaded) return;
  loaded = true;
  const root = projectRoot();
  const candidates: Array<{ file: string; override: boolean }> = [
    { file: ".env", override: false },
    { file: ".env.local", override: true },
  ];

  for (const candidate of candidates) {
    const envPath = path.join(root, candidate.file);
    if (!existsSync(envPath)) continue;
    loadEnvFile({ path: envPath, override: candidate.override });
  }
}

loadLocalEnv();
