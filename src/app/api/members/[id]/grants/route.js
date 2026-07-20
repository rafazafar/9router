import { NextResponse } from "next/server";
import { getConnectionGrants, replaceConnectionGrants } from "@/lib/db/index.js";
import { authorizationErrorResponse, requireAdmin } from "@/lib/auth/authorization";

export async function GET(request, { params }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const grants = (await getConnectionGrants()).filter((grant) => grant.userId === id);
    return NextResponse.json({ connectionIds: grants.map((grant) => grant.connectionId) });
  } catch (error) {
    return authorizationErrorResponse(error)
      || NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const principal = await requireAdmin(request);
    const { id } = await params;
    const { connectionIds } = await request.json();
    if (!Array.isArray(connectionIds)) return NextResponse.json({ error: "connectionIds must be an array" }, { status: 400 });
    const savedConnectionIds = await replaceConnectionGrants(id, connectionIds, principal.userId);
    return NextResponse.json({ connectionIds: savedConnectionIds });
  } catch (error) {
    return authorizationErrorResponse(error)
      || NextResponse.json({ error: error.message }, { status: 400 });
  }
}
