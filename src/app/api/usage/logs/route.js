import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { authorizationErrorResponse, requireUser } from "@/lib/auth/authorization";

export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const requestedUserId = new URL(request.url).searchParams.get("userId");
    const userId = principal.role === "admin" ? requestedUserId : principal.userId;
    const logs = await getRecentLogs(200, userId ? { userId } : {});
    return NextResponse.json(logs);
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Error fetching logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
