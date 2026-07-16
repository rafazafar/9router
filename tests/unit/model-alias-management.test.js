import { describe, expect, it } from "vitest";

import {
  appendAliasModelEntries,
  getCanonicalAliasSuggestions,
  getCanonicalFallbackAliases,
  getDependentAliases,
  validateModelAlias,
} from "../../open-sse/services/modelAliases.js";

describe("model alias management", () => {
  it("requires explicit override when an alias shadows a provider route", () => {
    expect(() => validateModelAlias({
      alias: "openai/gpt-5.6-sol",
      target: "cx/gpt-5.6-sol",
      aliases: {},
    })).toThrow(/shadows/i);

    expect(validateModelAlias({
      alias: "openai/gpt-5.6-sol",
      target: "cx/gpt-5.6-sol",
      aliases: {},
      allowOverride: true,
    })).toMatchObject({
      alias: "openai/gpt-5.6-sol",
      target: "cx/gpt-5.6-sol",
      resolvedTarget: "cx/gpt-5.6-sol",
      shadowsProviderRoute: true,
    });
  });

  it("rejects invalid targets and prospective cycles", () => {
    expect(() => validateModelAlias({ alias: "short", target: "bare", aliases: {} }))
      .toThrow(/provider-qualified/i);
    expect(() => validateModelAlias({ alias: "one", target: "two", aliases: { two: "one" } }))
      .toThrow(/cycle/i);
    expect(() => validateModelAlias({ alias: "__proto__", target: "cx/gpt-5.4", aliases: {} }))
      .toThrow(/reserved object key/i);
  });

  it("adds discoverable model entries for aliases whose targets are available", () => {
    const models = [{ id: "cx/gpt-5.6-sol", object: "model", owned_by: "cx" }];
    const aliases = {
      "openai/gpt-5.6-sol": "cx/gpt-5.6-sol",
      sol: "openai/gpt-5.6-sol",
      missing: "cx/not-connected",
    };

    expect(appendAliasModelEntries(models, aliases)).toEqual([
      models[0],
      {
        id: "openai/gpt-5.6-sol",
        object: "model",
        owned_by: "openai",
        "x-9router-target": "cx/gpt-5.6-sol",
      },
      {
        id: "sol",
        object: "model",
        owned_by: "alias",
        "x-9router-target": "cx/gpt-5.6-sol",
      },
    ]);
  });

  it("replaces discovery metadata when an explicit alias shadows a direct route", () => {
    const models = [
      { id: "openai/gpt-5.4", object: "model", owned_by: "openai", capabilities: ["native"] },
      { id: "cx/gpt-5.4", object: "model", owned_by: "cx", capabilities: ["codex"] },
    ];

    expect(appendAliasModelEntries(models, {
      "openai/gpt-5.4": "cx/gpt-5.4",
    })[0]).toEqual({
      id: "openai/gpt-5.4",
      object: "model",
      owned_by: "openai",
      capabilities: ["codex"],
      "x-9router-target": "cx/gpt-5.4",
    });
  });

  it("offers registry-backed canonical aliases without inventing review-model aliases", () => {
    const suggestions = getCanonicalAliasSuggestions({});

    expect(suggestions).toContainEqual({
      alias: "openai/gpt-5.6-sol",
      target: "cx/gpt-5.6-sol",
      provider: "codex",
      model: "gpt-5.6-sol",
    });
    expect(suggestions.some(({ alias }) => alias.endsWith("-review"))).toBe(false);
    expect(getCanonicalAliasSuggestions({}, { providerIds: new Set(["anthropic"]) })).toEqual([]);
  });

  it("uses canonical aliases as an unambiguous fallback when the canonical provider is not connected", () => {
    expect(getCanonicalFallbackAliases({
      providerIds: new Set(["codex"]),
      aliases: {},
    })).toMatchObject({
      "openai/gpt-5.6-sol": "cx/gpt-5.6-sol",
    });

    expect(getCanonicalFallbackAliases({
      providerIds: new Set(["codex", "openai"]),
      aliases: {},
    })["openai/gpt-5.6-sol"]).toBeUndefined();

    expect(getCanonicalFallbackAliases({
      providerIds: new Set(["codex"]),
      aliases: { "openai/gpt-5.6-sol": "custom/sol" },
    })["openai/gpt-5.6-sol"]).toBeUndefined();
  });

  it("finds dependent aliases so deletion cannot leave broken chains", () => {
    expect(getDependentAliases("standard/gpt", {
      short: "standard/gpt",
      other: "cx/other",
      nested: { provider: "standard", model: "gpt" },
    })).toEqual(["nested", "short"]);
  });
});
