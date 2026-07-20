// Verify schema migration chain runs correctly across versions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mig-"));
  process.env.DATA_DIR = tempDir;
  // Reset global singleton so each test gets fresh adapter pointed at tempDir
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  // Close adapter to release file handles before rm
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Schema migrations", () => {
  it("fresh DB → applies migrations & stamps schemaVersion", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map(t => t.name);
    expect(tables).toEqual(expect.arrayContaining([
      "_meta", "settings", "providerConnections", "providerNodes",
      "proxyPools", "apiKeys", "users", "connectionGrants", "oauthStates", "combos", "kv", "usageHistory", "usageDaily", "requestDetails",
    ]));
  });

  it("backfills existing usage ownership and keeps legacy OIDC-only installs recoverable", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const now = new Date().toISOString();
    db.run(`INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt, ownerUserId) VALUES('legacy-conn', 'openai', 'apikey', 'legacy', 1, 1, '{}', ?, ?, 'admin')`, [now, now]);
    db.run(`INSERT INTO usageHistory(timestamp, provider, model, connectionId, tokens, meta, userId) VALUES(?, 'openai', 'gpt', 'legacy-conn', '{}', '{}', NULL)`, [now]);
    db.run(`INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, data, userId) VALUES('legacy-detail', ?, 'openai', 'gpt', 'legacy-conn', '{}', NULL)`, [now]);
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [JSON.stringify({ authMode: "oidc", requireLogin: false })]);
    db.run(`UPDATE users SET email = NULL, oidcIssuer = NULL, oidcSubject = NULL WHERE id = 'admin'`);
    db.run(`UPDATE _meta SET value = '5' WHERE key = 'schemaVersion'`);
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();

    expect(db2.get(`SELECT userId FROM usageHistory WHERE connectionId = 'legacy-conn'`)?.userId).toBe("admin");
    expect(db2.get(`SELECT userId FROM requestDetails WHERE id = 'legacy-detail'`)?.userId).toBe("admin");
    expect(JSON.parse(db2.get(`SELECT data FROM settings WHERE id = 1`).data)).toMatchObject({ authMode: "both", requireLogin: true });
  });

  it("existing DB at older schemaVersion → re-applies pending migrations on restart", async () => {
    // 1st boot
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, ['{"foo":"bar"}']);
    db.run(`UPDATE _meta SET value = '0' WHERE key = 'schemaVersion'`);
    db.close?.();

    // 2nd boot: full reset to simulate process restart
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db2 = await getAdapter2();
    const row = db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const settings = db2.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "bar" });
  });

  it("fresh DB + legacy db.json → imports data automatically", async () => {
    // Simulate user upgrading: place legacy JSON in DATA_DIR before first boot
    const legacy = {
      settings: {
        foo: "legacy-value",
        requireLogin: false,
        password: "$2b$10$legacy-password-hash",
        oidcIssuerUrl: "https://issuer.example/",
        oidcSubject: "legacy-subject",
        oidcEmail: "admin@example.com",
      },
      apiKeys: [{ id: "k1", key: "abc", name: "test", createdAt: new Date().toISOString() }],
      providerConnections: [{ id: "c1", provider: "openai", authType: "apikey", name: "legacy", apiKey: "secret", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      modelAliases: { "gpt-4": "gpt-4-turbo" },
    };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(legacy));
    fs.writeFileSync(path.join(tempDir, "usage.json"), JSON.stringify({
      history: [{ timestamp: new Date().toISOString(), provider: "openai", model: "gpt", connectionId: "c1", tokens: { prompt_tokens: 2 } }],
    }));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const settings = db.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toMatchObject({ foo: "legacy-value", requireLogin: true });

    const admin = db.get(`SELECT * FROM users WHERE id = 'admin'`);
    expect(admin).toMatchObject({
      passwordHash: "$2b$10$legacy-password-hash",
      email: "admin@example.com",
      oidcIssuer: "https://issuer.example",
      oidcSubject: "legacy-subject",
    });

    const keys = db.all(`SELECT * FROM apiKeys`);
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe("abc");
    expect(keys[0].ownerUserId).toBe("admin");

    expect(db.get(`SELECT ownerUserId FROM providerConnections WHERE id = 'c1'`)?.ownerUserId).toBe("admin");
    expect(db.get(`SELECT userId FROM usageHistory WHERE connectionId = 'c1'`)?.userId).toBe("admin");

    const aliases = db.all(`SELECT * FROM kv WHERE scope='modelAliases'`);
    expect(aliases).toHaveLength(1);
  });

  it("keeps fresh legacy OIDC-only installs recoverable without a known identity", async () => {
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify({
      settings: { authMode: "oidc", requireLogin: false, password: "$2b$10$legacy-password-hash" },
    }));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const settings = JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data);

    expect(settings).toMatchObject({ authMode: "both", requireLogin: true });
    expect(db.get(`SELECT passwordHash FROM users WHERE id = 'admin'`)?.passwordHash).toBe("$2b$10$legacy-password-hash");
  });

  it("keeps email-only legacy OIDC installs recoverable through password login", async () => {
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify({
      settings: {
        authMode: "oidc",
        requireLogin: false,
        password: "$2b$10$legacy-password-hash",
        oidcIssuerUrl: "https://login.example.com/tenant",
        oidcAdminEmail: "admin@example.com",
      },
    }));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const settings = JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data);

    expect(settings).toMatchObject({ authMode: "both", requireLogin: true });
    expect(db.get(`SELECT email, oidcSubject FROM users WHERE id = 'admin'`)).toMatchObject({ email: "admin@example.com", oidcSubject: null });
  });

  it("repairs null connection and API-key owners when upgrading from schema v6", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const now = new Date().toISOString();
    db.run(`INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt, ownerUserId) VALUES('orphan-conn', 'openai', 'apikey', 'orphan', 1, '{}', ?, ?, NULL)`, [now, now]);
    db.run(`INSERT INTO apiKeys(id, key, name, isActive, createdAt, allowedConnectionIds, ownerUserId) VALUES('orphan-key', 'sk-orphan', 'orphan', 1, ?, '[]', NULL)`, [now]);
    db.run(`UPDATE _meta SET value = '6' WHERE key = 'schemaVersion'`);
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const repaired = await getAdapter2();

    expect(repaired.get(`SELECT ownerUserId FROM providerConnections WHERE id = 'orphan-conn'`)?.ownerUserId).toBe("admin");
    expect(repaired.get(`SELECT ownerUserId FROM apiKeys WHERE id = 'orphan-key'`)?.ownerUserId).toBe("admin");
  });

  it("preserves OIDC-only mode when schema v6 has a durable admin identity", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [JSON.stringify({ authMode: "oidc", requireLogin: true, oidcIssuerUrl: "https://login.example.com/tenant" })]);
    db.run(`UPDATE users SET oidcIssuer = 'https://login.example.com/tenant', oidcSubject = 'admin-subject', passwordHash = NULL WHERE id = 'admin'`);
    db.run(`UPDATE _meta SET value = '6' WHERE key = 'schemaVersion'`);
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const upgraded = await getAdapter2();

    expect(JSON.parse(upgraded.get(`SELECT data FROM settings WHERE id = 1`).data)).toMatchObject({ authMode: "oidc", requireLogin: true });
  });

  it("auto-sync re-creates missing index when DB lacks it", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.exec(`DROP INDEX IF EXISTS idx_pn_type`);
    expect(db.all(`PRAGMA index_list(providerNodes)`).map(i => i.name)).not.toContain("idx_pn_type");
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const idx = db2.all(`PRAGMA index_list(providerNodes)`).map(i => i.name);
    expect(idx).toContain("idx_pn_type");
  });
});
