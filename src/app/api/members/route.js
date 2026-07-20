import { NextResponse } from "next/server";
import { createUser, getUsers } from "@/lib/db/index.js";
import { authorizationErrorResponse, requireAdmin } from "@/lib/auth/authorization";

export async function GET(request) {
  try {
    await requireAdmin(request);
    return NextResponse.json({ users: await getUsers() });
  } catch (error) {
    return authorizationErrorResponse(error)
      || NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const user = await createUser(body);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const status = /required|unique/i.test(error.message) ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
