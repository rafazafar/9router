"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function KeysPage() {
  const [keys, setKeys] = useState([]);
  const [connections, setConnections] = useState([]);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [visibleKeys, setVisibleKeys] = useState(() => new Set());
  const { copied, copy } = useCopyToClipboard();

  const toggleVisibility = (id) => {
    setVisibleKeys((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const load = async () => {
    const response = await fetch("/api/keys", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setKeys(data.keys || []);
    setConnections(data.connections || []);
  };
  useEffect(() => {
    fetch("/api/keys", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      setKeys(data.keys || []);
      setConnections(data.connections || []);
    });
  }, []);

  const create = async (event) => {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/keys", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, allowedConnectionIds: [] }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "Failed to create key");
    setCreatedKey(data.key);
    setName("");
    await load();
  };

  const remove = async (id) => {
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    await load();
  };

  const save = async () => {
    const response = await fetch(`/api/keys/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name,
        isActive: editing.isActive,
        allowedConnectionIds: editing.allowedConnectionIds,
      }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "Failed to update key");
    setEditing(null);
    await load();
  };

  return <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
    <Card>
      <h2 className="mb-2 text-lg font-semibold">Create API key</h2>
      <p className="mb-4 text-sm text-text-muted">Empty account policy means all connections available to you, never all system connections.</p>
      <form className="space-y-3" onSubmit={create}>
        <Input placeholder="Key name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Button type="submit" variant="primary" className="w-full">Create key</Button>
      </form>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      {createdKey && <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3"><p className="mb-2 text-xs text-text-muted">Key created. You can reveal it again from the list.</p><code className="break-all text-sm">{createdKey}</code></div>}
      <p className="mt-4 text-xs text-text-muted">{connections.length} accessible connection{connections.length === 1 ? "" : "s"}</p>
    </Card>
    <Card>
      <h2 className="mb-4 text-lg font-semibold">API keys</h2>
      <div className="space-y-2">
        {keys.map((key) => <div key={key.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><p className="font-medium">{key.name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${key.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>{key.isActive ? "Active" : "Disabled"}</span></div><div className="mt-1 flex items-center gap-1"><code className="min-w-0 break-all text-xs text-text-muted">{visibleKeys.has(key.id) ? key.key : key.keyPrefix}</code><button type="button" onClick={() => toggleVisibility(key.id)} className="shrink-0 p-1 text-text-muted hover:text-primary" title={visibleKeys.has(key.id) ? "Hide key" : "Reveal key"}><span className="material-symbols-outlined text-[16px]">{visibleKeys.has(key.id) ? "visibility_off" : "visibility"}</span></button><button type="button" onClick={() => copy(key.key, `key-${key.id}`)} className="shrink-0 p-1 text-text-muted hover:text-primary" title="Copy key"><span className="material-symbols-outlined text-[16px]">{copied === `key-${key.id}` ? "check" : "content_copy"}</span></button></div><p className="text-xs text-text-muted">{key.ownerDisplayName && `${key.ownerDisplayName} · `}{key.allowedConnectionIds?.length ? `${key.allowedConnectionIds.length} selected connections` : "All accessible connections"}</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => setEditing({ ...key, allowedConnectionIds: [...(key.allowedConnectionIds || [])] })}>Edit</Button><Button variant="secondary" onClick={() => remove(key.id)}>Delete</Button></div></div>)}
        {!keys.length && <p className="text-sm text-text-muted">No API keys yet.</p>}
      </div>
      {editing && <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4"><h3 className="mb-3 font-semibold">Edit key</h3><div className="space-y-3"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />Active</label><div><p className="mb-2 text-xs text-text-muted">Leave every box unchecked to dynamically allow all connections accessible to owner.</p><div className="max-h-64 space-y-2 overflow-y-auto">{connections.filter((connection) => editing.accessibleConnectionIds?.includes(connection.id)).map((connection) => <label key={connection.id} className="flex items-center gap-2 rounded border border-border bg-bg p-2 text-sm"><input type="checkbox" checked={editing.allowedConnectionIds.includes(connection.id)} onChange={() => setEditing({ ...editing, allowedConnectionIds: editing.allowedConnectionIds.includes(connection.id) ? editing.allowedConnectionIds.filter((id) => id !== connection.id) : [...editing.allowedConnectionIds, connection.id] })} /><span>{connection.name}</span><span className="ml-auto text-xs text-text-muted">{connection.provider}</span></label>)}{editing.allowedConnectionIds.filter((id) => !editing.accessibleConnectionIds?.includes(id)).map((id) => <label key={id} className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-sm"><input type="checkbox" checked onChange={() => setEditing({ ...editing, allowedConnectionIds: editing.allowedConnectionIds.filter((connectionId) => connectionId !== id) })} /><span className="break-all">{id}</span><span className="ml-auto text-xs text-amber-600">No longer accessible · uncheck to remove</span></label>)}</div></div><div className="flex gap-2"><Button variant="primary" onClick={save}>Save</Button><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button></div></div></div>}
    </Card>
  </div>;
}
