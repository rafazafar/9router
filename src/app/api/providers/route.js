import { NextResponse } from "next/server";
import {
  getAccessibleProviderConnections,
  createProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById,
} from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";
import { authorizationErrorResponse, requireUser } from "@/lib/auth/authorization";
import { getUserById, getUsers, getConnectionPriorityOverrides } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

const MEMBER_PROVIDER_DATA_FIELDS = [
  "nodeName", "prefix", "apiType", "enabledModels", "authMethod", "provider",
  "chatgptPlanType", "region", "projectId", "accountId",
];
const SECRET_FIELDS = new Set(["clientsecret", "copilottoken", "cookie", "apikey", "accesstoken", "refreshtoken", "idtoken", "authorization", "password", "headers", "token", "secret", "credential", "credentials"]);

function isSecretField(key) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_FIELDS.has(normalized)
    || normalized.includes("authorization")
    || normalized.includes("headers")
    || normalized.includes("apikey")
    || normalized.includes("token")
    || normalized.includes("secret")
    || normalized.includes("credential")
    || normalized.includes("password");
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !isSecretField(key))
    .map(([key, item]) => [key, redactSecrets(item)]));
}

function sanitizeProviderSpecificData(data, principal) {
  if (!data || typeof data !== "object") return undefined;
  if (principal.role !== "admin") {
    const safe = {};
    for (const field of MEMBER_PROVIDER_DATA_FIELDS) {
      if (data[field] !== undefined) safe[field] = data[field];
    }
    return Object.keys(safe).length ? safe : undefined;
  }
  return redactSecrets(data);
}

function normalizeProxyConfig(body = {}) {
  const hasAnyProxyField =
    Object.prototype.hasOwnProperty.call(body, "connectionProxyEnabled") ||
    Object.prototype.hasOwnProperty.call(body, "connectionProxyUrl") ||
    Object.prototype.hasOwnProperty.call(body, "connectionNoProxy");
  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return { error: "Connection proxy URL is required when connection proxy is enabled" };
  }

  return {
    hasAnyProxyField,
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
  };
}

async function normalizeProxyPoolId(proxyPoolId) {
  if (proxyPoolId === undefined || proxyPoolId === null || proxyPoolId === "" || proxyPoolId === "__none__") {
    return { proxyPoolId: null };
  }

  const normalizedId = String(proxyPoolId).trim();
  if (!normalizedId) {
    return { proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(normalizedId);
  if (!proxyPool) {
    return { error: "Proxy pool not found" };
  }

  return { proxyPoolId: normalizedId };
}

// GET /api/providers - List all connections
export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const [connections, users, myOverrides] = await Promise.all([
      getAccessibleProviderConnections(principal),
      principal.role === "admin" ? getUsers() : Promise.resolve([]),
      getConnectionPriorityOverrides(principal.userId),
    ]);
    const userNames = new Map(users.map((user) => [user.id, user.displayName || user.username]));
    if (principal.role !== "admin") {
      const ownerIds = [...new Set(connections.map((connection) => connection.ownerUserId).filter((id) => id && id !== principal.userId))];
      const owners = await Promise.all(ownerIds.map((id) => getUserById(id)));
      for (const owner of owners.filter(Boolean)) userNames.set(owner.id, owner.displayName || owner.username);
    }

    // Build nodeNameMap for compatible providers (id → name)
    let nodeNameMap = {};
    try {
      const nodes = await getProviderNodes();
      for (const node of nodes) {
        if (node.id && node.name) nodeNameMap[node.id] = node.name;
      }
    } catch { }

    // Hide sensitive fields, enrich name for compatible providers
    const safeConnections = connections.map(c => {
      const isCompatible = isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider);
      const name = isCompatible
        ? (c.name || nodeNameMap[c.provider] || c.providerSpecificData?.nodeName || c.provider)
        : c.name;
      return {
        ...redactSecrets(c),
        name,
        apiKey: undefined,
        accessToken: undefined,
        refreshToken: undefined,
        idToken: undefined,
        canManage: principal.role === "admin" || c.ownerUserId === principal.userId,
        ownership: c.ownerUserId === principal.userId ? "owned" : "shared",
        myPriority: myOverrides.get(c.id) ?? null,
        ownerDisplayName: c.ownerUserId === principal.userId
          ? (principal.user.displayName || principal.user.username)
          : (userNames.get(c.ownerUserId) || null),
        providerSpecificData: sanitizeProviderSpecificData(c.providerSpecificData, principal),
      };
    });

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

// POST /api/providers - Create new connection (API Key only, OAuth via separate flow)
export async function POST(request) {
  try {
    const principal = await requireUser(request);
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const { apiKey, name, displayName, priority, globalPriority, defaultModel, testStatus } = body;
    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolId(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }
    const proxyPoolId = proxyPoolResult.proxyPoolId;
    if (principal.role !== "admin" && (proxyPoolId !== null || proxyConfig.hasAnyProxyField)) {
      return NextResponse.json({ error: "Members cannot configure proxies" }, { status: 403 });
    }
    if (principal.role !== "admin" && globalPriority !== undefined) {
      return NextResponse.json({ error: "Global priority requires administrator access" }, { status: 403 });
    }
    if (principal.role !== "admin" && defaultModel !== undefined) {
      return NextResponse.json({ error: "Default model requires administrator access" }, { status: 403 });
    }
    if (principal.role !== "admin" && priority !== undefined && (!Number.isInteger(priority) || priority < 1)) {
      return NextResponse.json({ error: "Priority must be a positive integer" }, { status: 400 });
    }

    // Validation
    const isWebCookieProvider = !!WEB_COOKIE_PROVIDERS[provider];
    // Dual-auth providers (e.g. codebuddy-cn, xai) live under category "oauth" but also
    // accept an API key via authModes — they aren't in APIKEY_PROVIDERS, so allow them here.
    const supportsApiKeyMode = !!AI_PROVIDERS[provider]?.authModes?.includes("apikey");
    const isValidProvider = APIKEY_PROVIDERS[provider] ||
      FREE_TIER_PROVIDERS[provider] ||
      supportsApiKeyMode ||
      isWebCookieProvider ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider) ||
      isCustomEmbeddingProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (principal.role !== "admin" && (isOpenAICompatibleProvider(provider) || isAnthropicCompatibleProvider(provider) || isCustomEmbeddingProvider(provider))) {
      return NextResponse.json({ error: "Custom provider nodes require administrator access" }, { status: 403 });
    }
    if (!apiKey && provider !== "ollama-local") {
      return NextResponse.json({ error: `${isWebCookieProvider ? "Cookie value" : "API Key"} is required` }, { status: 400 });
    }
    const connectionName = name || displayName || AI_PROVIDERS[provider]?.name;
    if (!connectionName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData);
    if (principal.role !== "admin") {
      const memberControlled = { ...(body.providerSpecificData || {}), ...body };
      const forbiddenUrlFields = ["baseUrl", "baseURL", "endpoint", "azureEndpoint", "host", "url"];
      if (provider === "ollama-local" || forbiddenUrlFields.some((field) => typeof memberControlled[field] === "string" && memberControlled[field].trim())) {
        return NextResponse.json({ error: "Custom endpoints and local-network providers require administrator access" }, { status: 403 });
      }
      if (providerSpecificData && Object.keys(providerSpecificData).some((field) => !MEMBER_PROVIDER_DATA_FIELDS.includes(field))) {
        return NextResponse.json({ error: "Unsupported provider metadata" }, { status: 403 });
      }
    }

    // Compatible LLM nodes support multiple API-key connections (key pool); runtime
    // rotates/fails over via getProviderCredentials. Embedding nodes stay single-connection.
    if (isOpenAICompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isCustomEmbeddingProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    }

    const mergedProviderSpecificData = {
      ...(providerSpecificData || {}),
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled,
      connectionProxyUrl: proxyConfig.connectionProxyUrl,
      connectionNoProxy: proxyConfig.connectionNoProxy,
    };

    if (proxyPoolId !== null) {
      mergedProviderSpecificData.proxyPoolId = proxyPoolId;
    }

    const newConnection = await createProviderConnection({
      provider,
      authType: isWebCookieProvider ? "cookie" : "apikey",
      name: connectionName,
      apiKey: apiKey || "",
      priority: priority || 1,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData: mergedProviderSpecificData,
      isActive: true,
      testStatus: principal.role === "admin" ? (testStatus || "unknown") : "unknown",
      ownerUserId: principal.userId,
    });

    // Hide sensitive fields
    const result = { ...newConnection };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;
    result.providerSpecificData = sanitizeProviderSpecificData(newConnection.providerSpecificData, principal);

    return NextResponse.json({ connection: result }, { status: 201 });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
