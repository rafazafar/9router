import { NextResponse } from "next/server";
import {
  getAccessibleProviderConnections,
  setUserProviderConnectionOrder,
  resetUserProviderConnectionOrder,
} from "@/lib/db/index.js";
import { authorizationErrorResponse, requireUser } from "@/lib/auth/authorization";

export async function PUT(request) {
  try {
    const principal = await requireUser(request);
    const { provider, connectionIds } = await request.json();
    if (typeof provider !== "string" || !provider.trim()) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }
    if (!Array.isArray(connectionIds)) {
      return NextResponse.json({ error: "connectionIds must be an array" }, { status: 400 });
    }

    const accessible = await getAccessibleProviderConnections(principal, { provider: provider.trim() });
    const accessibleIds = new Set(accessible.map((connection) => connection.id));
    const uniqueIds = new Set(connectionIds);
    if (
      connectionIds.some((id) => typeof id !== "string" || !accessibleIds.has(id))
      || uniqueIds.size !== connectionIds.length
      || connectionIds.length !== accessibleIds.size
    ) {
      return NextResponse.json({ error: "connectionIds must exactly match accessible provider connections" }, { status: 400 });
    }

    await setUserProviderConnectionOrder(principal.userId, provider.trim(), connectionIds);
    return NextResponse.json({ connectionIds, hasPersonalOrder: true });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (error.message?.includes("connectionIds")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.log("Error updating personal provider order:", error);
    return NextResponse.json({ error: error.message || "Failed to update personal provider order" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const principal = await requireUser(request);
    const provider = new URL(request.url).searchParams.get("provider")?.trim();
    if (!provider) return NextResponse.json({ error: "provider is required" }, { status: 400 });
    await resetUserProviderConnectionOrder(principal.userId, provider);
    return NextResponse.json({ hasPersonalOrder: false });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error resetting personal provider order:", error);
    return NextResponse.json({ error: "Failed to reset personal provider order" }, { status: 500 });
  }
}
