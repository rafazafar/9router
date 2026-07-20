import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/authorization", () => ({
  requireUser: vi.fn(async () => ({ userId: "admin", role: "admin" })),
  requireAdmin: vi.fn(async () => ({ userId: "admin", role: "admin" })),
}));

vi.mock("@/lib/db/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getAccessibleProviderConnections: vi.fn(async () => [{ id: "kiro-test", provider: "kiro", isActive: true }]),
  };
});

// Regression: /api/models used to trim caps to {vision,search,reasoning}, dropping
// thinkingFormat, thinkingRange, contextWindow, maxOutput, pdf, audioInput, etc.
// The route handler is a Next route export; we verify the caps shape by importing
// the GET handler directly and capturing the payload via a NextResponse.json stub.

describe("/api/models GET — full caps exposure", () => {
  it("returns the full caps object (not just vision/search/reasoning)", async () => {
    const mod = await import("../../src/app/api/models/route.js");
    let captured;
    const nextServer = await import("next/server");
    const realJson = nextServer.NextResponse.json;
    nextServer.NextResponse.json = (body, init) => {
      captured = body;
      return { ok: true, status: init?.status || 200, json: async () => body };
    };
    try {
      await mod.GET(new Request("http://localhost/api/models"));
    } finally {
      nextServer.NextResponse.json = realJson;
    }
    const models = captured?.models || [];
    expect(models.length).toBeGreaterThan(0);
    // Find a known reasoning model (claude-sonnet-5 under kiro) and assert extra fields survive
    const sonnet = models.find((m) => m.fullModel && m.fullModel.includes("claude-sonnet-5"));
    expect(sonnet).toBeTruthy();
    expect(sonnet.caps).toBeTruthy();
    // The trimmed shape only had 3 keys; full shape has >= 6
    expect(Object.keys(sonnet.caps).length).toBeGreaterThanOrEqual(6);
    expect(sonnet.caps).toHaveProperty("thinkingFormat");
    expect(sonnet.caps).toHaveProperty("contextWindow");
    expect(sonnet.caps).toHaveProperty("maxOutput");
  });
});
