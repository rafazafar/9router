function withV1(baseUrl) {
  return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/v1`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function buildMemberCliConfigs({ baseUrl, apiKey, model, models = [] }) {
  const apiBase = withV1(baseUrl);
  const modelCatalog = [...new Set([...(models || []), model].filter(Boolean))];
  const claude = {
    hasCompletedOnboarding: true,
    env: {
      ANTHROPIC_BASE_URL: apiBase,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    },
  };
  const openCode = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      "9router": {
        npm: "@ai-sdk/openai-compatible",
        name: "9Router",
        options: { baseURL: apiBase, apiKey },
        models: Object.fromEntries(modelCatalog.map((modelId) => [modelId, { name: modelId }])),
      },
    },
    model: `9router/${model}`,
  };
  const codexConfig = [
    `model = ${JSON.stringify(model)}`,
    'model_provider = "9router"',
    "",
    "[model_providers.9router]",
    'name = "9Router"',
    `base_url = ${JSON.stringify(apiBase)}`,
    'wire_api = "responses"',
  ].join("\n");

  return [
    {
      id: "claude",
      name: "Claude Code",
      description: "Merge into Claude Code settings.",
      files: [{ name: "~/.claude/settings.json", language: "json", content: JSON.stringify(claude, null, 2) }],
    },
    {
      id: "opencode",
      name: "OpenCode",
      description: "Merge into your OpenCode configuration.",
      files: [{ name: "~/.config/opencode/opencode.json", language: "json", content: JSON.stringify(openCode, null, 2) }],
    },
    {
      id: "codex",
      name: "Codex CLI",
      description: "Add provider config and API-key authentication.",
      files: [
        { name: "~/.codex/config.toml", language: "toml", content: codexConfig },
        { name: "~/.codex/auth.json", language: "json", content: JSON.stringify({ OPENAI_API_KEY: apiKey, auth_mode: "apikey" }, null, 2) },
      ],
    },
    {
      id: "openai",
      name: "OpenAI-compatible",
      description: "Environment variables for generic clients.",
      files: [{
        name: ".env",
        language: "shell",
        content: [
          `OPENAI_BASE_URL=${shellQuote(apiBase)}`,
          `OPENAI_API_KEY=${shellQuote(apiKey)}`,
          `OPENAI_MODEL=${shellQuote(model)}`,
        ].join("\n"),
      }],
    },
  ];
}
