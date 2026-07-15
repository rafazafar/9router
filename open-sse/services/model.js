import REGISTRY from "../providers/registry/index.js";

// Alias→id derived from registry single-source: id→id, alias→id, aliases[]→id.
// Media-only providers without a registry transport entry keep explicit aliases here.
const MEDIA_ONLY_ALIASES = {
  el: "elevenlabs",
  jina: "jina-ai",
  "jina-ai": "jina-ai",
  polly: "aws-polly",
  "aws-polly": "aws-polly",
};

const ALIAS_TO_PROVIDER_ID = { ...MEDIA_ONLY_ALIASES };
for (const entry of REGISTRY) {
  ALIAS_TO_PROVIDER_ID[entry.id] = entry.id;
  if (entry.alias) ALIAS_TO_PROVIDER_ID[entry.alias] = entry.id;
  for (const a of entry.aliases || []) ALIAS_TO_PROVIDER_ID[a] = entry.id;
}

/**
 * Resolve provider alias to provider ID
 */
export function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
}

export class ModelAliasResolutionError extends Error {
  constructor(message, code, chain = []) {
    super(message);
    this.name = "ModelAliasResolutionError";
    this.code = code;
    this.chain = chain;
  }
}

function aliasTargetToString(target) {
  if (typeof target === "string") return target.trim();
  if (target && typeof target === "object" && target.provider && target.model) {
    return `${target.provider}/${target.model}`;
  }
  return "";
}

/**
 * Resolve exact aliases, including aliases that contain a provider prefix.
 * Aliases are deliberately exact: no suffix, wildcard, or fuzzy matching.
 */
export function resolveModelAliasString(modelStr, aliases, { maxDepth = 10 } = {}) {
  const start = typeof modelStr === "string" ? modelStr.trim() : modelStr;
  if (!start || !aliases || typeof aliases !== "object") {
    return { model: start, resolved: false, chain: start ? [start] : [] };
  }

  let current = start;
  const chain = [current];
  const seen = new Set();
  let depth = 0;

  while (Object.prototype.hasOwnProperty.call(aliases, current)) {
    if (seen.has(current)) {
      throw new ModelAliasResolutionError(
        `Model alias cycle detected: ${chain.join(" -> ")}`,
        "MODEL_ALIAS_CYCLE",
        chain,
      );
    }
    if (depth >= maxDepth) {
      throw new ModelAliasResolutionError(
        `Model alias resolution exceeded maximum depth (${maxDepth}): ${chain.join(" -> ")}`,
        "MODEL_ALIAS_MAX_DEPTH",
        chain,
      );
    }

    seen.add(current);
    const target = aliasTargetToString(aliases[current]);
    if (!target) {
      throw new ModelAliasResolutionError(
        `Model alias "${current}" has an invalid target`,
        "MODEL_ALIAS_INVALID_TARGET",
        chain,
      );
    }

    current = target;
    chain.push(current);
    depth += 1;
  }

  return { model: current, resolved: current !== start, chain };
}

/**
 * Parse model string: "alias/model" or "provider/model" or just alias
 */
export function parseModel(modelStr) {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  // Check if standard format: provider/model or alias/model
  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  // Alias format (model alias, not provider alias)
  return {
    provider: null,
    model: modelStr,
    isAlias: true,
    providerAlias: null,
  };
}

/**
 * Resolve model alias from aliases object
 * Format: { "alias": "provider/model" }
 */
export function resolveModelAliasFromMap(alias, aliases) {
  const resolved = resolveModelAliasString(alias, aliases);
  if (!resolved.resolved) return null;

  // Resolved value is "provider/model" format
  if (typeof resolved.model === "string" && resolved.model.includes("/")) {
    const firstSlash = resolved.model.indexOf("/");
    const providerOrAlias = resolved.model.slice(0, firstSlash);
    return {
      provider: resolveProviderAlias(providerOrAlias),
      model: resolved.model.slice(firstSlash + 1),
    };
  }

  return null;
}

/**
 * Get full model info (parse or resolve)
 * @param {string} modelStr - Model string
 * @param {object|function} aliasesOrGetter - Aliases object or async function to get aliases
 */
export async function getModelInfoCore(modelStr, aliasesOrGetter) {
  const aliases =
    typeof aliasesOrGetter === "function"
      ? await aliasesOrGetter()
      : aliasesOrGetter;
  const resolved = resolveModelAliasString(modelStr, aliases);
  const parsed = parseModel(resolved.model);

  if (!parsed.isAlias) {
    return {
      provider: parsed.provider,
      model: parsed.model,
    };
  }

  // Fallback: infer provider from model name prefix
  return {
    provider: inferProviderFromModelName(parsed.model),
    model: parsed.model,
  };
}

// Config-driven prefix → provider inference (first match wins, fallback "openai").
const MODEL_PREFIX_PROVIDERS = [
  [/^claude-/, "anthropic"],
  [/^gemini-/, "gemini"],
  [/^gpt-/, "openai"],
  [/^o[134]/, "openai"],
  [/^deepseek-/, "openrouter"],
];

/**
 * Infer provider from model name prefix
 * Used as fallback when no provider prefix or alias is given
 */
function inferProviderFromModelName(modelName) {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  return MODEL_PREFIX_PROVIDERS.find(([re]) => re.test(m))?.[1] || "openai";
}
