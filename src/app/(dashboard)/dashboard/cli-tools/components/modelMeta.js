// Maps 9Router model capabilities (from getCapabilitiesForModel / /api/models caps)
// into the per-model metadata schema each CLI tool's config expects.
//
// Today only OpenCode's `provider.{id}.models` object accepts per-model metadata;
// add sibling mappers here if other tools grow similar schemas.

/**
 * 9Router caps -> OpenCode provider.models[id] entry fields.
 * Returns an object suitable to spread alongside { name: modelId }.
 * Null/undefined caps yields an undefined-valued shape (JSON.stringify omits undefined).
 */
export function capsToOpenCodeModel(caps) {
  if (!caps) {
    return { name: undefined, modalities: undefined, limit: undefined, reasoning: undefined };
  }
  const input = ["text"];
  if (caps.vision) input.push("image");
  if (caps.pdf) input.push("pdf");
  if (caps.audioInput) input.push("audio");
  if (caps.videoInput) input.push("video");
  const output = caps.imageOutput ? ["text", "image"] : ["text"];
  const out = {
    name: undefined,
    modalities: { input, output },
  };
  if (caps.contextWindow || caps.maxOutput) {
    out.limit = {};
    if (caps.contextWindow) out.limit.context = caps.contextWindow;
    if (caps.maxOutput) out.limit.output = caps.maxOutput;
  }
  if (caps.reasoning) {
    out.reasoning = true;
    if (caps.thinkingCanDisable === false) {
      out.reasoningThinking = { canDisable: false };
    }
  }
  return out;
}
