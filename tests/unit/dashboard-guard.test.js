import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  getDashboardAuthSession: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
  getUserById: mocks.getUserById,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
  getDashboardAuthSession: mocks.getDashboardAuthSession,
}));

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");

function request(pathname, headers = {}, authToken = null) {
  const normalizedHeaders = new Headers(headers);
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: normalizedHeaders,
    cookies: { get: vi.fn((name) => name === "auth_token" && authToken ? { value: authToken } : undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("dashboard guard public LLM API access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("rejects loopback public LLM API without API key or session", async () => {
    const response = await proxy(request("/v1/chat/completions", { host: "localhost:20128" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote Host-spoof when real peer IP is non-loopback", async () => {
    const response = await proxy(request("/v1/chat/completions", {
      host: "localhost",
      "x-9r-real-ip": "10.204.111.34",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects loopback peer without API key or session", async () => {
    const response = await proxy(request("/v1/chat/completions", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote rewritten public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects loopback rewritten public LLM API without API key or session", async () => {
    const response = await proxy(request("/api/v1/chat/completions", { host: "localhost:20128" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote beta public LLM API without API key", async () => {
    const response = await proxy(request("/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote rewritten beta public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote codex rewrite without API key", async () => {
    const response = await proxy(request("/codex/x", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote top-level responses rewrite without API key", async () => {
    const response = await proxy(request("/responses", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows remote codex rewrite with valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/codex/x", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid bearer API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/api/v1/chat/completions", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid x-api-key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1/web/fetch", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote rewritten beta public LLM API with valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/api/v1beta/models", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote beta public LLM API with valid Google API key header", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1beta/models", {
      host: "router.example.com",
      "x-goog-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote beta public LLM API with valid Google key query parameter", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1beta/models?key=sk-valid", {
      host: "router.example.com",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });
});

describe("dashboard guard role boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
  });

  it.each([
    "/api/provider-nodes",
    "/api/proxy-pools",
    "/api/combos",
    "/api/models/alias",
    "/api/settings",
    "/api/members",
  ])("rejects a member session from admin infrastructure route %s", async (pathname) => {
    mocks.getDashboardAuthSession.mockResolvedValue({ sub: "member", sessionVersion: 3 });
    mocks.getUserById.mockResolvedValue({ id: "member", role: "member", status: "active", sessionVersion: 3 });

    const response = await proxy(request(pathname, { host: "localhost:20128" }, "member-token"));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Administrator access required");
  });

  it("allows a current active admin session to global infrastructure", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue({ sub: "admin", sessionVersion: 5 });
    mocks.getUserById.mockResolvedValue({ id: "admin", role: "admin", status: "active", sessionVersion: 5 });

    const response = await proxy(request("/api/provider-nodes", { host: "localhost:20128" }, "admin-token"));

    expect(response).toBe(mocks.nextResponse);
  });

  it("allows a member session through to scoped custom-model reads", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue({ sub: "member", sessionVersion: 3 });
    mocks.getUserById.mockResolvedValue({ id: "member", role: "member", status: "active", sessionVersion: 3 });

    const response = await proxy(request("/api/models/custom", { host: "localhost:20128" }, "member-token"));

    expect(response).toBe(mocks.nextResponse);
  });

  it("allows members to use scoped CLI Tools UI but not host-management APIs", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue({ sub: "member", sessionVersion: 3 });
    mocks.getUserById.mockResolvedValue({ id: "member", role: "member", status: "active", sessionVersion: 3 });

    expect(await proxy(request("/dashboard/cli-tools", { host: "localhost:20128" }, "member-token"))).toBe(mocks.nextResponse);
    const apiResponse = await proxy(request("/api/cli-tools/opencode-settings", { host: "localhost:20128" }, "member-token"));
    expect(apiResponse.status).toBe(403);
    expect(apiResponse.body.error).toBe("Administrator access required");
  });

  it("allows members to view endpoint docs but not tunnel APIs", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue({ sub: "member", sessionVersion: 3 });
    mocks.getUserById.mockResolvedValue({ id: "member", role: "member", status: "active", sessionVersion: 3 });

    expect(await proxy(request("/dashboard/endpoint", { host: "localhost:20128" }, "member-token"))).toBe(mocks.nextResponse);
    const apiResponse = await proxy(request("/api/tunnel/status", { host: "localhost:20128" }, "member-token"));
    expect(apiResponse.status).toBe(403);
    expect(apiResponse.body.error).toBe("Administrator access required");
  });

  it.each(["/dashboard/token-saver", "/dashboard/quota"])("allows members to use tenant-scoped dashboard route %s", async (pathname) => {
    mocks.getDashboardAuthSession.mockResolvedValue({ sub: "member", sessionVersion: 3 });
    mocks.getUserById.mockResolvedValue({ id: "member", role: "member", status: "active", sessionVersion: 3 });
    expect(await proxy(request(pathname, { host: "localhost:20128" }, "member-token"))).toBe(mocks.nextResponse);
  });

  it("rejects an admin token after role change or session revocation", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue({ sub: "admin", sessionVersion: 4 });
    mocks.getUserById.mockResolvedValue({ id: "admin", role: "member", status: "active", sessionVersion: 5 });

    const response = await proxy(request("/api/provider-nodes", { host: "localhost:20128" }, "stale-admin-token"));

    expect(response.status).toBe(403);
  });
});

describe("dashboard guard local-only access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("rejects local-only route from non-loopback host without CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("rejects local-only route on loopback when requireLogin=true and no JWT", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("rejects local-only route on loopback even when stale settings disable login", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("rejects local-only route from tunnel host even when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
  });

  it("rejects local-only route when Origin is non-loopback (CSRF block)", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://evil.example.com",
    }));

    expect(response.status).toBe(403);
  });

  it("allows local-only route with valid CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
      "x-9r-cli-token": "cli-token",
    }));

    expect(response).toBe(mocks.nextResponse);
  });
});

describe("dashboard guard helpers", () => {
  it("extracts bearer API keys before x-api-key", () => {
    const apiRequest = request("/v1/chat/completions", {
      authorization: "Bearer bearer-key",
      "x-api-key": "header-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("bearer-key");
  });

  it("extracts Google API keys after x-api-key", () => {
    const apiRequest = request("/v1beta/models?key=query-key", {
      "x-api-key": "header-key",
      "x-goog-api-key": "google-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("header-key");
  });
});
