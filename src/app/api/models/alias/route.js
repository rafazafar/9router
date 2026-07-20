import { NextResponse } from "next/server";
import { getModelAliases, getProviderConnections, setModelAliasValidated, deleteModelAliasValidated } from "@/models";
import { getCanonicalAliasSuggestions, getDependentAliases, validateModelAlias } from "open-sse/services/modelAliases.js";
import { authorizationErrorResponse, requireAdmin } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

// GET /api/models/alias - Get all aliases
export async function GET(request) {
  try {
    await requireAdmin(request);
    const [aliases, connections] = await Promise.all([
      getModelAliases(),
      getProviderConnections(),
    ]);
    const connectedProviderIds = new Set(
      connections.filter((connection) => connection.isActive !== false).map((connection) => connection.provider),
    );
    return NextResponse.json({
      aliases,
      suggestions: getCanonicalAliasSuggestions(aliases, { providerIds: connectedProviderIds }),
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.log("Error fetching aliases:", error);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

// PUT /api/models/alias - Set model alias
export async function PUT(request) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { model, alias, override = false } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const validated = await setModelAliasValidated(alias, model, (aliases) => (
      validateModelAlias({
        alias,
        target: model,
        aliases,
        allowOverride: override === true,
      })
    ));

    return NextResponse.json({ success: true, model: validated.target, alias: validated.alias });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (!error.status || error.status >= 500) console.log("Error updating alias:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update alias", code: error.code },
      { status: error.status || 500 },
    );
  }
}

// DELETE /api/models/alias?alias=xxx - Delete alias
export async function DELETE(request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get("alias");

    if (!alias) {
      return NextResponse.json({ error: "Alias required" }, { status: 400 });
    }

    await deleteModelAliasValidated(alias, (aliases) => {
      const dependents = getDependentAliases(alias, aliases);
      if (dependents.length > 0) {
        const error = new Error(`Alias is used by: ${dependents.join(", ")}`);
        error.code = "MODEL_ALIAS_HAS_DEPENDENTS";
        error.status = 409;
        error.dependents = dependents;
        throw error;
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (!error.status || error.status >= 500) console.log("Error deleting alias:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete alias", code: error.code, dependents: error.dependents },
      { status: error.status || 500 },
    );
  }
}
