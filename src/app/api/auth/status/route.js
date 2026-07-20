import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getCurrentPrincipal } from "@/lib/auth/authorization";

export async function GET(request) {
  try {
    const settings = await getSettings();
    const authToken = request?.cookies?.get?.("auth_token")?.value
      || request?.headers?.get?.("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("auth_token="))?.slice("auth_token=".length)
      || null;
    const session = await getDashboardAuthSession(authToken);
    const principal = await getCurrentPrincipal(request);
    const user = principal?.user || null;
    const authenticated = !!principal;
    const requireLogin = true;
    const authMode = settings.authMode || "password";
    const oidcName = String(session?.oidcName || "").trim();
    const oidcEmail = String(session?.oidcEmail || "").trim();
    const displayName = user?.displayName || oidcName || oidcEmail || "User";
    const loginMethod = session?.oidc ? "OIDC" : "Password";

    return NextResponse.json({
      requireLogin,
      authMode,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      hasPassword: !!settings.password,
      displayName,
      loginMethod,
      oidcName: oidcName || null,
      oidcEmail: oidcEmail || null,
      oidcLogin: !!session?.oidc,
      authenticated,
      user: authenticated ? { id: user.id, username: user.username, displayName: user.displayName, email: user.email, role: user.role } : null,
    });
  } catch {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      oidcConfigured: false,
      oidcLoginLabel: "Sign in with OIDC",
      hasPassword: false,
      displayName: "Password user",
      loginMethod: "Password",
      oidcName: null,
      oidcEmail: null,
      oidcLogin: false,
    });
  }
}
