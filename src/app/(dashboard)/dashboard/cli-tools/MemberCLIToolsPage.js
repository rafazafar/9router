"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardSkeleton, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { buildMemberCliConfigs } from "@/shared/utils/memberCliConfigs";

export default function MemberCLIToolsPage() {
  const [connections, setConnections] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [keyName, setKeyName] = useState("CLI tools");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const { copied, copy } = useCopyToClipboard(2000);

  useEffect(() => {
    fetch("/api/providers", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load connections");
        const data = await response.json();
        const active = (data.connections || []).filter((connection) => connection.isActive !== false);
        setConnections(active);
        setSelectedIds(active.map((connection) => connection.id));
      })
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  const toggleConnection = (id) => {
    if (apiKey) return;
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const generate = async () => {
    if (!selectedIds.length) return setError("Select at least one connection");
    setGenerating(true);
    setError("");
    try {
      const keyResponse = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName.trim() || "CLI tools", allowedConnectionIds: selectedIds }),
      });
      const keyData = await keyResponse.json();
      if (!keyResponse.ok) throw new Error(keyData.error || "Could not create scoped API key");
      setApiKey(keyData.key);

      const modelsResponse = await fetch("/api/v1/models", {
        headers: { Authorization: `Bearer ${keyData.key}` },
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

  const configs = apiKey && model
    ? buildMemberCliConfigs({ baseUrl: window.location.origin, apiKey, model })
    : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-1 sm:px-0">
      <Card>
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="text-lg font-semibold">Create a scoped CLI key</h2>
            <p className="mt-2 text-sm text-text-muted">Choose exact connections. Generated configs can route only through those connections and your current grants.</p>
            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium">Key name</label>
              <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} disabled={!!apiKey} />
            </div>
            <Button className="mt-4 w-full" variant="primary" onClick={generate} loading={generating} disabled={!!apiKey || !selectedIds.length}>Generate key and configs</Button>
            {apiKey && <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">Key is shown only on this page load. Revoke it from API Keys when no longer needed.</p>}
            {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
          </div>
          <div>
            <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-medium">Available connections</h3><span className="text-xs text-text-muted">{selectedIds.length} selected</span></div>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {connections.map((connection) => (
                <label key={connection.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <input type="checkbox" checked={selectedIds.includes(connection.id)} disabled={!!apiKey} onChange={() => toggleConnection(connection.id)} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{connection.name || connection.email || connection.provider}</span><span className="block text-xs text-text-muted">{connection.provider} · {connection.ownership === "shared" ? `Shared by ${connection.ownerDisplayName || "administrator"}` : "Owned by you"}</span></span>
                </label>
              ))}
              {!connections.length && <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-muted">Add or request access to a provider connection first.</p>}
            </div>
          </div>
        </div>
      </Card>

      {apiKey && (
        <>
          <Card>
            <label className="mb-2 block text-sm font-medium">Model visible to this key</label>
            <select className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm" value={model} onChange={(event) => setModel(event.target.value)}>
              {models.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            {!models.length && <p className="mt-2 text-sm text-amber-600">Selected connections expose no LLM models.</p>}
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
