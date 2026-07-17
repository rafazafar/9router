import { describe, expect, it } from "vitest";
import { capsToOpenCodeModel } from "../../src/app/(dashboard)/dashboard/cli-tools/components/modelMeta.js";

describe("capsToOpenCodeModel", () => {
  it("returns undefined-valued shape for null caps (no crash)", () => {
    const out = capsToOpenCodeModel(null);
    expect(out.name).toBeUndefined();
    expect(out.modalities).toBeUndefined();
    expect(out.limit).toBeUndefined();
    expect(out.reasoning).toBeUndefined();
  });

  it("maps a text-only model to text-in/text-out, no reasoning, with limit", () => {
    const caps = {
      vision: false, pdf: false, audioInput: false, videoInput: false,
      imageOutput: false, reasoning: false,
      contextWindow: 128000, maxOutput: 4096,
    };
    const out = capsToOpenCodeModel(caps);
    expect(out.modalities).toEqual({ input: ["text"], output: ["text"] });
    expect(out.reasoning).toBeUndefined();
    expect(out.limit).toEqual({ context: 128000, output: 4096 });
  });

  it("maps a vision+reasoning model (Claude Sonnet 4.6) with image input and reasoning=true", () => {
    const caps = {
      vision: true, pdf: false, audioInput: false, videoInput: false,
      imageOutput: false, reasoning: true, search: true,
      thinkingFormat: "claude-adaptive", thinkingCanDisable: true,
      contextWindow: 1000000, maxOutput: 128000,
    };
    const out = capsToOpenCodeModel(caps);
    expect(out.modalities.input).toEqual(["text", "image"]);
    expect(out.modalities.output).toEqual(["text"]);
    expect(out.reasoning).toBe(true);
    expect(out.limit).toEqual({ context: 1000000, output: 128000 });
    // thinkingCanDisable is true (default) -> no reasoningThinking restriction emitted
    expect(out.reasoningThinking).toBeUndefined();
  });

  it("emits reasoningThinking.canDisable=false when the model cannot disable thinking", () => {
    const caps = {
      vision: false, pdf: false, audioInput: false, videoInput: false,
      imageOutput: false, reasoning: true,
      thinkingFormat: "gemini-level", thinkingCanDisable: false,
      contextWindow: 0, maxOutput: 0,
    };
    const out = capsToOpenCodeModel(caps);
    expect(out.reasoning).toBe(true);
    expect(out.reasoningThinking).toEqual({ canDisable: false });
    // contextWindow/maxOutput both 0 -> no limit block emitted
    expect(out.limit).toBeUndefined();
  });

  it("includes pdf/audio/video input modalities when caps are set", () => {
    const caps = {
      vision: true, pdf: true, audioInput: true, videoInput: true,
      imageOutput: true, reasoning: false,
      contextWindow: 0, maxOutput: 0,
    };
    const out = capsToOpenCodeModel(caps);
    expect(out.modalities.input).toEqual(["text", "image", "pdf", "audio", "video"]);
    expect(out.modalities.output).toEqual(["text", "image"]);
  });
});
