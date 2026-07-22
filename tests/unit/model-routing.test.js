import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateModelAlias } from "../../open-sse/services/modelAliases.js";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zrouter-model-routing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createProviderConnection, createProviderNode, deleteModelAlias, getModelAliases, getProviderConnections, setModelAlias, setModelAliasValidated } = await import("@/models/index.js");
  const { getModelInfo } = await import("@/sse/services/model.js");

  return {
    createProviderConnection,
    createProviderNode,
    deleteModelAlias,
    getModelAliases,
    getProviderConnections,
    setModelAlias,
    setModelAliasValidated,
    getModelInfo,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("model routing", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("keeps built-in provider aliases ahead of compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible CF Collision",
      prefix: "cf",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("cf/@cf/black-forest-labs/flux-2-klein-9b"))
      .resolves.toEqual({
        provider: "cloudflare-ai",
        model: "@cf/black-forest-labs/flux-2-klein-9b",
      });
  });

  it("still routes non-reserved compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible OCT",
      prefix: "oct",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("oct/gpt-image-1"))
      .resolves.toEqual({
        provider: "openai-compatible-chat-test",
        model: "gpt-image-1",
      });
  });

  it("lets an explicit full-model alias override a reserved provider prefix", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.setModelAlias("openai/gpt-5.6-sol", "cx/gpt-5.6-sol");

    await expect(ctx.getModelInfo("openai/gpt-5.6-sol")).resolves.toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
    });
  });

  it("routes a canonical model ID through its sole connected compatible provider", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await ctx.deleteModelAlias("openai/gpt-5.6-sol");
    await ctx.createProviderConnection({ provider: "codex", authType: "oauth", name: "Codex" });

    await expect(ctx.getModelInfo("openai/gpt-5.6-sol")).resolves.toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
    });
  });

  it("keeps the canonical provider route when that provider is connected", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await ctx.deleteModelAlias("openai/gpt-5.6-sol");
    await ctx.createProviderConnection({ provider: "codex", authType: "oauth", name: "Codex" });
    await ctx.createProviderConnection({ provider: "openai", authType: "apikey", name: "OpenAI", apiKey: "test" });
    expect([...new Set((await ctx.getProviderConnections()).map(({ provider }) => provider))].sort())
      .toEqual(["codex", "openai"]);

    await expect(ctx.getModelInfo("openai/gpt-5.6-sol")).resolves.toEqual({
      provider: "openai",
      model: "gpt-5.6-sol",
    });
  });

  it("validates concurrent alias edits against one transactional snapshot", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await ctx.setModelAlias("one", "cx/gpt-5.4");
    await ctx.setModelAlias("two", "cx/gpt-5.4");

    const update = (alias, target) => ctx.setModelAliasValidated(alias, target, (aliases) => (
      validateModelAlias({ alias, target, aliases })
    ));
    const results = await Promise.allSettled([
      update("one", "two"),
      update("two", "one"),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const aliases = await ctx.getModelAliases();
    await expect(ctx.getModelInfo("one")).resolves.toMatchObject({ provider: "codex" });
    await expect(ctx.getModelInfo("two")).resolves.toMatchObject({ provider: "codex" });
    expect(aliases.one === "two" && aliases.two === "one").toBe(false);
  });
});
