import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getProviderConnections } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const [keys, connections] = await Promise.all([getApiKeys(), getProviderConnections()]);
    const safeConnections = connections.map(({ id, provider, name, displayName, email, isActive }) => ({
      id, provider, name: displayName || name || email || id, isActive,
    }));
    return NextResponse.json({ keys, connections: safeConnections });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, dailyRequestLimit, dailyTokenLimit, allowedConnectionIds } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, { dailyRequestLimit, dailyTokenLimit, allowedConnectionIds });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      dailyRequestLimit: apiKey.dailyRequestLimit,
      dailyTokenLimit: apiKey.dailyTokenLimit,
      allowedConnectionIds: apiKey.allowedConnectionIds,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    const status = error.message?.includes("must") ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? error.message : "Failed to create key" }, { status });
  }
}
