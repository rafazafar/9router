"use client";

import { useEffect, useState } from "react";
import { Card, CardSkeleton, Toggle } from "@/shared/components";
import { CAVEMAN_LEVELS, PONYTAIL_LEVELS } from "../endpoint/endpointConstants";

const TOGGLES = [
  { key: "rtkEnabled", title: "Compress tool output (RTK)", description: "Compress git, grep, ls, tree, and log tool results." },
  { key: "headroomEnabled", title: "Compress context (Headroom)", description: "Use administrator-managed Headroom service before routing." },
  { key: "headroomCompressUserMessages", title: "Compress user messages", description: "Allow Headroom to compress user-message content." },
  { key: "cavemanEnabled", title: "Caveman", description: "Inject concise response instructions to reduce output tokens." },
  { key: "ponytailEnabled", title: "Ponytail", description: "Apply Ponytail response compression instructions." },
  { key: "pxpipeEnabled", title: "PXPIPE", description: "Use administrator-managed PXPIPE service for large prompts." },
];

export default function MemberTokenSaverClient() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");

  useEffect(() => {
    fetch("/api/user-settings/token-saver", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load Token Saver settings");
        setSettings(data.settings);
      })
      .catch((cause) => setError(cause.message));
  }, []);

  const patch = async (key, value) => {
    const previous = settings;
    setSettings({ ...settings, [key]: value });
    setSaving(key);
    setError("");
    try {
      const response = await fetch("/api/user-settings/token-saver", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save Token Saver settings");
      setSettings(data.settings);
    } catch (cause) {
      setSettings(previous);
      setError(cause.message);
    } finally {
      setSaving("");
    }
  };

  if (!settings && !error) return <div className="space-y-4"><CardSkeleton /><CardSkeleton /></div>;

  return (
    <div className="space-y-6 p-6">
      <Card>
        <h2 className="text-lg font-semibold">Your Token Saver</h2>
        <p className="mt-1 text-sm text-text-muted">These preferences apply to requests made with API keys you own. Service installation and endpoints remain administrator-managed.</p>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </Card>

      {settings && <Card>
        <div className="divide-y divide-border">
          {TOGGLES.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
              <div><p className="font-medium">{item.title}</p><p className="text-sm text-text-muted">{item.description}</p></div>
              <Toggle checked={settings[item.key] === true} disabled={saving === item.key} onChange={() => patch(item.key, settings[item.key] !== true)} />
            </div>
          ))}
        </div>
      </Card>}

      {settings?.cavemanEnabled && <Card>
        <label className="mb-2 block text-sm font-medium">Caveman level</label>
        <select className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm" value={settings.cavemanLevel || "full"} disabled={saving === "cavemanLevel"} onChange={(event) => patch("cavemanLevel", event.target.value)}>
          {CAVEMAN_LEVELS.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
        </select>
      </Card>}

      {settings?.ponytailEnabled && <Card>
        <label className="mb-2 block text-sm font-medium">Ponytail level</label>
        <select className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm" value={settings.ponytailLevel || "full"} disabled={saving === "ponytailLevel"} onChange={(event) => patch("ponytailLevel", event.target.value)}>
          {PONYTAIL_LEVELS.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
        </select>
      </Card>}

      {settings?.pxpipeEnabled && <Card>
        <label className="mb-2 block text-sm font-medium">PXPIPE minimum characters</label>
        <input type="number" min="0" max="10000000" className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm" value={settings.pxpipeMinChars ?? 25000} disabled={saving === "pxpipeMinChars"} onChange={(event) => setSettings({ ...settings, pxpipeMinChars: Number(event.target.value) })} onBlur={(event) => patch("pxpipeMinChars", Math.max(0, Number(event.target.value) || 0))} />
      </Card>}
    </div>
  );
}
