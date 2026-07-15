// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderConnections, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, resolveModelAliasString, getModelInfoCore } from "open-sse/services/model.js";
import { getCanonicalFallbackAliases } from "open-sse/services/modelAliases.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const [aliases, connections] = await Promise.all([getModelAliases(), getProviderConnections()]);
  const providerIds = new Set(
    connections.filter((connection) => connection.isActive !== false).map((connection) => connection.provider),
  );
  const fallbacks = getCanonicalFallbackAliases({ providerIds, aliases });
  return resolveModelAliasFromMap(alias, { ...fallbacks, ...aliases });
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const [storedAliases, connections] = await Promise.all([getModelAliases(), getProviderConnections()]);
  const providerIds = new Set(
    connections.filter((connection) => connection.isActive !== false).map((connection) => connection.provider),
  );
  const aliases = {
    ...getCanonicalFallbackAliases({ providerIds, aliases: storedAliases }),
    ...storedAliases,
  };

  // Bare combo names retain precedence over bare aliases for backwards compatibility.
  if (!modelStr.includes("/")) {
    const combo = await getComboByName(modelStr);
    if (combo) {
      return { provider: null, model: modelStr };
    }
  }

  // Exact aliases resolve before provider parsing, so full IDs such as
  // openai/gpt-x can intentionally target a different concrete route.
  const resolved = resolveModelAliasString(modelStr, aliases);
  const parsed = parseModel(resolved.model);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  const aliasResult = resolveModelAliasFromMap(parsed.model, aliases);
  if (aliasResult) return aliasResult;

  return getModelInfoCore(resolved.model, {});
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
