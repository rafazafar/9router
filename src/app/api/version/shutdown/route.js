import { NextResponse } from "next/server";
import { killAppProcesses } from "@/lib/appUpdater";
import { authorizationErrorResponse, requireAdminOrCli } from "@/lib/auth/authorization";

// Shutdown app to release file locks for manual update
export async function POST(request) {
  try {
    await requireAdminOrCli(request);
  } catch (error) {
    return authorizationErrorResponse(error) || NextResponse.json({ error: error.message }, { status: 500 });
  }
  try {
    await killAppProcesses();
  } catch { /* best effort */ }

  const response = NextResponse.json({ success: true, message: "Shutting down for manual update..." });

  setTimeout(() => process.exit(0), 500);

  return response;
}
