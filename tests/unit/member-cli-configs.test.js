import { describe, expect, it } from "vitest";
import { buildMemberCliConfigs } from "@/shared/utils/memberCliConfigs.js";

describe("member CLI configs", () => {
  it("generates copy-only configs from exact scoped inputs", () => {
    const configs = buildMemberCliConfigs({
      baseUrl: "https://router.example.com/",
      apiKey: "sk-member-secret",
      model: "openai/gpt-5.6-sol",
      models: ["openai/gpt-5.6-sol", "anthropic/claude-sonnet-4-5", "google/gemini-3-pro"],
    });
    const allContent = configs.flatMap((config) => config.files.map((file) => file.content)).join("\n");

    expect(configs.map((config) => config.id)).toEqual(["claude", "opencode", "codex", "openai"]);
    expect(allContent).toContain("https://router.example.com/v1");
    expect(allContent).toContain("sk-member-secret");
    expect(allContent).toContain("openai/gpt-5.6-sol");
    const openCode = JSON.parse(configs.find((config) => config.id === "opencode").files[0].content);
    expect(Object.keys(openCode.provider["9router"].models)).toEqual([
      "openai/gpt-5.6-sol",
      "anthropic/claude-sonnet-4-5",
      "google/gemini-3-pro",
    ]);
    expect(allContent).not.toContain("/app/data");
  });

  it("escapes shell values in generic environment output", () => {
    const generic = buildMemberCliConfigs({
      baseUrl: "https://router.example.com",
      apiKey: "sk-'quoted",
      model: "provider/model",
    }).find((config) => config.id === "openai");

    expect(generic.files[0].content).toContain(`OPENAI_API_KEY='sk-'"'"'quoted'`);
  });
});
