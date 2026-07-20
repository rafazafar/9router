import { NextResponse } from "next/server";
import { FILTERS } from "./filters.js";
import { authorizationErrorResponse, requireAdmin } from "@/lib/auth/authorization";
import { assertPublicUrl } from "@/shared/utils/ssrfGuard";

export const dynamic = "force-dynamic";

function hasTrustedLoopbackPeer(request) {
  if (request.headers.get("x-9r-via-proxy")) return false;
  const ip = request.headers.get("x-9r-real-ip")?.replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

export async function GET(request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    const type = searchParams.get("type");

    if (!url || !type) {
      return NextResponse.json({ error: "Missing url or type" }, { status: 400 });
    }

    const filter = FILTERS[type];
    if (!filter) {
      return NextResponse.json({ error: "Unknown filter type" }, { status: 400 });
    }

    if (!hasTrustedLoopbackPeer(request)) assertPublicUrl(url);
    const res = await fetch(url, { redirect: "error" });
    if (!res.ok) {
      return NextResponse.json({ data: [] });
    }
    const json = await res.json();
    const raw = json.data ?? json.models ?? json;
    const data = filter(Array.isArray(raw) ? raw : []);
    return NextResponse.json({ data });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ data: [] });
  }
}
