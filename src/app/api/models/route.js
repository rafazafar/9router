import { NextResponse } from "next/server";
import { getModelAliases, setModelAliasValidated } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { ALIAS_TO_ID, getProviderAlias } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { validateModelAlias } from "open-sse/services/modelAliases.js";
import { getAccessibleProviderConnections } from "@/lib/db/index.js";
import { requireAdmin, requireUser } from "@/lib/auth/authorization";

// GET /api/models - Get models with aliases
export async function GET(request) {
  try {
    const principal = await requireUser(request);
    const connections = await getAccessibleProviderConnections(principal, { isActive: true });
    const visibleProviders = new Set(connections.map((connection) => connection.provider));
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();

    const models = AI_MODELS
      .filter((m) => {
        if (!visibleProviders.has(ALIAS_TO_ID[m.provider] || m.provider)) return false;
        const alias = getProviderAlias(m.provider) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const fullModel = `${m.provider}/${m.model}`;
        const c = getCapabilitiesForModel(m.provider, m.model);
        return {
          ...m,
          fullModel,
          alias: Object.entries(modelAliases).find(([, target]) => target === fullModel)?.[0] || m.model,
          caps: c,
        };
      });

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

// PUT /api/models - Update model alias
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
    if (!error.status || error.status >= 500) console.log("Error updating alias:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update alias", code: error.code },
      { status: error.status || 500 },
    );
  }
}
