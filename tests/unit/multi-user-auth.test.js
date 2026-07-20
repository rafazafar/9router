import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(), validateApiKey: vi.fn(), updateProviderConnection: vi.fn(),
  getSettings: vi.fn(), getProxyPools: vi.fn(),
  reserveApiKeyRequest: vi.fn(async () => ({ allowed: false, reason: "invalid" })),
}));
vi.mock("@/lib/auth/authorization", () => ({
  getCurrentPrincipal: vi.fn(), getEffectiveApiKeyConnectionIds: vi.fn(),
  hasPresentedDashboardSession: vi.fn((request) => !!(
    request?.cookies?.get?.("auth_token")?.value
    || request?.headers?.get?.("cookie")?.includes("auth_token=")
  )),
}));

describe("multi-user inference authorization", () => {
  it("extracts Google-compatible API key forms", async () => {
    const { extractApiKey } = await import("@/sse/services/auth.js");
    expect(extractApiKey(new Request("http://localhost/v1/models", { headers: { "x-goog-api-key": "google-key" } }))).toBe("google-key");
    expect(extractApiKey(new Request("http://localhost/v1/models?key=query-key"))).toBe("query-key");
  });

  it("rejects a supplied invalid key even when API keys are optional", async () => {
    const { authorizeApiKey } = await import("@/sse/services/auth.js");
    await expect(authorizeApiKey("bad-key", false)).resolves.toMatchObject({ allowed: false, status: 401 });
  });

  it("rejects a presented invalid session when API keys are optional", async () => {
    const { getCurrentPrincipal } = await import("@/lib/auth/authorization");
    getCurrentPrincipal.mockResolvedValue(null);
    const request = { cookies: { get: vi.fn(() => ({ value: "stale-session" })) } };
    const { authorizeApiKey } = await import("@/sse/services/auth.js");

    await expect(authorizeApiKey(null, false, request)).resolves.toMatchObject({
      allowed: false,
      status: 401,
      message: "Invalid session",
    });
  });

  it("rejects an invalid session carried by a standard Request cookie header", async () => {
    const { getCurrentPrincipal } = await import("@/lib/auth/authorization");
    getCurrentPrincipal.mockResolvedValue(null);
    const { authorizeApiKey } = await import("@/sse/services/auth.js");

    await expect(authorizeApiKey(null, false, new Request("http://localhost/v1/responses/compact", {
      headers: { cookie: "auth_token=stale-session" },
    }))).resolves.toMatchObject({ allowed: false, status: 401, message: "Invalid session" });
  });

  it("attributes optional-key admin requests to the authenticated admin", async () => {
    const { getCurrentPrincipal } = await import("@/lib/auth/authorization");
    getCurrentPrincipal.mockResolvedValue({ userId: "admin", role: "admin" });
    const request = { cookies: { get: vi.fn(() => ({ value: "valid-session" })) } };
    const { authorizeApiKey } = await import("@/sse/services/auth.js");

    await expect(authorizeApiKey(null, false, request)).resolves.toMatchObject({
      allowed: true,
      apiKey: { ownerUserId: "admin" },
    });
  });
});
