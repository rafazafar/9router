import { NextResponse } from "next/server";
import { getModelAliases, setModelAliasValidated } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { validateModelAlias } from "open-sse/services/modelAliases.js";

// GET /api/models - Get models with aliases
export async function GET() {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();

    const models = AI_MODELS
      .filter((m) => {
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
          caps: { vision: c.vision, search: c.search, reasoning: c.reasoning },
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
