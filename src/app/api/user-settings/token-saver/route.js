import { NextResponse } from "next/server";
import {
  getEffectiveUserTokenSaverSettings,
  getSettings,
  getUserTokenSaverOverrides,
  updateUserTokenSaverSettings,
} from "@/lib/localDb";
import { authorizationErrorResponse, requireUser } from "@/lib/auth/authorization";

const HEADERS = { "Cache-Control": "no-store" };

export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const globalSettings = await getSettings();
    const [settings, overrides] = await Promise.all([
      getEffectiveUserTokenSaverSettings(principal.userId, globalSettings),
      getUserTokenSaverOverrides(principal.userId),
    ]);
    return NextResponse.json({ settings, overrides }, { headers: HEADERS });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
  }
}

export async function PATCH(request) {
  try {
    const principal = await requireUser(request);
    await updateUserTokenSaverSettings(principal.userId, await request.json());
    const settings = await getEffectiveUserTokenSaverSettings(principal.userId, await getSettings());
    return NextResponse.json({ settings }, { headers: HEADERS });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
  }
}
