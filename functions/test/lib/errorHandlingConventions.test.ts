import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function listTypeScriptFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith(".ts")) {
        out.push(fullPath);
      }
    }
  }

  return out;
}

function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

describe("error-handling conventions", () => {
  const srcRoot = path.resolve(import.meta.dirname, "../../src");
  const routeRoot = path.resolve(srcRoot, "routes");

  it("does not use ad-hoc Object.assign(new Error(...), { statusCode }) factories", () => {
    const offenders = listTypeScriptFiles(srcRoot)
      .filter((filePath) => readText(filePath).includes("Object.assign(new Error"));

    expect(offenders).toEqual([]);
  });

  it("keeps route handlers free of sendHttpError call sites", () => {
    const offenders = listTypeScriptFiles(routeRoot)
      .filter((filePath) => readText(filePath).includes("sendHttpError("));

    expect(offenders).toEqual([]);
  });

  it("keeps route handlers free of .send(...) response calls", () => {
    const offenders = listTypeScriptFiles(routeRoot)
      .filter((filePath) => readText(filePath).includes(".send("));

    expect(offenders).toEqual([]);
  });

  it("avoids manual route error payload sends", () => {
    const manualErrorSendPattern = /rep\.code\([^)]*\)\.send\(\{\s*error\s*:/m;
    const offenders = listTypeScriptFiles(routeRoot)
      .filter((filePath) => manualErrorSendPattern.test(readText(filePath)));

    expect(offenders).toEqual([]);
  });
});
