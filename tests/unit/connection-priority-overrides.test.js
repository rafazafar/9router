import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zrouter-conn-priority-"));
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

async function seedConnections() {
  const { createProviderConnection } = await import("@/lib/db/repos/connectionsRepo.js");
  const mine = await createProviderConnection({ provider: "testp", authType: "apikey", name: "mine", apiKey: "k1", ownerUserId: "admin" });
  const memberA = await createProviderConnection({ provider: "testp", authType: "apikey", name: "memberA", apiKey: "k2", ownerUserId: "member1" });
  const memberB = await createProviderConnection({ provider: "testp", authType: "apikey", name: "memberB", apiKey: "k3", ownerUserId: "member1" });
  return { mine, memberA, memberB };
}

describe("connection priority overrides", () => {
  it("set/get/clear overrides per user", async () => {
    const { mine, memberA } = await seedConnections();
    const { getConnectionPriorityOverrides, setConnectionPriorityOverride } = await import("@/lib/db/repos/connectionPriorityOverridesRepo.js");

    expect((await getConnectionPriorityOverrides("admin")).size).toBe(0);

    await setConnectionPriorityOverride("admin", memberA.id, 1);
    let overrides = await getConnectionPriorityOverrides("admin");
    expect(overrides.get(memberA.id)).toBe(1);
    expect(overrides.has(mine.id)).toBe(false);

    // Other user's view unaffected
    expect((await getConnectionPriorityOverrides("member1")).size).toBe(0);

    await setConnectionPriorityOverride("admin", memberA.id, null);
    overrides = await getConnectionPriorityOverrides("admin");
    expect(overrides.size).toBe(0);
  });

  it("rejects invalid priority values", async () => {
    const { memberA } = await seedConnections();
    const { setConnectionPriorityOverride } = await import("@/lib/db/repos/connectionPriorityOverridesRepo.js");
    await expect(setConnectionPriorityOverride("admin", memberA.id, 0)).rejects.toThrow();
    await expect(setConnectionPriorityOverride("admin", memberA.id, 1.5)).rejects.toThrow();
    await expect(setConnectionPriorityOverride("admin", "nonexistent", 1)).rejects.toThrow();
  });

  it("normalizes override sequence per provider", async () => {
    const { memberA, memberB } = await seedConnections();
    const { getConnectionPriorityOverrides, setConnectionPriorityOverride } = await import("@/lib/db/repos/connectionPriorityOverridesRepo.js");

    await setConnectionPriorityOverride("admin", memberA.id, 5);
    await setConnectionPriorityOverride("admin", memberB.id, 9);
    const overrides = await getConnectionPriorityOverrides("admin");
    // Dense 1..N ordered by requested value
    expect([...overrides.values()].sort()).toEqual([1, 2]);
    expect(overrides.get(memberA.id)).toBe(1);
    expect(overrides.get(memberB.id)).toBe(2);
  });

  it("deletes overrides when connection or user is deleted", async () => {
    const { memberA } = await seedConnections();
    const { getConnectionPriorityOverrides, setConnectionPriorityOverride } = await import("@/lib/db/repos/connectionPriorityOverridesRepo.js");
    const { deleteProviderConnection } = await import("@/lib/db/repos/connectionsRepo.js");

    await setConnectionPriorityOverride("admin", memberA.id, 1);
    expect((await getConnectionPriorityOverrides("admin")).size).toBe(1);

    await deleteProviderConnection(memberA.id);
    expect((await getConnectionPriorityOverrides("admin")).size).toBe(0);
  });
});

describe("applyPriorityOverrides", () => {
  it("sinks overridden connections below all non-overridden ones", async () => {
    const { applyPriorityOverrides } = await import("@/lib/db/repos/connectionPriorityOverridesRepo.js");
    const conns = [
      { id: "a", priority: 1 },
      { id: "b", priority: 2 },
      { id: "c", priority: 3 },
    ];
    const overrides = new Map([["a", 1]]); // admin deprioritizes their top account
    const ordered = applyPriorityOverrides(conns, overrides);
    expect(ordered.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("orders multiple overrides by override value, keeps stable order otherwise", async () => {
    const { applyPriorityOverrides } = await import("@/lib/db/repos/connectionPriorityOverridesRepo.js");
    const conns = [
      { id: "a", priority: 1 },
      { id: "b", priority: 2 },
      { id: "c", priority: 3 },
      { id: "d", priority: 4 },
    ];
    const overrides = new Map([["c", 2], ["a", 1]]);
    const ordered = applyPriorityOverrides(conns, overrides);
    expect(ordered.map((c) => c.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("returns the original array reference when no overrides", async () => {
    const { applyPriorityOverrides } = await import("@/lib/db/repos/connectionPriorityOverridesRepo.js");
    const conns = [{ id: "a", priority: 1 }];
    expect(applyPriorityOverrides(conns, new Map())).toBe(conns);
  });
});
