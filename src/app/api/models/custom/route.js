import { NextResponse } from "next/server";
import { getCustomModels, getAccessibleProviderConnections, addCustomModel, deleteCustomModel } from "@/models";
import { getProviderAlias } from "@/shared/constants/providers";
import { authorizationErrorResponse, requireAdmin, requireUser } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

// GET /api/models/custom - List all custom models
export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const models = await getCustomModels();
    if (principal.role === "admin") return NextResponse.json({ models });

    const connections = await getAccessibleProviderConnections(principal);
    const providerAliases = new Set();
    for (const connection of connections) {
      providerAliases.add(connection.provider);
      providerAliases.add(getProviderAlias(connection.provider));
      const prefix = connection.providerSpecificData?.prefix;
      if (typeof prefix === "string" && prefix.trim()) providerAliases.add(prefix.trim());
    }

    return NextResponse.json({
      models: models.filter((model) => providerAliases.has(model.providerAlias)),
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error fetching custom models:", error);
    return NextResponse.json({ error: "Failed to fetch custom models" }, { status: 500 });
  }
}

// POST /api/models/custom - Add custom model
export async function POST(request) {
  try {
    await requireAdmin(request);
    const { providerAlias, id, type, name } = await request.json();
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const added = await addCustomModel({ providerAlias, id, type: type || "llm", name });
    return NextResponse.json({ success: true, added });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error adding custom model:", error);
    return NextResponse.json({ error: "Failed to add custom model" }, { status: 500 });
  }
}

// DELETE /api/models/custom?providerAlias=xxx&id=yyy&type=zzz
export async function DELETE(request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    const type = searchParams.get("type") || "llm";
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    await deleteCustomModel({ providerAlias, id, type });
    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error deleting custom model:", error);
    return NextResponse.json({ error: "Failed to delete custom model" }, { status: 500 });
  }
}
