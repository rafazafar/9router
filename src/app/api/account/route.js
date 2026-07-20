import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { getSettings, updateSettings, getUserById, updateUser } from "@/lib/db/index.js";
import { authorizationErrorResponse, requireUser } from "@/lib/auth/authorization";

export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const current = await getUserById(principal.userId, { includePassword: true });
    return NextResponse.json({ user: principal.user, hasPassword: principal.userId === "admin" || !!current?.passwordHash });
  } catch (error) {
    return authorizationErrorResponse(error) || NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const principal = await requireUser(request);
    const body = await request.json();
    const current = await getUserById(principal.userId, { includePassword: true });
    if (body.newPassword) {
      const settings = principal.userId === "admin" ? await getSettings() : null;
      const currentHash = principal.userId === "admin" ? (settings?.password || current?.passwordHash) : current?.passwordHash;
      const currentPasswordValid = currentHash
        ? await bcrypt.compare(body.currentPassword || "", currentHash)
        : principal.userId === "admin" && body.currentPassword === (process.env.INITIAL_PASSWORD || "123456");
      if (!body.currentPassword || !currentPasswordValid) {
        return NextResponse.json({ error: "Current password is invalid" }, { status: 401 });
      }
      if (String(body.newPassword).length < 8) {
        return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
      }
      const user = await updateUser(principal.userId, { password: body.newPassword, revokeSessions: true });
      if (principal.userId === "admin") await updateSettings({ password: await bcrypt.hash(body.newPassword, 10) });
      return NextResponse.json({ user, sessionsRevoked: true });
    }
    if (body.revokeSessions === true) {
      const user = await updateUser(principal.userId, { revokeSessions: true });
      return NextResponse.json({ user, sessionsRevoked: true });
    }
    return NextResponse.json({ error: "No account change requested" }, { status: 400 });
  } catch (error) {
    return authorizationErrorResponse(error) || NextResponse.json({ error: error.message }, { status: 500 });
  }
}
