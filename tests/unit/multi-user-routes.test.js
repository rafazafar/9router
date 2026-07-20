import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let db;
let alice;
let bob;
let admin;
let adminConnection;
let aliceConnection;
const originalDataDir = process.env.DATA_DIR;

async function requestFor(user, url, init = {}) {
  const { createDashboardAuthToken, dashboardClaimsForUser } = await import("@/lib/auth/dashboardSession.js");
  const token = await createDashboardAuthToken(dashboardClaimsForUser(user));
  const headers = new Headers(init.headers);
  headers.set("cookie", `auth_token=${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-user-routes-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();

  db = await import("@/lib/db/index.js");
  await db.initDb();
  admin = await db.getUserById("admin");
  alice = await db.createUser({ username: "alice-routes", password: "secure-password" });
  bob = await db.createUser({ username: "bob-routes", password: "secure-password" });
  adminConnection = await db.createProviderConnection({
    provider: "anthropic",
    authType: "apikey",
    name: "admin-anthropic",
    apiKey: "admin-secret",
    ownerUserId: admin.id,
    providerSpecificData: { access_token: "nested-secret", region: "us" },
  });
  aliceConnection = await db.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "alice-openai",
    apiKey: "alice-secret",
    ownerUserId: alice.id,
  });
  await db.grantConnection(adminConnection.id, alice.id, admin.id);
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("multi-user provider routes", () => {
  it("hides stale-session roles and reports local-password capability", async () => {
    const statusRoute = await import("@/app/api/auth/status/route.js");
    const accountRoute = await import("@/app/api/account/route.js");
    const oidcOnly = await db.createUser({ username: "oidc-only-routes", email: "oidc-only@example.com" });

    const oidcAccountResponse = await accountRoute.GET(await requestFor(oidcOnly, "http://localhost/api/account"));
    expect(await oidcAccountResponse.json()).toMatchObject({ hasPassword: false, user: { id: oidcOnly.id } });

    const staleRequest = await requestFor(alice, "http://localhost/api/auth/status");
    expect(await statusRoute.GET(staleRequest).then((response) => response.json())).toMatchObject({ authenticated: true, user: { role: "member" } });
    await db.updateUser(alice.id, { role: "admin" });
    expect(await statusRoute.GET(staleRequest).then((response) => response.json())).toMatchObject({ authenticated: false, user: null });
  });

  it("requires an administrator for global connection infrastructure handlers", async () => {
    const providerNodes = await import("@/app/api/provider-nodes/route.js");
    const proxyPools = await import("@/app/api/proxy-pools/route.js");
    const aliases = await import("@/app/api/models/alias/route.js");
    const kiroAutoImport = await import("@/app/api/oauth/kiro/auto-import/route.js");

    expect((await providerNodes.GET(await requestFor(alice, "http://localhost/api/provider-nodes"))).status).toBe(403);
    expect((await proxyPools.GET(await requestFor(alice, "http://localhost/api/proxy-pools"))).status).toBe(403);
    expect((await aliases.GET(await requestFor(alice, "http://localhost/api/models/alias"))).status).toBe(403);
    expect((await kiroAutoImport.GET(await requestFor(alice, "http://localhost/api/oauth/kiro/auto-import"))).status).toBe(403);
  });

  it("rejects members and spoofed CLI headers on global and host-control handlers", async () => {
    const memberRequest = await requestFor(alice, "http://localhost/api/combos");
    const combos = await import("@/app/api/combos/route.js");
    const customModels = await import("@/app/api/models/custom/route.js");
    const disabledModels = await import("@/app/api/models/disabled/route.js");
    const pricing = await import("@/app/api/pricing/route.js");
    const translator = await import("@/app/api/translator/load/route.js");
    const mediaVoices = await import("@/app/api/media-providers/tts/elevenlabs/voices/route.js");
    const resetPassword = await import("@/app/api/auth/reset-password/route.js");
    const shutdown = await import("@/app/api/version/shutdown/route.js");
    const database = await import("@/app/api/settings/database/route.js");

    expect((await combos.GET(memberRequest)).status).toBe(403);
    expect((await customModels.GET(await requestFor(alice, "http://localhost/api/models/custom"))).status).toBe(403);
    expect((await disabledModels.GET(await requestFor(alice, "http://localhost/api/models/disabled"))).status).toBe(403);
    expect((await pricing.GET(await requestFor(alice, "http://localhost/api/pricing"))).status).toBe(403);
    expect((await translator.GET(await requestFor(alice, "http://localhost/api/translator/load?file=1_req_client.json"))).status).toBe(403);
    expect((await mediaVoices.GET(await requestFor(alice, "http://localhost/api/media-providers/tts/elevenlabs/voices"))).status).toBe(403);
    expect((await resetPassword.POST(await requestFor(alice, "http://localhost/api/auth/reset-password", { method: "POST" }))).status).toBe(403);
    expect((await shutdown.POST(await requestFor(alice, "http://localhost/api/version/shutdown", { method: "POST" }))).status).toBe(403);

    const spoofedCli = new Request("http://localhost/api/settings/database", {
      headers: { "x-9r-cli-token": "attacker-controlled" },
    });
    expect((await database.GET(spoofedCli)).status).toBe(401);
  });

  it("accepts a valid machine CLI token through route-level authorization", async () => {
    const { getConsistentMachineId } = await import("@/shared/utils/machineId.js");
    const token = await getConsistentMachineId("9r-cli-auth");
    const providers = await import("@/app/api/providers/route.js");
    const response = await providers.GET(new Request("http://localhost/api/providers", {
      headers: { "x-9r-cli-token": token },
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).connections).toHaveLength(2);
  });

  it("blocks members before provider-node validation can make network requests", async () => {
    const route = await import("@/app/api/provider-nodes/validate/route.js");
    const fetchSpy = vi.spyOn(global, "fetch");
    const response = await route.POST(await requestFor(alice, "http://localhost/api/provider-nodes/validate", {
      method: "POST",
      body: JSON.stringify({ baseUrl: "http://127.0.0.1:11434", apiKey: "secret", type: "openai-compatible" }),
    }));

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("invalidates existing sessions after disablement or session revocation", async () => {
    const route = await import("@/app/api/providers/route.js");
    const requestBeforeDisable = await requestFor(alice, "http://localhost/api/providers");
    expect((await route.GET(requestBeforeDisable)).status).toBe(200);

    await db.updateUser(alice.id, { status: "disabled" });
    expect((await route.GET(requestBeforeDisable)).status).toBe(401);

    const reactivated = await db.updateUser(alice.id, { status: "active" });
    const requestBeforeRevoke = await requestFor(reactivated, "http://localhost/api/providers");
    expect((await route.GET(requestBeforeRevoke)).status).toBe(200);

    await db.updateUser(alice.id, { revokeSessions: true });
    expect((await route.GET(requestBeforeRevoke)).status).toBe(401);

    const current = await db.getUserById(alice.id);
    const requestBeforeRoleChange = await requestFor(current, "http://localhost/api/providers");
    await db.updateUser(alice.id, { role: "admin" });
    expect((await route.GET(requestBeforeRoleChange)).status).toBe(401);
  });

  it("lists only exact accessible connections and hides shared credentials", async () => {
    await db.updateProviderConnection(adminConnection.id, {
      client_secret: "legacy-top-level-secret",
      token: "generic-token-secret",
      customHeaders: { "x-private": "compound-header-secret" },
      privateApiKey: "compound-api-key-secret",
      webhookSecretValue: "compound-webhook-secret",
      nestedLegacy: { authorization: "Bearer legacy-secret", credentials: "generic-credentials-secret" },
    });
    const route = await import("@/app/api/providers/route.js");
    const response = await route.GET(await requestFor(alice, "http://localhost/api/providers"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(new Set(body.connections.map((connection) => connection.id))).toEqual(new Set([aliceConnection.id, adminConnection.id]));
    expect(body.connections.find((connection) => connection.id === aliceConnection.id)).toMatchObject({ ownership: "owned", canManage: true });
    expect(body.connections.find((connection) => connection.id === adminConnection.id)).toMatchObject({ ownership: "shared", canManage: false });
    expect(JSON.stringify(body)).not.toContain("admin-secret");
    expect(JSON.stringify(body)).not.toContain("nested-secret");
    expect(JSON.stringify(body)).not.toContain("legacy-top-level-secret");
    expect(JSON.stringify(body)).not.toContain("Bearer legacy-secret");
    expect(JSON.stringify(body)).not.toContain("generic-token-secret");
    expect(JSON.stringify(body)).not.toContain("generic-credentials-secret");
    expect(JSON.stringify(body)).not.toContain("compound-header-secret");
    expect(JSON.stringify(body)).not.toContain("compound-api-key-secret");
    expect(JSON.stringify(body)).not.toContain("compound-webhook-secret");

    const bobResponse = await route.GET(await requestFor(bob, "http://localhost/api/providers"));
    expect((await bobResponse.json()).connections).toEqual([]);
  });

  it("rejects shared mutation and member-controlled infrastructure fields", async () => {
    const route = await import("@/app/api/providers/[id]/route.js");
    const sharedResponse = await route.PUT(
      await requestFor(alice, `http://localhost/api/providers/${adminConnection.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: "stolen" }),
      }),
      { params: Promise.resolve({ id: adminConnection.id }) },
    );
    expect(sharedResponse.status).toBe(403);

    const endpointResponse = await route.PUT(
      await requestFor(alice, `http://localhost/api/providers/${aliceConnection.id}`, {
        method: "PUT",
        body: JSON.stringify({ providerSpecificData: { baseUrl: "http://127.0.0.1:11434" } }),
      }),
      { params: Promise.resolve({ id: aliceConnection.id }) },
    );
    expect(endpointResponse.status).toBe(403);

    const globalResponse = await route.PUT(
      await requestFor(alice, `http://localhost/api/providers/${aliceConnection.id}`, {
        method: "PUT",
        body: JSON.stringify({ globalPriority: 1 }),
      }),
      { params: Promise.resolve({ id: aliceConnection.id }) },
    );
    expect(globalResponse.status).toBe(403);

    const ownResponse = await route.PUT(
      await requestFor(alice, `http://localhost/api/providers/${aliceConnection.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: "alice-renamed" }),
      }),
      { params: Promise.resolve({ id: aliceConnection.id }) },
    );
    expect(ownResponse.status).toBe(200);
    expect((await db.getProviderConnectionById(aliceConnection.id)).name).toBe("alice-renamed");
  });

  it("ignores client-supplied ownership when a member creates a built-in connection", async () => {
    const route = await import("@/app/api/providers/route.js");
    const response = await route.POST(await requestFor(alice, "http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai",
        name: "alice-second",
        apiKey: "second-secret",
        ownerUserId: bob.id,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect((await db.getProviderConnectionById(body.connection.id)).ownerUserId).toBe(alice.id);
  });
});

describe("multi-user OAuth routes", () => {
  it("allows members to start Antigravity OAuth with server-bound ownership", async () => {
    const route = await import("@/app/api/oauth/[provider]/[action]/route.js");
    const response = await route.GET(
      await requestFor(alice, "http://localhost/api/oauth/antigravity/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback"),
      { params: Promise.resolve({ provider: "antigravity", action: "authorize" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url || body.authUrl || body.authorizationUrl).toContain("accounts.google.com");
    const { isOAuthOwner } = await import("@/lib/oauth/ownerState.js");
    expect(await isOAuthOwner(body.state, alice.id)).toBe(true);
  });

  it("blocks member-controlled OAuth upstream URLs before network access", async () => {
    const route = await import("@/app/api/oauth/[provider]/[action]/route.js");
    const gitlabResponse = await route.GET(
      await requestFor(alice, "http://localhost/api/oauth/gitlab/authorize?redirect_uri=http%3A%2F%2Flocalhost%2Fcallback&baseUrl=https%3A%2F%2Fevil.example&clientId=test"),
      { params: Promise.resolve({ provider: "gitlab", action: "authorize" }) },
    );
    expect(gitlabResponse.status).toBe(403);
    expect((await gitlabResponse.json()).error).toBe("Custom GitLab hosts require administrator access");

    const kiroResponse = await route.GET(
      await requestFor(alice, "http://localhost/api/oauth/kiro/device-code?start_url=https%3A%2F%2Fevil.example%2Fstart"),
      { params: Promise.resolve({ provider: "kiro", action: "device-code" }) },
    );
    expect(kiroResponse.status).toBe(403);
  });
});

describe("multi-user grant routes", () => {
  it("replaces exact grants atomically and never stores ownership as a grant", async () => {
    const route = await import("@/app/api/members/[id]/grants/route.js");
    const response = await route.PUT(
      await requestFor(admin, `http://localhost/api/members/${alice.id}/grants`, {
        method: "PUT",
        body: JSON.stringify({ connectionIds: [adminConnection.id, aliceConnection.id, adminConnection.id] }),
      }),
      { params: Promise.resolve({ id: alice.id }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).connectionIds).toEqual([adminConnection.id]);
    expect((await db.getConnectionGrants()).filter((grant) => grant.userId === alice.id).map((grant) => grant.connectionId)).toEqual([adminConnection.id]);

    const invalid = await route.PUT(
      await requestFor(admin, `http://localhost/api/members/${alice.id}/grants`, {
        method: "PUT",
        body: JSON.stringify({ connectionIds: [aliceConnection.id, "missing-connection"] }),
      }),
      { params: Promise.resolve({ id: alice.id }) },
    );
    expect(invalid.status).toBe(400);
    expect((await db.getConnectionGrants()).filter((grant) => grant.userId === alice.id).map((grant) => grant.connectionId)).toEqual([adminConnection.id]);
  });

  it("rejects member grant management", async () => {
    const route = await import("@/app/api/members/[id]/grants/route.js");
    const response = await route.PUT(
      await requestFor(alice, `http://localhost/api/members/${bob.id}/grants`, {
        method: "PUT",
        body: JSON.stringify({ connectionIds: [aliceConnection.id] }),
      }),
      { params: Promise.resolve({ id: bob.id }) },
    );
    expect(response.status).toBe(403);
  });
});

describe("multi-user API-key routes", () => {
  it("enforces key ownership and validates policies against owner access", async () => {
    const collectionRoute = await import("@/app/api/keys/route.js");
    const itemRoute = await import("@/app/api/keys/[id]/route.js");

    const inaccessibleCreate = await collectionRoute.POST(await requestFor(bob, "http://localhost/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "bad-policy", allowedConnectionIds: [aliceConnection.id] }),
    }));
    expect(inaccessibleCreate.status).toBe(403);

    const createdResponse = await collectionRoute.POST(await requestFor(alice, "http://localhost/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "alice-key", ownerUserId: bob.id, allowedConnectionIds: [aliceConnection.id] }),
    }));
    const created = await createdResponse.json();
    expect(createdResponse.status).toBe(201);
    expect((await db.getApiKeyById(created.id)).ownerUserId).toBe(alice.id);

    const bobRead = await itemRoute.GET(
      await requestFor(bob, `http://localhost/api/keys/${created.id}`),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(bobRead.status).toBe(404);

    const aliceList = await collectionRoute.GET(await requestFor(alice, "http://localhost/api/keys"));
    const listedBody = await aliceList.json();
    expect(listedBody.keys.map((key) => key.id)).toEqual([created.id]);
    expect(JSON.stringify(listedBody)).not.toContain(created.key);

    const adminRead = await itemRoute.GET(
      await requestFor(admin, `http://localhost/api/keys/${created.id}`),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(adminRead.status).toBe(200);
  });
});

describe("multi-user model discovery", () => {
  it("recomputes exact runtime credential access after grants and disablement", async () => {
    const key = await db.createApiKey("runtime-lifecycle", "machine", {
      ownerUserId: alice.id,
      allowedConnectionIds: [],
    });
    const { resolveRequestConnectionIds } = await import("@/lib/auth/authorization.js");
    const { getProviderCredentials, authorizeApiKey } = await import("@/sse/services/auth.js");

    let allowedIds = await resolveRequestConnectionIds(new Request("http://localhost/v1/chat/completions"), key.key);
    expect(allowedIds).toEqual(expect.arrayContaining([aliceConnection.id, adminConnection.id]));
    expect((await getProviderCredentials("anthropic", [], "claude-sonnet-4-5", { allowedConnectionIds: allowedIds }))?.connectionId).toBe(adminConnection.id);

    await db.replaceConnectionGrants(alice.id, [], admin.id);
    allowedIds = await resolveRequestConnectionIds(new Request("http://localhost/v1/chat/completions"), key.key);
    expect(allowedIds).toEqual([aliceConnection.id]);
    expect(await getProviderCredentials("anthropic", [], "claude-sonnet-4-5", { allowedConnectionIds: allowedIds })).toBeNull();

    await db.updateUser(alice.id, { status: "disabled" });
    await expect(resolveRequestConnectionIds(new Request("http://localhost/v1/chat/completions"), key.key)).rejects.toMatchObject({ status: 401 });
    await expect(authorizeApiKey(key.key, true)).resolves.toMatchObject({ allowed: false, status: 401 });
  });

  it("intersects API-key policy with exact current connection access", async () => {
    const modelRoute = await import("@/app/api/v1/models/route.js");
    const restricted = await db.createApiKey("restricted", "machine", {
      ownerUserId: alice.id,
      allowedConnectionIds: [aliceConnection.id],
    });
    const allAccessible = await db.createApiKey("all-accessible", "machine", {
      ownerUserId: alice.id,
      allowedConnectionIds: [],
    });

    const restrictedResponse = await modelRoute.GET(new Request("http://localhost/v1/models", {
      headers: { Authorization: `Bearer ${restricted.key}` },
    }));
    const restrictedIds = (await restrictedResponse.json()).data.map((model) => model.id);
    expect(restrictedIds.some((id) => id.startsWith("openai/"))).toBe(true);
    expect(restrictedIds.some((id) => id.startsWith("anthropic/"))).toBe(false);

    const allResponse = await modelRoute.GET(new Request("http://localhost/v1/models", {
      headers: { "x-goog-api-key": allAccessible.key },
    }));
    const allIds = (await allResponse.json()).data.map((model) => model.id);
    expect(allIds.some((id) => id.startsWith("openai/"))).toBe(true);
    expect(allIds.some((id) => id.startsWith("anthropic/"))).toBe(true);

    await db.revokeConnectionGrant(adminConnection.id, alice.id);
    const afterRevoke = await modelRoute.GET(new Request(`http://localhost/v1/models?key=${encodeURIComponent(allAccessible.key)}`));
    const afterRevokeIds = (await afterRevoke.json()).data.map((model) => model.id);
    expect(afterRevokeIds.some((id) => id.startsWith("anthropic/"))).toBe(false);
  });

  it("unions enabled models across exact same-provider connection grants", async () => {
    const first = await db.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "admin-openai-one",
      apiKey: "one",
      ownerUserId: admin.id,
      providerSpecificData: { enabledModels: ["gpt-4o"] },
    });
    const second = await db.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "admin-openai-two",
      apiKey: "two",
      ownerUserId: admin.id,
      providerSpecificData: { enabledModels: ["gpt-5.6-sol"] },
    });
    await db.grantConnection(first.id, alice.id, admin.id);
    await db.grantConnection(second.id, alice.id, admin.id);
    const key = await db.createApiKey("same-provider", "machine", {
      ownerUserId: alice.id,
      allowedConnectionIds: [first.id, second.id],
    });

    const route = await import("@/app/api/v1/models/route.js");
    const response = await route.GET(new Request("http://localhost/v1/models", {
      headers: { Authorization: `Bearer ${key.key}` },
    }));
    const ids = (await response.json()).data.map((model) => model.id);

    expect(ids).toContain("openai/gpt-4o");
    expect(ids).toContain("openai/gpt-5.6-sol");
  });

  it("keeps the full catalog when one permitted same-provider connection is unrestricted", async () => {
    const restricted = await db.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "admin-openai-restricted",
      apiKey: "restricted",
      ownerUserId: admin.id,
      providerSpecificData: { enabledModels: ["gpt-4o"] },
    });
    const unrestricted = await db.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "admin-openai-unrestricted",
      apiKey: "unrestricted",
      ownerUserId: admin.id,
    });
    await db.grantConnection(restricted.id, alice.id, admin.id);
    await db.grantConnection(unrestricted.id, alice.id, admin.id);
    const key = await db.createApiKey("mixed-same-provider", "machine", {
      ownerUserId: alice.id,
      allowedConnectionIds: [restricted.id, unrestricted.id],
    });

    const route = await import("@/app/api/v1/models/route.js");
    const response = await route.GET(new Request("http://localhost/v1/models", {
      headers: { Authorization: `Bearer ${key.key}` },
    }));
    const ids = (await response.json()).data.map((model) => model.id);

    expect(ids).toContain("openai/gpt-4o");
    expect(ids).toContain("openai/gpt-5.6-sol");
  });
});

describe("multi-user usage routes", () => {
  it("scopes member stats and logs while allowing admin per-user inspection", async () => {
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-member",
      connectionId: aliceConnection.id,
      userId: alice.id,
      tokens: { prompt_tokens: 3, completion_tokens: 2 },
    });
    await db.saveRequestUsage({
      provider: "anthropic",
      model: "claude-admin",
      connectionId: adminConnection.id,
      userId: admin.id,
      tokens: { prompt_tokens: 7, completion_tokens: 1 },
    });

    const statsRoute = await import("@/app/api/usage/stats/route.js");
    const logsRoute = await import("@/app/api/usage/logs/route.js");

    const memberStatsResponse = await statsRoute.GET(await requestFor(alice, "http://localhost/api/usage/stats?period=all&userId=admin"));
    const memberStats = await memberStatsResponse.json();
    expect(memberStats.totalRequests).toBe(1);
    expect(memberStats.byProvider).toHaveProperty("openai");
    expect(memberStats.byProvider).not.toHaveProperty("anthropic");

    const memberLogsResponse = await logsRoute.GET(await requestFor(alice, "http://localhost/api/usage/logs?userId=admin"));
    const memberLogs = await memberLogsResponse.json();
    expect(memberLogs).toHaveLength(1);
    expect(memberLogs[0]).toContain("gpt-member");
    expect(memberLogs[0]).not.toContain("claude-admin");

    const adminMemberStatsResponse = await statsRoute.GET(await requestFor(admin, `http://localhost/api/usage/stats?period=all&userId=${alice.id}`));
    expect((await adminMemberStatsResponse.json()).totalRequests).toBe(1);

    const adminGlobalStatsResponse = await statsRoute.GET(await requestFor(admin, "http://localhost/api/usage/stats?period=all"));
    expect((await adminGlobalStatsResponse.json()).totalRequests).toBe(2);

    const unauthenticated = await statsRoute.GET(new Request("http://localhost/api/usage/stats"));
    expect(unauthenticated.status).toBe(401);

    const streamRoute = await import("@/app/api/usage/stream/route.js");
    expect((await streamRoute.GET(new Request("http://localhost/api/usage/stream"))).status).toBe(401);

    const connectionUsageRoute = await import("@/app/api/usage/[connectionId]/route.js");
    expect((await connectionUsageRoute.GET(
      new Request(`http://localhost/api/usage/${aliceConnection.id}`),
      { params: Promise.resolve({ connectionId: aliceConnection.id }) },
    )).status).toBe(401);
  });
});
