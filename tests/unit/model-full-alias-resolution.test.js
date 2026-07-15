import { describe, expect, it } from "vitest";

import {
  getModelInfoCore,
  resolveModelAliasString,
} from "../../open-sse/services/model.js";

describe("full model aliases", () => {
  it("resolves a provider-qualified alias before parsing its provider", async () => {
    await expect(getModelInfoCore("openai/gpt-5.6-sol", {
      "openai/gpt-5.6-sol": "cx/gpt-5.6-sol",
    })).resolves.toEqual({ provider: "codex", model: "gpt-5.6-sol" });
  });

  it("resolves alias chains for both full and bare model aliases", () => {
    expect(resolveModelAliasString("standard/gpt", {
      "standard/gpt": "preferred-gpt",
      "preferred-gpt": "cx/gpt-5.6-sol",
    })).toEqual({
      model: "cx/gpt-5.6-sol",
      resolved: true,
      chain: ["standard/gpt", "preferred-gpt", "cx/gpt-5.6-sol"],
    });
  });

  it("rejects cycles instead of silently routing to the wrong provider", () => {
    expect(() => resolveModelAliasString("one", {
      one: "two",
      two: "one",
    })).toThrow(/cycle/i);
  });

  it("rejects aliases that exceed the resolution depth", () => {
    expect(() => resolveModelAliasString("one", {
      one: "two",
      two: "three",
      three: "four",
    }, { maxDepth: 2 })).toThrow(/depth/i);
  });

  it("preserves direct provider-qualified routing when no alias exists", async () => {
    await expect(getModelInfoCore("openai/gpt-5.4", {}))
      .resolves.toEqual({ provider: "openai", model: "gpt-5.4" });
  });
});
