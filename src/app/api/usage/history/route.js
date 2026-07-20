import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { getUserUsageStats } from "@/lib/db/index.js";
import { authorizationErrorResponse, requireUser } from "@/lib/auth/authorization";

export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const stats = principal.role === "admin" ? await getUsageStats() : await getUserUsageStats(principal.userId);
    return NextResponse.json(stats);
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
