"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, CardSkeleton } from "@/shared/components";

const EMPTY_FORM = { alias: "", target: "" };

export default function ModelAliasesPage() {
  const [aliases, setAliases] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingAlias, setEditingAlias] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadAliases = useCallback(async () => {
    try {
      const response = await fetch("/api/models/alias", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load aliases");
      setAliases(data.aliases || {});
      setSuggestions(data.suggestions || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Failed to load aliases");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAliases(); }, [loadAliases]); // eslint-disable-line react-hooks/set-state-in-effect

  const entries = useMemo(
    () => Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b)),
    [aliases],
  );

  const putAlias = async (alias, target, override = false) => {
    const response = await fetch("/api/models/alias", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias, model: target, override }),
    });
    const data = await response.json();
    if (response.status === 409 && !override) {
      const confirmed = window.confirm(`${data.error}\n\nThis changes where ${alias} is routed. Continue?`);
      if (confirmed) return putAlias(alias, target, true);
    }
    if (!response.ok) throw new Error(data.error || "Failed to save alias");
    return data;
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!form.alias.trim() || !form.target.trim() || saving) return;
    setSaving(true);
    try {
      await putAlias(form.alias.trim(), form.target.trim());
      setForm(EMPTY_FORM);
      setEditingAlias(null);
      await loadAliases();
    } catch (saveError) {
      setError(saveError.message || "Failed to save alias");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (alias) => {
    if (!window.confirm(`Delete the alias ${alias}?`)) return;
    try {
      const response = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete alias");
      if (editingAlias === alias) {
        setEditingAlias(null);
        setForm(EMPTY_FORM);
      }
      await loadAliases();
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete alias");
    }
  };

  const handleEdit = (alias, target) => {
    setEditingAlias(alias);
    setForm({ alias, target });
    setError("");
  };

  const handleSuggestion = async ({ alias, target }) => {
    setSaving(true);
    try {
      await putAlias(alias, target);
      await loadAliases();
    } catch (saveError) {
      setError(saveError.message || "Failed to add canonical alias");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <CardSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">{editingAlias ? "Edit alias" : "Add alias"}</h2>
            <p className="mt-1 text-sm text-text-muted">
              Aliases are exact model references. They can include a provider prefix and always resolve before provider routing.
            </p>
          </div>
          {error && <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              Alias
              <input
                value={form.alias}
                onChange={(event) => setForm((current) => ({ ...current, alias: event.target.value }))}
                placeholder="openai/gpt-5.6-sol"
                readOnly={Boolean(editingAlias)}
                className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary read-only:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              Route target
              <input
                value={form.target}
                onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
                placeholder="cx/gpt-5.6-sol"
                className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving || !form.alias.trim() || !form.target.trim()}>
              {saving ? "Saving..." : editingAlias ? "Save changes" : "Add alias"}
            </Button>
            {editingAlias && (
              <Button type="button" variant="secondary" onClick={() => { setEditingAlias(null); setForm(EMPTY_FORM); }}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>

      <Card>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Configured aliases</h2>
          <p className="mt-1 text-sm text-text-muted">Multiple aliases may point to the same route target.</p>
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-text-muted">No model aliases configured.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {entries.map(([alias, target]) => (
              <div key={alias} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                  <code className="truncate rounded bg-sidebar px-2 py-1 text-xs">{alias}</code>
                  <span className="material-symbols-outlined text-center text-sm text-text-muted">arrow_forward</span>
                  <code className="truncate rounded bg-sidebar px-2 py-1 text-xs">{target}</code>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="secondary" onClick={() => handleEdit(alias, target)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => handleDelete(alias)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {suggestions.length > 0 && (
        <Card>
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Canonical model IDs</h2>
            <p className="mt-1 text-sm text-text-muted">
              Registry-backed aliases compatible with standard vendor/model naming. Adding one intentionally overrides that provider-qualified route.
            </p>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {suggestions.map((suggestion) => (
              <div key={`${suggestion.alias}:${suggestion.target}`} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                  <code className="truncate rounded bg-sidebar px-2 py-1 text-xs">{suggestion.alias}</code>
                  <span className="material-symbols-outlined text-center text-sm text-text-muted">arrow_forward</span>
                  <code className="truncate rounded bg-sidebar px-2 py-1 text-xs">{suggestion.target}</code>
                </div>
                <Button size="sm" variant="secondary" disabled={saving} onClick={() => handleSuggestion(suggestion)}>Add</Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
