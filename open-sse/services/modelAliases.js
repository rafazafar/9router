import REGISTRY from "../providers/registry/index.js";
import { resolveModelAliasString } from "./model.js";

const MAX_MODEL_REFERENCE_LENGTH = 512;
const UNSAFE_ALIAS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const RESERVED_PROVIDER_PREFIXES = new Set();
const PROVIDER_ID_BY_PREFIX = new Map();
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  PROVIDER_ID_BY_PREFIX.set(entry.id, entry.id);
  if (entry.alias) {
    RESERVED_PROVIDER_PREFIXES.add(entry.alias);
    PROVIDER_ID_BY_PREFIX.set(entry.alias, entry.id);
  }
  for (const alias of entry.aliases || []) {
    RESERVED_PROVIDER_PREFIXES.add(alias);
    PROVIDER_ID_BY_PREFIX.set(alias, entry.id);
  }
}

export class ModelAliasValidationError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "ModelAliasValidationError";
    this.code = code;
    this.status = status;
  }
}

function normalizeReference(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ModelAliasValidationError(`${label} is required`, "MODEL_ALIAS_REQUIRED");
  }
  const normalized = value.trim();
  if (normalized.length > MAX_MODEL_REFERENCE_LENGTH) {
    throw new ModelAliasValidationError(
      `${label} must be ${MAX_MODEL_REFERENCE_LENGTH} characters or fewer`,
      "MODEL_ALIAS_TOO_LONG",
    );
  }
  return normalized;
}

function hasReservedProviderPrefix(modelRef) {
  if (!modelRef.includes("/")) return false;
  return RESERVED_PROVIDER_PREFIXES.has(modelRef.slice(0, modelRef.indexOf("/")));
}

export function validateModelAlias({ alias, target, aliases = {}, allowOverride = false }) {
  const normalizedAlias = normalizeReference(alias, "Alias");
  const normalizedTarget = normalizeReference(target, "Target model");
  if (UNSAFE_ALIAS_KEYS.has(normalizedAlias)) {
    throw new ModelAliasValidationError("Alias uses a reserved object key", "MODEL_ALIAS_RESERVED_KEY");
  }
  const shadowsProviderRoute = hasReservedProviderPrefix(normalizedAlias);

  if (shadowsProviderRoute && !allowOverride && aliases[normalizedAlias] !== normalizedTarget) {
    throw new ModelAliasValidationError(
      `Alias "${normalizedAlias}" shadows a registered provider route. Confirm the override to continue.`,
      "MODEL_ALIAS_ROUTE_CONFLICT",
      409,
    );
  }

  let resolved;
  try {
    resolved = resolveModelAliasString(normalizedAlias, {
      ...aliases,
      [normalizedAlias]: normalizedTarget,
    });
  } catch (error) {
    throw new ModelAliasValidationError(error.message, error.code || "MODEL_ALIAS_INVALID");
  }

  if (!resolved.model.includes("/") || resolved.model.startsWith("/") || resolved.model.endsWith("/")) {
    throw new ModelAliasValidationError(
      "Alias target must resolve to a provider-qualified model ID",
      "MODEL_ALIAS_TARGET_NOT_QUALIFIED",
    );
  }

  return {
    alias: normalizedAlias,
    target: normalizedTarget,
    resolvedTarget: resolved.model,
    shadowsProviderRoute,
  };
}

export function appendAliasModelEntries(models, aliases) {
  const result = [...models];
  const directById = new Map(models.filter((model) => model?.id).map((model) => [model.id, model]));
  const indexById = new Map(result.map((model, index) => [model.id, index]));

  for (const alias of Object.keys(aliases || {})) {
    if (!alias) continue;

    let resolved;
    try {
      resolved = resolveModelAliasString(alias, aliases);
    } catch {
      continue;
    }
    const target = directById.get(resolved.model);
    if (!target) continue;

    const slash = alias.indexOf("/");
    const aliasEntry = {
      ...target,
      id: alias,
      owned_by: slash > 0 ? alias.slice(0, slash) : "alias",
      "x-zrouter-target": resolved.model,
    };
    const existingIndex = indexById.get(alias);
    if (existingIndex === undefined) {
      indexById.set(alias, result.length);
      result.push(aliasEntry);
    } else {
      result[existingIndex] = aliasEntry;
    }
  }

  return result;
}

export function getDependentAliases(alias, aliases = {}) {
  return Object.entries(aliases)
    .filter(([, target]) => {
      if (typeof target === "string") return target.trim() === alias;
      return target?.provider && target?.model && `${target.provider}/${target.model}` === alias;
    })
    .map(([dependent]) => dependent)
    .sort();
}

export function getCanonicalAliasSuggestions(aliases = {}, { providerIds } = {}) {
  const suggestions = [];
  const seen = new Set();

  for (const provider of REGISTRY) {
    if (providerIds && !providerIds.has(provider.id)) continue;
    const routePrefix = provider.alias || provider.id;
    for (const model of provider.models || []) {
      if (!model?.canonicalId || aliases[model.canonicalId] || seen.has(model.canonicalId)) continue;
      const target = `${routePrefix}/${model.id}`;
      if (model.canonicalId === target) continue;
      suggestions.push({
        alias: model.canonicalId,
        target,
        provider: provider.id,
        model: model.id,
      });
      seen.add(model.canonicalId);
    }
  }

  return suggestions;
}

/**
 * Build low-priority canonical aliases for connected providers. A fallback is
 * only safe when the canonical provider itself is not connected and exactly
 * one connected route advertises that canonical model ID.
 */
export function getCanonicalFallbackAliases({ providerIds = new Set(), aliases = {} } = {}) {
  const candidates = new Map();

  for (const provider of REGISTRY) {
    if (!providerIds.has(provider.id)) continue;
    const routePrefix = provider.alias || provider.id;
    for (const model of provider.models || []) {
      if (!model?.canonicalId || aliases[model.canonicalId]) continue;
      const canonicalPrefix = model.canonicalId.split("/", 1)[0];
      const canonicalProviderId = PROVIDER_ID_BY_PREFIX.get(canonicalPrefix) || canonicalPrefix;
      if (providerIds.has(canonicalProviderId)) continue;

      const targets = candidates.get(model.canonicalId) || new Set();
      targets.add(`${routePrefix}/${model.id}`);
      candidates.set(model.canonicalId, targets);
    }
  }

  const fallbacks = {};
  for (const [canonicalId, targets] of candidates) {
    if (targets.size === 1) fallbacks[canonicalId] = [...targets][0];
  }
  return fallbacks;
}
