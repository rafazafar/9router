import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zrouter-users-"));
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

describe("multi-user database", () => {
  it("seeds admin and forces login", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const admin = await db.getUserByUsername("admin");
    expect(admin).toMatchObject({ id: "admin", role: "admin", status: "active", sessionVersion: 1 });
    expect((await db.getSettings()).requireLogin).toBe(true);
  });

  it("scopes connections through ownership and exact grants", async () => {
    const db = await import("@/lib/db/index.js");
    const alice = await db.createUser({ username: "alice", password: "secure-password" });
    const bob = await db.createUser({ username: "bob", password: "secure-password" });
    const adminConnection = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "admin-openai", apiKey: "admin-key", ownerUserId: "admin" });
    const aliceConnection = await db.createProviderConnection({ provider: "anthropic", authType: "apikey", name: "alice-anthropic", apiKey: "alice-key", ownerUserId: alice.id });

    expect((await db.getAccessibleProviderConnections({ userId: alice.id, role: "member" })).map((item) => item.id)).toEqual([aliceConnection.id]);
    await db.grantConnection(adminConnection.id, alice.id, "admin");
    expect(new Set((await db.getAccessibleProviderConnections({ userId: alice.id, role: "member" })).map((item) => item.id))).toEqual(new Set([adminConnection.id, aliceConnection.id]));
    expect(await db.getAccessibleProviderConnections({ userId: bob.id, role: "member" })).toEqual([]);
    expect((await db.getAccessibleProviderConnections({ userId: "admin", role: "admin" })).length).toBe(2);
  });

  it("intersects API-key policy with current owner access", async () => {
    const db = await import("@/lib/db/index.js");
    const { getEffectiveApiKeyConnectionIds } = await import("@/lib/auth/authorization.js");
    const member = await db.createUser({ username: "member", password: "secure-password" });
    const own = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "own", apiKey: "own-key", ownerUserId: member.id });
    const hidden = await db.createProviderConnection({ provider: "anthropic", authType: "apikey", name: "hidden", apiKey: "hidden-key", ownerUserId: "admin" });
    const key = await db.createApiKey("member-key", "machine", { ownerUserId: member.id, allowedConnectionIds: [own.id, hidden.id] });

    expect(await getEffectiveApiKeyConnectionIds(key)).toEqual([own.id]);
  });

  it("reorders priorities within each owner boundary", async () => {
    const db = await import("@/lib/db/index.js");
    const member = await db.createUser({ username: "priority-member", password: "secure-password" });
    const adminFirst = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "admin-first", apiKey: "admin-1", ownerUserId: "admin" });
    const adminSecond = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "admin-second", apiKey: "admin-2", ownerUserId: "admin" });
    const memberFirst = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "member-first", apiKey: "member-1", ownerUserId: member.id });
    const memberSecond = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "member-second", apiKey: "member-2", ownerUserId: member.id });

    await db.updateProviderConnection(memberSecond.id, { priority: 1 });

    expect((await db.getProviderConnectionById(memberSecond.id)).priority).toBe(1);
    expect((await db.getProviderConnectionById(memberFirst.id)).priority).toBe(2);
    expect((await db.getProviderConnectionById(adminFirst.id)).priority).toBe(1);
    expect((await db.getProviderConnectionById(adminSecond.id)).priority).toBe(2);
  });

  it("keeps legacy null-owner priorities isolated", async () => {
    const db = await import("@/lib/db/index.js");
    const member = await db.createUser({ username: "legacy-priority-member", password: "secure-password" });
    const memberConnection = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "member", apiKey: "member", ownerUserId: member.id });
    const legacyFirst = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "legacy-first", apiKey: "legacy-1" });
    const legacySecond = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "legacy-second", apiKey: "legacy-2", priority: 1 });

    await db.reorderProviderConnections("openai");

    expect((await db.getProviderConnectionById(legacySecond.id)).priority).toBe(1);
    expect((await db.getProviderConnectionById(legacyFirst.id)).priority).toBe(2);
    expect((await db.getProviderConnectionById(memberConnection.id)).priority).toBe(1);
  });

  it("normalizes priority when create deduplicates an owned connection", async () => {
    const db = await import("@/lib/db/index.js");
    const member = await db.createUser({ username: "dedup-priority-member", password: "secure-password" });
    const first = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "first", apiKey: "first", ownerUserId: member.id });
    const second = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "second", apiKey: "second", ownerUserId: member.id });

    const updated = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "second", apiKey: "replacement", ownerUserId: member.id, priority: 1 });

    expect(updated.id).toBe(second.id);
    expect((await db.getProviderConnectionById(second.id)).priority).toBe(1);
    expect((await db.getProviderConnectionById(first.id)).priority).toBe(2);
  });

  it("removes grants when deleting every connection for a provider", async () => {
    const db = await import("@/lib/db/index.js");
    const member = await db.createUser({ username: "bulk-delete-member", password: "secure-password" });
    const connection = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "shared", apiKey: "shared", ownerUserId: "admin" });
    await db.grantConnection(connection.id, member.id, "admin");

    expect(await db.deleteProviderConnectionsByProvider("openai")).toBe(1);
    expect(await db.getConnectionGrants(connection.id)).toEqual([]);
  });

  it("persists OAuth state ownership in SQLite", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const { bindOAuthOwner, isOAuthOwner } = await import("@/lib/oauth/ownerState.js");
    await bindOAuthOwner("state-1", "admin");
    expect(await isOAuthOwner("state-1", "admin")).toBe(true);
    expect(await isOAuthOwner("state-1", "someone-else")).toBe(false);
    expect(await isOAuthOwner("state-1", "admin")).toBe(true);
    expect(await isOAuthOwner("state-1", "admin", { consume: true })).toBe(true);
    expect(await isOAuthOwner("state-1", "admin")).toBe(false);
    expect(await isOAuthOwner("state-1", "admin", { consume: true })).toBe(false);
  });

  it("allows exactly one concurrent OAuth state consumer", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const { bindOAuthOwner, isOAuthOwner } = await import("@/lib/oauth/ownerState.js");
    await bindOAuthOwner("state-concurrent", "admin");

    const consumed = await Promise.all([
      isOAuthOwner("state-concurrent", "admin", { consume: true }),
      isOAuthOwner("state-concurrent", "admin", { consume: true }),
    ]);

    expect(consumed.sort()).toEqual([false, true]);
  });

  it("only resolves an unambiguous active OIDC invitation", async () => {
    const db = await import("@/lib/db/index.js");
    const first = await db.createUser({ username: "oidc-first", email: "member@example.com" });
    expect((await db.getInvitedOidcUserByEmail("MEMBER@example.com"))?.id).toBe(first.id);

    await db.updateUser(first.id, { status: "disabled" });
    expect(await db.getInvitedOidcUserByEmail("member@example.com")).toBeNull();

    await db.updateUser(first.id, { status: "active" });
    await db.createUser({ username: "oidc-second", email: "member@example.com" });
    expect(await db.getInvitedOidcUserByEmail("member@example.com")).toBeNull();
  });

  it("binds an OIDC invitation exactly once", async () => {
    const db = await import("@/lib/db/index.js");
    const invited = await db.createUser({ username: "oidc-race", email: "race@example.com" });

    const bindings = await Promise.all([
      db.bindUserOidcIdentity(invited.id, "https://issuer.example", "subject-one"),
      db.bindUserOidcIdentity(invited.id, "https://issuer.example", "subject-two"),
    ]);

    expect(bindings.filter(Boolean)).toHaveLength(1);
    const bound = await db.getUserById(invited.id);
    expect(["subject-one", "subject-two"]).toContain(bound.oidcSubject);
    expect(bound.sessionVersion).toBe(2);
  });

  it("normalizes OIDC issuers for binding and lookup", async () => {
    const db = await import("@/lib/db/index.js");
    const invited = await db.createUser({ username: "oidc-normalized", email: "normalized@example.com" });
    await db.bindUserOidcIdentity(invited.id, "https://issuer.example/", "normalized-subject");

    expect((await db.getUserByOidcIdentity("https://issuer.example", "normalized-subject"))?.id).toBe(invited.id);
    expect((await db.getUserByOidcIdentity("https://issuer.example/", "normalized-subject"))?.id).toBe(invited.id);
  });

  it("migrates a legacy OIDC issuer only for the exact bound identity", async () => {
    const db = await import("@/lib/db/index.js");
    const invited = await db.createUser({ username: "oidc-canonical", email: "canonical@example.com" });
    await db.bindUserOidcIdentity(invited.id, "https://login.example.com/tenant", "canonical-subject");

    expect(await db.migrateUserOidcIssuer(invited.id, "https://login.example.com/tenant", "wrong-subject", "https://sts.example.com/tenant")).toBeNull();
    const migrated = await db.migrateUserOidcIssuer(invited.id, "https://login.example.com/tenant", "canonical-subject", "https://sts.example.com/tenant");
    expect(migrated).toMatchObject({ id: invited.id, oidcIssuer: "https://sts.example.com/tenant", oidcSubject: "canonical-subject" });
  });

  it("filters usage and request details by user", async () => {
    const db = await import("@/lib/db/index.js");
    const member = await db.createUser({ username: "usage-member", password: "secure-password" });
    await db.saveRequestUsage({ provider: "openai", model: "gpt", tokens: { prompt_tokens: 2 }, userId: member.id });
    await db.saveRequestUsage({ provider: "anthropic", model: "claude", tokens: { prompt_tokens: 3 }, userId: "admin" });
    expect((await db.getUsageHistory({ userId: member.id })).map((entry) => entry.provider)).toEqual(["openai"]);
  });

  it("merges isolated per-user Token Saver overrides with global defaults", async () => {
    const db = await import("@/lib/db/index.js");
    const alice = await db.createUser({ username: "token-alice", password: "secure-password" });
    const bob = await db.createUser({ username: "token-bob", password: "secure-password" });
    const globalSettings = await db.updateSettings({ rtkEnabled: true, cavemanEnabled: false, pxpipeMinChars: 25000 });

    await db.updateUserTokenSaverSettings(alice.id, { rtkEnabled: false, cavemanEnabled: true, cavemanLevel: "ultra" });

    expect(await db.getEffectiveUserTokenSaverSettings(alice.id, globalSettings)).toMatchObject({ rtkEnabled: false, cavemanEnabled: true, cavemanLevel: "ultra", pxpipeMinChars: 25000 });
    expect(await db.getEffectiveUserTokenSaverSettings(bob.id, globalSettings)).toMatchObject({ rtkEnabled: true, cavemanEnabled: false, pxpipeMinChars: 25000 });
    await expect(db.updateUserTokenSaverSettings(alice.id, { headroomUrl: "https://evil.example" })).resolves.toEqual(expect.not.objectContaining({ headroomUrl: expect.anything() }));
    await expect(db.updateUserTokenSaverSettings(alice.id, { pxpipeMinChars: -1 })).rejects.toThrow("pxpipeMinChars");
  });

  it("preserves member password hashes through database export and import", async () => {
    const db = await import("@/lib/db/index.js");
    const member = await db.createUser({ username: "backup-member", password: "secure-password" });
    const before = await db.getUserById(member.id, { includePassword: true });
    const snapshot = await db.exportDb();

    expect(snapshot.users.find((user) => user.id === member.id)?.passwordHash).toBe(before.passwordHash);

    await db.importDb(snapshot);
    expect((await db.getUserById(member.id, { includePassword: true })).passwordHash).toBe(before.passwordHash);
    expect((await db.getSettings()).requireLogin).toBe(true);
  });

  it("invalidates sessions and disables users absent from an imported backup", async () => {
    const db = await import("@/lib/db/index.js");
    const restored = await db.createUser({ username: "restored-member", password: "secure-password" });
    const snapshot = await db.exportDb();
    const omitted = await db.createUser({ username: "omitted-member", password: "secure-password" });
    await db.updateUser(restored.id, { revokeSessions: true });
    const liveVersion = (await db.getUserById(restored.id)).sessionVersion;

    await db.importDb(snapshot);

    expect((await db.getUserById(restored.id)).sessionVersion).toBeGreaterThan(liveVersion);
    expect(await db.getUserById(omitted.id)).toMatchObject({ status: "disabled" });
    expect((await db.getUserById(omitted.id)).sessionVersion).toBeGreaterThan(omitted.sessionVersion);
  });

  it("returns isolated time-series charts and attributed failure logs", async () => {
    const db = await import("@/lib/db/index.js");
    const member = await db.createUser({ username: "chart-member", password: "secure-password" });
    await db.updateSettings({ observabilityBatchSize: 1 });
    await db.saveRequestUsage({ provider: "openai", model: "gpt", tokens: { prompt_tokens: 7 }, userId: member.id });
    await db.saveRequestUsage({ provider: "anthropic", model: "claude", tokens: { prompt_tokens: 11 }, userId: "admin" });
    await db.saveRequestDetail({
      provider: "openai", model: "gpt", userId: member.id, status: "error",
      response: { status: 429, error: "rate limited" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const chart = await db.getChartData("7d", { userId: member.id });
    expect(chart).toHaveLength(7);
    expect(chart.reduce((sum, bucket) => sum + bucket.tokens, 0)).toBe(7);
    const minuteChart = await db.getChartData("1m", { userId: member.id });
    expect(minuteChart).toHaveLength(12);
    expect(minuteChart.reduce((sum, bucket) => sum + bucket.tokens, 0)).toBe(7);
    expect(await db.getChartData("5m", { userId: member.id })).toHaveLength(10);
    expect(await db.getChartData("1h", { userId: member.id })).toHaveLength(12);
    expect((await db.getUserUsageStats(member.id, "1m")).totalRequests).toBe(1);
    expect(await db.getRecentLogs(20, { userId: member.id })).toEqual(expect.arrayContaining([expect.stringContaining("FAILED 429")]));
  });
});
