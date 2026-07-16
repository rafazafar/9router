import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));

const { buildModelsList, enrichModelEntry } = await import("../../src/app/api/v1/models/route.js");

describe("GET /v1/models metadata extensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("adds normalized capabilities and thinking levels to static models", async () => {
    const models = await buildModelsList(["llm"]);
    const reasoningModel = models.find((model) => model.id === "cx/gpt-5.6-sol");
    const visionModel = models.find((model) => model.id === "openai/gpt-4.1");

    expect(reasoningModel).toEqual(expect.objectContaining({
      object: "model",
      owned_by: "cx",
      capabilities: expect.objectContaining({
        vision: true,
        reasoning: true,
        thinkingFormat: "openai",
      }),
      thinking_levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    }));
    expect(visionModel.capabilities).toEqual(expect.objectContaining({ vision: true, reasoning: false }));
    expect(visionModel.thinking_levels).toEqual([]);
  });

  it("merges live metadata and normalizes a live thinking flag", () => {
    const model = enrichModelEntry(
      { id: "live/bespoke-alpha", object: "model", owned_by: "live" },
      "live",
      "bespoke-alpha",
      { vision: true, thinking: true, contextWindow: 32000 },
    );

    expect(model.capabilities).toEqual(expect.objectContaining({
      vision: true,
      thinking: true,
      reasoning: true,
      contextWindow: 32000,
    }));
    expect(model.thinking_levels).toEqual(["none", "low", "medium", "high"]);
  });

  it("aggregates combo metadata from its member models", async () => {
    mocks.getCombos.mockResolvedValue([{
      name: "vision-fallback",
      models: ["openai/gpt-4.1", "cx/gpt-5.6-sol"],
    }]);

    const models = await buildModelsList(["llm"]);
    const combo = models.find((model) => model.id === "vision-fallback");

    expect(combo.capabilities).toEqual(expect.objectContaining({
      vision: true,
      reasoning: true,
      contextWindow: 400000,
      maxOutput: 32768,
    }));
    expect(combo.thinking_levels).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  });
});
