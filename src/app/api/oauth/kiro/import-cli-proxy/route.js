import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { normalizeKiroExternalIdpAuth } from "@/lib/oauth/kiroExternalIdp";
import { requireUser } from "@/lib/auth/authorization";

/**
 * POST /api/oauth/kiro/import-cli-proxy
 * Import Kiro CLIProxyAPI auth JSON for Microsoft external_idp accounts.
 */
export async function POST(request) {
  try {
    const principal = await requireUser(request);
    const body = await request.json();
    const rawAuth = body?.cliProxyAuth ?? body?.auth ?? body?.json ?? body;
    const tokenData = normalizeKiroExternalIdpAuth(rawAuth);

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: tokenData.expiresAt,
      email: tokenData.email || null,
      providerSpecificData: tokenData.providerSpecificData,
      testStatus: "active",
      ownerUserId: principal.userId,
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "CLIProxyAPI import failed" },
      { status: 400 }
    );
  }
}
