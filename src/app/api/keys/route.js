import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getAccessibleProviderConnections, getUsers } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { authorizationErrorResponse, requireUser } from "@/lib/auth/authorization";
import { getEffectiveApiKeyConnectionIds } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const [keys, connections, users] = await Promise.all([
      getApiKeys(principal.role === "admin" ? null : principal.userId),
      getAccessibleProviderConnections(principal),
      principal.role === "admin" ? getUsers() : Promise.resolve([]),
    ]);
    const userNames = new Map(users.map((user) => [user.id, user.displayName || user.username]));
    const safeConnections = connections.map(({ id, provider, name, displayName, email, isActive }) => ({
      id, provider, name: displayName || name || email || id, isActive,
    }));
    const safeKeys = await Promise.all(keys.map(async ({ key: secret, ...key }) => ({
      ...key,
      key: secret,
      keyPrefix: secret ? `${secret.slice(0, 8)}...` : null,
      ownerDisplayName: key.ownerUserId === principal.userId ? "You" : (userNames.get(key.ownerUserId) || "Unknown user"),
      accessibleConnectionIds: (await getEffectiveApiKeyConnectionIds(key)).filter((id) => id !== "__noauth__"),
    })));
    return NextResponse.json({
      keys: safeKeys,
      connections: safeConnections,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const principal = await requireUser(request);
    const body = await request.json();
    const { name, dailyRequestLimit, dailyTokenLimit, allowedConnectionIds } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const accessible = await getAccessibleProviderConnections(principal);
    const accessibleIds = new Set(accessible.map((connection) => connection.id));
    if ((allowedConnectionIds || []).some((id) => !accessibleIds.has(id))) {
      return NextResponse.json({ error: "API key policy contains an inaccessible connection" }, { status: 403 });
    }
    const apiKey = await createApiKey(name, machineId, {
      dailyRequestLimit, dailyTokenLimit, allowedConnectionIds, ownerUserId: principal.userId,
    });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      dailyRequestLimit: apiKey.dailyRequestLimit,
      dailyTokenLimit: apiKey.dailyTokenLimit,
      allowedConnectionIds: apiKey.allowedConnectionIds,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error creating key:", error);
    const status = error.message?.includes("must") ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? error.message : "Failed to create key" }, { status });
  }
}
