import { NextResponse } from "next/server";
import {
  getAccessibleProviderConnectionById,
  canManageProviderConnection,
  getProxyPoolById,
  updateProviderConnection,
  deleteProviderConnection,
  getConnectionPriorityOverrides,
  setConnectionPriorityOverride,
} from "@/models";
import { authorizationErrorResponse, requireConnectionAccess, requireUser } from "@/lib/auth/authorization";

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
    return Object.fromEntries(MEMBER_PROVIDER_DATA_FIELDS.filter((field) => data[field] !== undefined).map((field) => [field, data[field]]));
  }
  return redactSecrets(data);
}

function normalizeProxyConfig(body = {}) {
  const hasAnyProxyField =
    Object.prototype.hasOwnProperty.call(body, "connectionProxyEnabled") ||
    Object.prototype.hasOwnProperty.call(body, "connectionProxyUrl") ||
    Object.prototype.hasOwnProperty.call(body, "connectionNoProxy");

  if (!hasAnyProxyField) return { hasAnyProxyField: false };

  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return {
      hasAnyProxyField: true,
      error: "Connection proxy URL is required when connection proxy is enabled",
    };
  }

  return {
    hasAnyProxyField: true,
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
  };
}

async function normalizeProxyPoolUpdate(proxyPoolIdInput) {
  if (proxyPoolIdInput === undefined) {
    return { hasProxyPoolField: false, proxyPoolId: null };
  }

  if (proxyPoolIdInput === null || proxyPoolIdInput === "" || proxyPoolIdInput === "__none__") {
    return { hasProxyPoolField: true, proxyPoolId: null };
  }

  const proxyPoolId = String(proxyPoolIdInput).trim();
  if (!proxyPoolId) {
    return { hasProxyPoolField: true, proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(proxyPoolId);
  if (!proxyPool) {
    return { hasProxyPoolField: true, error: "Proxy pool not found" };
  }

  return { hasProxyPoolField: true, proxyPoolId };
}

// Shared (non-owned) connections: members/admins may only set their own
// priority override, nothing else.
function canManageSelfPriorityOnly(body = {}) {
  return Object.keys(body).every((key) => key === "myPriority");
}

// GET /api/providers/[id] - Get single connection
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const principal = await requireUser(request);
    const connection = await requireConnectionAccess(principal, id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Hide sensitive fields
    const result = redactSecrets(connection);
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;
    result.providerSpecificData = sanitizeProviderSpecificData(connection.providerSpecificData, principal);
    result.canManage = canManageProviderConnection(principal, connection);

    return NextResponse.json({ connection: result });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error fetching connection:", error);
    return NextResponse.json({ error: "Failed to fetch connection" }, { status: 500 });
  }
}

// PUT /api/providers/[id] - Update connection
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const principal = await requireUser(request);
    const body = await request.json();
    const {
      name,
      priority,
      myPriority,
      globalPriority,
      defaultModel,
      isActive,
      apiKey,
      testStatus,
      lastError,
      lastErrorAt,
      providerSpecificData
    } = body;

    const existing = await requireConnectionAccess(principal, id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const canManage = canManageProviderConnection(principal, existing);
    if (!canManage && !canManageSelfPriorityOnly(body)) {
      return NextResponse.json({ error: "Shared connections cannot be modified" }, { status: 403 });
    }
    if (myPriority !== undefined) {
      if (existing.ownerUserId === principal.userId) {
        return NextResponse.json({ error: "Use priority for your own connections" }, { status: 400 });
      }
      if (myPriority !== null && (!Number.isInteger(myPriority) || myPriority < 1)) {
        return NextResponse.json({ error: "myPriority must be a positive integer or null" }, { status: 400 });
      }
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

    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }
    if (principal.role !== "admin" && (body.proxyPoolId !== undefined || proxyConfig.hasAnyProxyField)) {
      return NextResponse.json({ error: "Members cannot configure proxies" }, { status: 403 });
    }
    if (principal.role !== "admin" && providerSpecificData && typeof providerSpecificData === "object") {
      const forbiddenFields = [
        "baseUrl", "baseURL", "endpoint", "azureEndpoint", "host", "url",
        "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy", "proxyPoolId",
        "clientSecret", "copilotToken", "cookie", "apiKey", "accessToken", "refreshToken", "idToken",
      ];
      if (forbiddenFields.some((field) => Object.hasOwn(providerSpecificData, field))) {
        return NextResponse.json({ error: "Members cannot change endpoints, proxies, or credential metadata" }, { status: 403 });
      }
      const allowedMemberFields = new Set(MEMBER_PROVIDER_DATA_FIELDS);
      if (Object.keys(providerSpecificData).some((field) => !allowedMemberFields.has(field))) {
        return NextResponse.json({ error: "Unsupported provider metadata update" }, { status: 403 });
      }
    }

    const proxyPoolResult = await normalizeProxyPoolUpdate(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (priority !== undefined) updateData.priority = priority;
    if (globalPriority !== undefined) updateData.globalPriority = globalPriority;
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (apiKey && existing.authType === "apikey") updateData.apiKey = apiKey;
    if (principal.role === "admin" && testStatus !== undefined) updateData.testStatus = testStatus;
    if (principal.role === "admin" && lastError !== undefined) updateData.lastError = lastError;
    if (principal.role === "admin" && lastErrorAt !== undefined) updateData.lastErrorAt = lastErrorAt;

    if (
      providerSpecificData !== undefined ||
      proxyConfig.hasAnyProxyField ||
      proxyPoolResult.hasProxyPoolField
    ) {
      updateData.providerSpecificData = {
        ...(existing.providerSpecificData || {}),
        ...(providerSpecificData || {}),
      };

      if (proxyConfig.hasAnyProxyField) {
        updateData.providerSpecificData.connectionProxyEnabled = proxyConfig.connectionProxyEnabled;
        updateData.providerSpecificData.connectionProxyUrl = proxyConfig.connectionProxyUrl;
        updateData.providerSpecificData.connectionNoProxy = proxyConfig.connectionNoProxy;
      }

      if (proxyPoolResult.hasProxyPoolField) {
        if (proxyPoolResult.proxyPoolId === null) {
          delete updateData.providerSpecificData.proxyPoolId;
        } else {
          updateData.providerSpecificData.proxyPoolId = proxyPoolResult.proxyPoolId;
        }
      }
    }

    if (myPriority !== undefined) {
      await setConnectionPriorityOverride(principal.userId, id, myPriority);
    }
    const updated = Object.keys(updateData).length > 0 ? await updateProviderConnection(id, updateData) : existing;

    // Hide sensitive fields
    const result = redactSecrets(updated);
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;
    result.providerSpecificData = sanitizeProviderSpecificData(updated.providerSpecificData, principal);
    result.myPriority = (await getConnectionPriorityOverrides(principal.userId)).get(id) ?? null;

    return NextResponse.json({ connection: result });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error updating connection:", error);
    return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
  }
}

// DELETE /api/providers/[id] - Delete connection
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const principal = await requireUser(request);
    const existing = await requireConnectionAccess(principal, id);
    if (!canManageProviderConnection(principal, existing)) {
      return NextResponse.json({ error: "Shared connections cannot be deleted" }, { status: 403 });
    }

    const deleted = await deleteProviderConnection(id);
    if (!deleted) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Connection deleted successfully" });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error deleting connection:", error);
    return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 });
  }
}
