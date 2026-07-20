import { NextResponse } from "next/server";
import { getDistinctProviders } from "@/lib/requestDetailsDb";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { authorizationErrorResponse, requireUser } from "@/lib/auth/authorization";

/**
 * GET /api/usage/providers
 * Returns list of unique providers from request details
 */
export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const requestedUserId = new URL(request.url).searchParams.get("userId");
    const userId = principal.role === "admin" ? requestedUserId : principal.userId;
    // Query DISTINCT provider column directly — avoids parsing every row's
    // full JSON blob (can be hundreds of MB), which previously caused OOM.
    const providerIds = await getDistinctProviders(userId ? { userId } : {});

    const providers = providerIds.map(providerId => {
      let name = providerId;
      const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
      if (providerConfig?.name) name = providerConfig.name;
      return { id: providerId, name };
    });

    return NextResponse.json({ providers });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[API] Failed to get providers:", error);
    return NextResponse.json(
      { error: "Failed to fetch providers" },
      { status: 500 }
    );
  }
}
