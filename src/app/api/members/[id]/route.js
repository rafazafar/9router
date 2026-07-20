import { NextResponse } from "next/server";
import { deleteUser, updateUser } from "@/lib/db/index.js";
import { authorizationErrorResponse, requireAdmin } from "@/lib/auth/authorization";

export async function PATCH(request, { params }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const user = await updateUser(id, await request.json());
    if (!user) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    return NextResponse.json({ user });
  } catch (error) {
    return authorizationErrorResponse(error)
      || NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const deleted = await deleteUser(id);
    if (!deleted) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return authorizationErrorResponse(error)
      || NextResponse.json({ error: error.message }, { status: 400 });
  }
}
