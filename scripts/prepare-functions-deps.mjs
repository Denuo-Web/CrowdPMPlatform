#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const functionsDir = path.join(repoRoot, "functions");
const sharedTypesDir = path.join(repoRoot, "shared-types");
const localDepsDir = path.join(functionsDir, "local-deps");
const tarballName = "crowdpm-types.tgz";
const prefix = "[prepare:functions-deps]";

function log(message) {
  console.log(`${prefix} ${message}`);
}

function run(command, cwd = repoRoot) {
  execSync(command, { cwd, stdio: "inherit" });
}

function ensureSharedTypes() {
  if (!existsSync(sharedTypesDir)) {
    console.error(`${prefix} shared-types directory not found at ${sharedTypesDir}`);
    process.exit(1);
  }
}

function packSharedTypes() {
  log("Building shared-types");
  run("corepack pnpm --filter @crowdpm/types build");

  log("Packing shared-types into functions/local-deps");
  run(`corepack pnpm --filter @crowdpm/types pack --pack-destination ${localDepsDir}`);

  const tarballs = readdirSync(localDepsDir)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => ({ file, mtime: statSync(path.join(localDepsDir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (tarballs.length === 0) {
    console.error(`${prefix} pnpm pack did not produce a tarball in ${localDepsDir}`);
    process.exit(1);
  }

  const packedPath = path.resolve(localDepsDir, tarballs[0].file);
  const finalTarballPath = path.resolve(localDepsDir, tarballName);

  if (packedPath !== finalTarballPath) {
    if (existsSync(finalTarballPath)) rmSync(finalTarballPath);
    renameSync(packedPath, finalTarballPath);
  }

  // Clean up any leftover tarballs to avoid bloating the directory.
  for (const file of readdirSync(localDepsDir)) {
    if (file.endsWith(".tgz") && file !== tarballName) {
      rmSync(path.join(localDepsDir, file));
    }
  }

  return finalTarballPath;
}

function installIntoFunctions(tarballPath) {
  log("Installing packed types into functions workspace");

  const nodeModulesDir = path.join(functionsDir, "node_modules");
  const targetDir = path.join(nodeModulesDir, "@crowdpm", "types");

  mkdirSync(path.join(nodeModulesDir, "@crowdpm"), { recursive: true });
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });

  run(`tar -xzf "${tarballPath}" -C "${targetDir}" --strip-components=1`, functionsDir);
}

function main() {
  ensureSharedTypes();
  mkdirSync(localDepsDir, { recursive: true });
  const tarballPath = packSharedTypes();
  installIntoFunctions(tarballPath);
  log("Done");
}

main();
