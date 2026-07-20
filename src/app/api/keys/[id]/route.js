import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, getUserById, updateApiKey } from "@/lib/localDb";
import { getAccessibleProviderConnections } from "@/lib/localDb";
import { authorizationErrorResponse, requireUser } from "@/lib/auth/authorization";

function canManageKey(principal, key) {
  return principal.role === "admin" || key?.ownerUserId === principal.userId;
}

function sanitizeKey({ key: secret, ...key }) {
  return { ...key, keyPrefix: secret ? `${secret.slice(0, 8)}...` : null };
}

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const principal = await requireUser(request);
    const key = await getApiKeyById(id);
    if (!key || !canManageKey(principal, key)) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key: sanitizeKey(key) });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const principal = await requireUser(request);
    const body = await request.json();
    const { isActive, name, dailyRequestLimit, dailyTokenLimit, allowedConnectionIds } = body;

    const existing = await getApiKeyById(id);
    if (!existing || !canManageKey(principal, existing)) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (name !== undefined) updateData.name = name;
    if (dailyRequestLimit !== undefined) updateData.dailyRequestLimit = dailyRequestLimit;
    if (dailyTokenLimit !== undefined) updateData.dailyTokenLimit = dailyTokenLimit;
    if (allowedConnectionIds !== undefined) {
      if (!Array.isArray(allowedConnectionIds)) {
        return NextResponse.json({ error: "allowedConnectionIds must be an array" }, { status: 400 });
      }
      const owner = await getUserById(existing.ownerUserId);
      if (!owner || owner.status !== "active") {
        return NextResponse.json({ error: "API key owner is not active" }, { status: 400 });
      }
      const accessible = await getAccessibleProviderConnections({ userId: owner.id, role: owner.role });
      const accessibleIds = new Set(accessible.map((connection) => connection.id));
      if (allowedConnectionIds.some((connectionId) => !accessibleIds.has(connectionId))) {
        return NextResponse.json({ error: "API key policy contains an inaccessible connection" }, { status: 403 });
      }
      updateData.allowedConnectionIds = allowedConnectionIds;
    }

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: sanitizeKey(updated) });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error updating key:", error);
    const status = error.message?.includes("must") ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? error.message : "Failed to update key" }, { status });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const principal = await requireUser(request);
    const existing = await getApiKeyById(id);
    if (!existing || !canManageKey(principal, existing)) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
