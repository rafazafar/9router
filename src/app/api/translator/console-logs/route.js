import { NextResponse } from "next/server";
import { clearConsoleLogs, getConsoleLogs, initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { authorizationErrorResponse, requireAdmin } from "@/lib/auth/authorization";

initConsoleLogCapture();

export async function GET(request) {
  try {
    await requireAdmin(request);
    const logs = getConsoleLogs();
    return NextResponse.json({ success: true, logs });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Error getting console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    await requireAdmin(request);
    clearConsoleLogs();
    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Error clearing console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
