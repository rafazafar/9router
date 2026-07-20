"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, CardSkeleton } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { buildMemberCliConfigs } from "@/shared/utils/memberCliConfigs";

export default function MemberCLIToolsPage() {
  const [keys, setKeys] = useState([]);
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const { copied, copy } = useCopyToClipboard(2000);

  useEffect(() => {
    fetch("/api/keys", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load API keys");
        const data = await response.json();
        const availableKeys = data.keys || [];
        setKeys(availableKeys);
        setSelectedKeyId(availableKeys.find((key) => key.isActive)?.id || "");
      })
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  const generate = async () => {
    const selectedKey = keys.find((key) => key.id === selectedKeyId);
    if (!selectedKey) return setError("Select an API key");
    if (!selectedKey.isActive) return setError("Selected API key is disabled");
    setGenerating(true);
    setError("");
    try {
      const modelsResponse = await fetch("/api/v1/models", {
        headers: { Authorization: `Bearer ${selectedKey.key}` },
        cache: "no-store",
      });
      const modelsData = await modelsResponse.json();
      if (!modelsResponse.ok) throw new Error(modelsData.error?.message || modelsData.error || "Could not load scoped models");
      const visibleModels = (modelsData.data || []).map((item) => item.id);
      setModels(visibleModels);
      setModel(visibleModels[0] || "");
    } catch (cause) {
      setError(cause.message);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <div className="grid gap-4 lg:grid-cols-2"><CardSkeleton /><CardSkeleton /></div>;

  const selectedKey = keys.find((key) => key.id === selectedKeyId);
  const configs = selectedKey?.key && model
    ? buildMemberCliConfigs({ baseUrl: window.location.origin, apiKey: selectedKey.key, model, models })
    : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-1 sm:px-0">
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Generate CLI configs</h2>
            <p className="mt-2 text-sm text-text-muted">Choose an existing key. Its connection policy controls model discovery and generated configs.</p>
            <label className="mb-2 mt-4 block text-sm font-medium">API key</label>
            <select className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm" value={selectedKeyId} onChange={(event) => { setSelectedKeyId(event.target.value); setModels([]); setModel(""); setError(""); }}>
              <option value="">Select API key</option>
              {keys.map((key) => <option key={key.id} value={key.id} disabled={!key.isActive}>{key.name}{key.isActive ? "" : " (disabled)"} · {key.allowedConnectionIds?.length ? `${key.allowedConnectionIds.length} selected connections` : "all accessible connections"}</option>)}
            </select>
          </div>
          <Button variant="primary" onClick={generate} loading={generating} disabled={!selectedKeyId}>Load models and generate</Button>
        </div>
        {!keys.length && <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-text-muted">No API keys available. <Link href="/dashboard/keys" className="font-medium text-primary hover:underline">Create one on API Keys page.</Link></p>}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </Card>

      {selectedKey?.key && models.length > 0 && (
        <>
          <Card>
            <label className="mb-2 block text-sm font-medium">Default model</label>
            <select className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm" value={model} onChange={(event) => setModel(event.target.value)}>
              {models.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <p className="mt-2 text-xs text-text-muted">All {models.length} models visible to this key are included where client config requires manual model definitions.</p>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            {configs.map((config) => (
              <Card key={config.id}>
                <h3 className="font-semibold">{config.name}</h3>
                <p className="mt-1 text-xs text-text-muted">{config.description}</p>
                <div className="mt-4 space-y-4">
                  {config.files.map((file) => {
                    const copyId = `${config.id}-${file.name}`;
                    return <div key={file.name}><div className="mb-2 flex items-center justify-between gap-3"><code className="text-xs text-text-muted">{file.name}</code><Button size="sm" variant="secondary" onClick={() => copy(file.content, copyId)}>{copied === copyId ? "Copied" : "Copy"}</Button></div><pre className="max-h-72 overflow-auto rounded-lg border border-border bg-bg-secondary p-3"><code className="text-xs">{file.content}</code></pre></div>;
                  })}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
