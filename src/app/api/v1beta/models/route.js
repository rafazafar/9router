import { buildModelsList } from "@/app/api/v1/models/route.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function GET(request) {
  try {
    const openAiModels = await buildModelsList(["llm", "tts"], await resolveAllowedConnections(request));
    const models = openAiModels.map((model) => {
      const modelId = model.owned_by === "gemini" && model.id.startsWith("gemini/")
        ? model.id.slice("gemini/".length)
        : model.id;
      return {
      name: `models/${modelId}`,
      displayName: modelId,
      description: `${model.owned_by || "zrouter"} model`,
      supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
      inputTokenLimit: model.capabilities?.contextWindow || 128000,
      outputTokenLimit: model.capabilities?.maxOutput || 8192,
      };
    });
    return Response.json({ models }, { headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (error) {
    const { authorizationErrorResponse } = await import("@/lib/auth/authorization.js");
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}

async function resolveAllowedConnections(request) {
  const { extractApiKey } = await import("@/sse/services/auth.js");
  const { resolveRequestConnectionIds } = await import("@/lib/auth/authorization.js");
  const value = extractApiKey(request) || new URL(request.url).searchParams.get("key");
  return resolveRequestConnectionIds(request, value);
}
