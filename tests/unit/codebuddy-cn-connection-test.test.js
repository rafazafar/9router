import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));

const originalFetch = global.fetch;

describe("CodeBuddy CN connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "codebuddy-key",
      provider: "codebuddy-cn",
      authType: "apikey",
      apiKey: "valid-key",
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("validates API keys with the quota endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    global.fetch = fetchMock;

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("codebuddy-key");

    expect(result.valid).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer valid-key" }),
        body: "{}",
      }),
    );
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "codebuddy-key",
      expect.objectContaining({ testStatus: "active", lastError: null }),
    );
  });
});
