import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeOidcCode,
  fetchOidcDiscovery,
  getOidcRuntimeConfig,
  getPublicOrigin,
  pickOidcDisplayName,
  pickOidcEmail,
  pickVerifiedOidcEmail,
  verifyOidcIdToken,
} from "@/lib/auth/oidc";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { dashboardClaimsForUser } from "@/lib/auth/dashboardSession";
import { bindUserOidcIdentity, getInvitedOidcUserByEmail, getUserByOidcIdentity, migrateUserOidcIssuer } from "@/lib/localDb";

function clearOidcCookies(cookieStore) {
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
}

export async function GET(request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, getPublicOrigin(request)));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=oidc_missing_code", getPublicOrigin(request)));
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get("oidc_state")?.value;
  const storedNonce = cookieStore.get("oidc_nonce")?.value;
  const codeVerifier = cookieStore.get("oidc_code_verifier")?.value;

  if (!storedState || !storedNonce || !codeVerifier || storedState !== state) {
    clearOidcCookies(cookieStore);
    return NextResponse.redirect(new URL("/login?error=oidc_invalid_state", getPublicOrigin(request)));
  }

  try {
    const config = await getOidcRuntimeConfig();
    if (!config) {
      clearOidcCookies(cookieStore);
      return NextResponse.redirect(new URL("/login?error=oidc_not_configured", getPublicOrigin(request)));
    }

    const discovery = await fetchOidcDiscovery(config.issuerUrl);
    const discoveredIssuer = discovery.issuer || config.issuerUrl;
    const identityIssuer = discoveredIssuer.replace(/\/+$/, "");
    const redirectUri = `${getPublicOrigin(request)}/api/auth/oidc/callback`;
    const tokenData = await exchangeOidcCode({
      tokenEndpoint: discovery.token_endpoint,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
      codeVerifier,
    });

    if (!tokenData.id_token) {
      throw new Error("OIDC provider did not return an id_token");
    }

    const payload = await verifyOidcIdToken({
      idToken: tokenData.id_token,
      issuer: discoveredIssuer,
      audience: config.clientId,
      jwksUri: discovery.jwks_uri,
      nonce: storedNonce,
    });

    const subject = payload.sub;
    if (!subject) throw new Error("OIDC provider did not return a subject")
    const email = pickOidcEmail(payload);
    let user = subject ? await getUserByOidcIdentity(identityIssuer, subject) : null;
    const configuredIssuer = config.issuerUrl.replace(/\/+$/, "");
    if (!user && configuredIssuer !== identityIssuer) {
      const legacyUser = await getUserByOidcIdentity(configuredIssuer, subject);
      if (legacyUser) user = await migrateUserOidcIssuer(legacyUser.id, configuredIssuer, subject, identityIssuer);
    }
    if (!user && email) {
      if (!pickVerifiedOidcEmail(payload)) {
        throw new Error("OIDC provider did not verify the invited email")
      }
      const invited = await getInvitedOidcUserByEmail(email);
      if (invited) user = await bindUserOidcIdentity(invited.id, identityIssuer, subject);
    }
    if (!user || user.status !== "active") {
      throw new Error("This OIDC identity has not been invited")
    }

    clearOidcCookies(cookieStore);
    await setDashboardAuthCookie(cookieStore, request, dashboardClaimsForUser(user, {
      oidc: true,
      oidcSub: payload.sub || null,
      oidcEmail: pickOidcEmail(payload) || null,
      oidcName: pickOidcDisplayName(payload),
    }));

    return NextResponse.redirect(new URL("/dashboard", getPublicOrigin(request)));
  } catch (error) {
    clearOidcCookies(cookieStore);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message || "oidc_callback_failed")}`, getPublicOrigin(request)));
  }
}
