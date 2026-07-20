import { NextResponse } from "next/server";
import { clearUserPassword, updateSettings } from "@/lib/localDb";
import { authorizationErrorResponse, requireAdminOrCli } from "@/lib/auth/authorization";

// Reset dashboard password to default by clearing the stored hash.
// Local-only (enforced by dashboardGuard). Never returns the default literal.
export async function POST(request) {
  try {
    await requireAdminOrCli(request);
    await updateSettings({ password: null });
    await clearUserPassword("admin");
    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
