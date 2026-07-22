import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zrouter-api-key-policy-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API key policies", () => {
  it("stores limits and provider account allowlist", async () => {
    const { createApiKey, getApiKeyById, updateApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await createApiKey("limited", "machine", {
      dailyRequestLimit: 10,
      dailyTokenLimit: 2000,
      allowedConnectionIds: ["account-1", "account-1", "account-2"],
    });

    expect(key).toMatchObject({
      dailyRequestLimit: 10,
      dailyTokenLimit: 2000,
      allowedConnectionIds: ["account-1", "account-2"],
    });

    await updateApiKey(key.id, { dailyRequestLimit: null, allowedConnectionIds: [] });
    expect(await getApiKeyById(key.id)).toMatchObject({
      dailyRequestLimit: null,
      dailyTokenLimit: 2000,
      allowedConnectionIds: [],
    });
  });

  it("atomically enforces daily request limit", async () => {
    const { createApiKey, reserveApiKeyRequest } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await createApiKey("limited", "machine", { dailyRequestLimit: 2 });

    expect((await reserveApiKeyRequest(key.key)).allowed).toBe(true);
    expect((await reserveApiKeyRequest(key.key)).allowed).toBe(true);
    expect(await reserveApiKeyRequest(key.key)).toMatchObject({ allowed: false, reason: "requests" });
  });

  it("blocks at token cap and resets stale counters", async () => {
    const { createApiKey, reserveApiKeyRequest } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const key = await createApiKey("tokens", "machine", { dailyTokenLimit: 100 });
    const db = await getAdapter();

    db.run(`UPDATE apiKeys SET tokenCount = 100 WHERE id = ?`, [key.id]);
    expect(await reserveApiKeyRequest(key.key)).toMatchObject({ allowed: false, reason: "tokens" });

    db.run(`UPDATE apiKeys SET tokenCount = 100, requestCount = 5, quotaDate = '2000-01-01' WHERE id = ?`, [key.id]);
    const reset = await reserveApiKeyRequest(key.key);
    expect(reset).toMatchObject({ allowed: true });
    expect(reset.apiKey).toMatchObject({ tokenCount: 0, requestCount: 1 });
  });

  it("rejects invalid limits", async () => {
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    await expect(createApiKey("bad", "machine", { dailyRequestLimit: 0 })).rejects.toThrow("positive integers");
  });
});
