import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { getUserUsageStats } from "@/lib/db/index.js";
import { authorizationErrorResponse, requireUser } from "@/lib/auth/authorization";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    const requestedUserId = searchParams.get("userId");

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const stats = principal.role === "admin"
      ? (requestedUserId ? await getUserUsageStats(requestedUserId, period) : await getUsageStats(period))
      : await getUserUsageStats(principal.userId, period);
    return NextResponse.json(stats);
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[API] Failed to get usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
