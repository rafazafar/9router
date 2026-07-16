import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

describe("model alias API", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-alias-api-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("creates, lists, updates, resolves, and deletes a full-model alias", async () => {
    const route = await import("@/app/api/models/alias/route.js");

    const conflict = await route.PUT(new Request("http://localhost/api/models/alias", {
      method: "PUT",
      body: JSON.stringify({ alias: "openai/gpt-5.6-sol", model: "cx/gpt-5.6-sol" }),
    }));
    expect(conflict.status).toBe(409);

    const created = await route.PUT(new Request("http://localhost/api/models/alias", {
      method: "PUT",
      body: JSON.stringify({ alias: "openai/gpt-5.6-sol", model: "cx/gpt-5.6-sol", override: true }),
    }));
    expect(created.status).toBe(200);

    const listed = await route.GET();
    await expect(listed.json()).resolves.toMatchObject({
      aliases: { "openai/gpt-5.6-sol": "cx/gpt-5.6-sol" },
    });

    const { getModelInfo } = await import("@/sse/services/model.js");
    await expect(getModelInfo("openai/gpt-5.6-sol")).resolves.toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
    });

    const { buildModelsList } = await import("@/app/api/v1/models/route.js");
    const discovered = await buildModelsList(["llm"]);
    expect(discovered).toContainEqual(expect.objectContaining({
      id: "openai/gpt-5.6-sol",
      "x-9router-target": "cx/gpt-5.6-sol",
    }));

    const modelInfoRoute = await import("@/app/api/v1/models/info/route.js");
    const infoResponse = await modelInfoRoute.GET(new Request(
      "http://localhost/v1/models/info?id=openai%2Fgpt-5.6-sol",
    ));
    await expect(infoResponse.json()).resolves.toMatchObject({
      id: "openai/gpt-5.6-sol",
      "x-9router-target": "cx/gpt-5.6-sol",
    });

    const updated = await route.PUT(new Request("http://localhost/api/models/alias", {
      method: "PUT",
      body: JSON.stringify({ alias: "openai/gpt-5.6-sol", model: "cx/gpt-5.6-terra", override: true }),
    }));
    expect(updated.status).toBe(200);

    const deleted = await route.DELETE(new Request(
      "http://localhost/api/models/alias?alias=openai%2Fgpt-5.6-sol",
      { method: "DELETE" },
    ));
    expect(deleted.status).toBe(200);

    const { createProviderConnection } = await import("@/models/index.js");
    await createProviderConnection({ provider: "codex", authType: "oauth", name: "Codex" });
    expect(await buildModelsList(["llm"])).toContainEqual(expect.objectContaining({
      id: "openai/gpt-5.6-sol",
      "x-9router-target": "cx/gpt-5.6-sol",
    }));
  });
});
