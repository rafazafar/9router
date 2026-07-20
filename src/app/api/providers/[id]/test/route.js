import { NextResponse } from "next/server";
import { testSingleConnection } from "./testUtils.js";
import { canManageProviderConnection, getAccessibleProviderConnectionById } from "@/lib/db/index.js";
import { requireConnectionAccess, requireUser } from "@/lib/auth/authorization";

// POST /api/providers/[id]/test - Test connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const principal = await requireUser(request);
    const connection = await requireConnectionAccess(principal, id);
    if (!canManageProviderConnection(principal, connection)) {
      return NextResponse.json({ error: "Shared connections cannot be tested or refreshed" }, { status: 403 });
    }
    const result = await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
