import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let db;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zrouter-provider-order-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("personal provider connection order", () => {
  it("orders all accessible accounts for one user without changing owner priorities", async () => {
    const member = await db.createUser({ username: "order-member", password: "secure-password" });
    const adminFirst = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "admin-first", apiKey: "1", ownerUserId: "admin" });
    const adminSecond = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "admin-second", apiKey: "2", ownerUserId: "admin" });
    const memberAccount = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "member", apiKey: "3", ownerUserId: member.id });

    await db.setUserProviderConnectionOrder("admin", "openai", [adminSecond.id, memberAccount.id, adminFirst.id]);
    const all = await db.getProviderConnections({ provider: "openai" });
    const ordered = await db.applyUserProviderConnectionOrder(all, "admin", "openai");

    expect(ordered.map((connection) => connection.id)).toEqual([adminSecond.id, memberAccount.id, adminFirst.id]);
    expect((await db.getProviderConnectionById(adminFirst.id)).priority).toBe(1);
    expect((await db.getProviderConnectionById(adminSecond.id)).priority).toBe(2);
    expect((await db.getProviderConnectionById(memberAccount.id)).priority).toBe(1);
  });

  it("isolates orders between users and resets to default priority", async () => {
    const member = await db.createUser({ username: "isolated-member", password: "secure-password" });
    const first = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "first", apiKey: "1", ownerUserId: "admin" });
    const second = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "second", apiKey: "2", ownerUserId: "admin" });
    await db.grantConnection(first.id, member.id, "admin");
    await db.grantConnection(second.id, member.id, "admin");

    await db.setUserProviderConnectionOrder(member.id, "openai", [second.id, first.id]);
    const connections = await db.getProviderConnections({ provider: "openai" });
    expect((await db.applyUserProviderConnectionOrder(connections, member.id, "openai")).map((item) => item.id)).toEqual([second.id, first.id]);
    expect((await db.applyUserProviderConnectionOrder(connections, "admin", "openai")).map((item) => item.id)).toEqual([first.id, second.id]);

    await db.resetUserProviderConnectionOrder(member.id, "openai");
    expect(await db.hasUserProviderConnectionOrder(member.id, "openai")).toBe(false);
    expect((await db.applyUserProviderConnectionOrder(connections, member.id, "openai")).map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it("rejects inaccessible, duplicate, or incomplete account lists", async () => {
    const member = await db.createUser({ username: "validation-member", password: "secure-password" });
    const own = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "own", apiKey: "1", ownerUserId: member.id });
    const hidden = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "hidden", apiKey: "2", ownerUserId: "admin" });

    await expect(db.setUserProviderConnectionOrder(member.id, "openai", [own.id, hidden.id])).rejects.toThrow("exactly match");
    await expect(db.setUserProviderConnectionOrder(member.id, "openai", [own.id, own.id])).rejects.toThrow("unique");
    await expect(db.setUserProviderConnectionOrder("admin", "openai", [own.id])).rejects.toThrow("exactly match");
  });

  it("removes stale ranks when a connection or user is deleted", async () => {
    const member = await db.createUser({ username: "cleanup-member", password: "secure-password" });
    const first = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "first", apiKey: "1", ownerUserId: "admin" });
    const second = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "second", apiKey: "2", ownerUserId: "admin" });
    await db.grantConnection(first.id, member.id, "admin");
    await db.grantConnection(second.id, member.id, "admin");
    await db.setUserProviderConnectionOrder(member.id, "openai", [second.id, first.id]);

    await db.deleteProviderConnection(second.id);
    expect(await db.getUserProviderConnectionOrder(member.id, "openai")).toEqual([first.id]);
    await db.deleteUser(member.id);
    expect(await db.getUserProviderConnectionOrder(member.id, "openai")).toEqual([]);
  });

  it("clears a provider order when access grants change", async () => {
    const member = await db.createUser({ username: "grant-member", password: "secure-password" });
    const first = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "first", apiKey: "1", ownerUserId: "admin" });
    const second = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "second", apiKey: "2", ownerUserId: "admin" });
    await db.grantConnection(first.id, member.id, "admin");
    await db.grantConnection(second.id, member.id, "admin");
    await db.setUserProviderConnectionOrder(member.id, "openai", [second.id, first.id]);

    await db.revokeConnectionGrant(second.id, member.id);
    expect(await db.hasUserProviderConnectionOrder(member.id, "openai")).toBe(false);

    await db.grantConnection(second.id, member.id, "admin");
    await db.setUserProviderConnectionOrder(member.id, "openai", [second.id, first.id]);
    await db.replaceConnectionGrants(member.id, [first.id], "admin");
    expect(await db.hasUserProviderConnectionOrder(member.id, "openai")).toBe(false);
  });
});
