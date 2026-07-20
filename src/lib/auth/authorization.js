import { cookies } from "next/headers";
import crypto from "node:crypto";
import { getDashboardAuthSession } from "./dashboardSession.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import {
  getUserById,
  getAccessibleProviderConnections,
  getAccessibleProviderConnectionById,
  getApiKeyByValue,
} from "@/lib/db/index.js";

export class AuthorizationError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

function getCookieFromHeader(request, name) {
  const header = request?.headers?.get?.("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export function hasPresentedDashboardSession(request) {
  return !!(
    request?.cookies?.get?.("auth_token")?.value
    || getCookieFromHeader(request, "auth_token")
  );
}

export async function getCurrentPrincipal(request = null) {
  const token = request
    ? (request.cookies?.get?.("auth_token")?.value || getCookieFromHeader(request, "auth_token"))
    : (await cookies()).get("auth_token")?.value;
  const session = await getDashboardAuthSession(token);
  if (!session?.sub) return null;
  const user = await getUserById(session.sub);
  if (!user || user.status !== "active" || user.sessionVersion !== session.sessionVersion) return null;
  return { userId: user.id, role: user.role, user };
}

export async function requireUser(request = null) {
  if (request && await hasValidCliToken(request)) {
    const user = await getUserById("admin");
    if (!user || user.status !== "active" || user.role !== "admin") throw new AuthorizationError("Unauthorized", 401);
    return { userId: user.id, role: user.role, user, cli: true };
  }
  const principal = await getCurrentPrincipal(request);
  if (!principal) throw new AuthorizationError("Unauthorized", 401);
  return principal;
}

export async function requireAdmin(request = null) {
  const principal = await requireUser(request);
  if (principal.role !== "admin") throw new AuthorizationError("Administrator access required", 403);
  return principal;
}

export async function hasValidCliToken(request) {
  const presented = request?.headers?.get?.("x-9r-cli-token");
  if (!presented) return false;
  const expected = await getConsistentMachineId("9r-cli-auth");
  const presentedBuffer = Buffer.from(presented);
  const expectedBuffer = Buffer.from(expected);
  return presentedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(presentedBuffer, expectedBuffer);
}

export async function requireAdminOrCli(request) {
  return requireAdmin(request);
}

export async function requireConnectionAccess(principal, connectionId) {
  if (!principal?.userId) throw new AuthorizationError("Unauthorized", 401);
  const connection = await getAccessibleProviderConnectionById(principal, connectionId);
  if (!connection) throw new AuthorizationError("Connection not found", 404);
  return connection;
}

export function authorizationErrorResponse(error) {
  if (error instanceof AuthorizationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export async function getEffectiveApiKeyConnectionIds(apiKey) {
  if (!apiKey?.ownerUserId) return [];
  const owner = await getUserById(apiKey.ownerUserId);
  if (!owner || owner.status !== "active") return [];
  const accessible = await getAccessibleProviderConnections({ userId: owner.id, role: owner.role });
  const accessibleIds = accessible.map((connection) => connection.id);
  if (owner.role === "admin") accessibleIds.push("__noauth__");
  if (!apiKey.allowedConnectionIds?.length) return accessibleIds;
  const accessibleSet = new Set(accessibleIds);
  return apiKey.allowedConnectionIds.filter((id) => accessibleSet.has(id));
}

export async function resolveRequestConnectionIds(request, apiKeyValue = null) {
  if (apiKeyValue) {
    const apiKey = await getApiKeyByValue(apiKeyValue);
    if (!apiKey?.isActive) throw new AuthorizationError("Invalid API key", 401);
    const owner = await getUserById(apiKey.ownerUserId);
    if (!owner || owner.status !== "active") throw new AuthorizationError("Invalid API key", 401);
    return getEffectiveApiKeyConnectionIds(apiKey);
  }
  const principal = await getCurrentPrincipal(request);
  if (hasPresentedDashboardSession(request) && !principal) {
    throw new AuthorizationError("Invalid session", 401);
  }
  if (!principal || principal.role === "admin") return undefined;
  const connections = await getAccessibleProviderConnections(principal, { isActive: true });
  return connections.map((connection) => connection.id);
}
