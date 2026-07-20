import { NextResponse } from "next/server";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import { KiroService } from "@/lib/oauth/services/kiro";
import { requireUser } from "@/lib/auth/authorization";
import { bindOAuthOwner } from "@/lib/oauth/ownerState";

/**
 * GET /api/oauth/kiro/social-authorize
 * Generate Google/GitHub social login URL for manual callback flow
 * Uses kiro:// custom protocol as required by AWS Cognito
 */
export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider"); // "google" or "github"

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Use 'google' or 'github'" },
        { status: 400 }
      );
    }

    // Generate PKCE for social auth
    const { codeVerifier, codeChallenge, state } = generatePKCE();
    await bindOAuthOwner(state, principal.userId);

    const kiroService = new KiroService();
    const authUrl = kiroService.buildSocialLoginUrl(
      provider,
      codeChallenge,
      state
    );

    return NextResponse.json({
      authUrl,
      state,
      codeVerifier,
      codeChallenge,
      provider,
    });
  } catch (error) {
    console.log("Kiro social authorize error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
