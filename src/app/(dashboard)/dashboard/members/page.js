"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, Input } from "@/shared/components";

export default function MembersPage() {
  const [users, setUsers] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [grants, setGrants] = useState([]);
  const [form, setForm] = useState({ username: "", displayName: "", email: "", password: "" });
  const [message, setMessage] = useState("");
  const [usage, setUsage] = useState(null);
  const [memberKeys, setMemberKeys] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const selectionRequest = useRef(0);

  const load = async () => {
    const [usersRes, providersRes] = await Promise.all([fetch("/api/members"), fetch("/api/providers")]);
    if (usersRes.ok) setUsers((await usersRes.json()).users || []);
    if (providersRes.ok) setConnections((await providersRes.json()).connections || []);
  };

  useEffect(() => {
    fetch("/api/members").then(async (response) => {
      if (response.ok) setUsers((await response.json()).users || []);
    });
    fetch("/api/providers").then(async (response) => {
      if (response.ok) setConnections((await response.json()).connections || []);
    });
  }, []);

  const create = async (event) => {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/members", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "Failed to create member");
    setForm({ username: "", displayName: "", email: "", password: "" });
    setMessage("Member created");
    await load();
  };

  const selectMember = async (user) => {
    const requestId = ++selectionRequest.current;
    setSelected(user);
    setGrants([]);
    setUsage(null);
    setMemberKeys([]);
    setDetailsLoading(true);
    const [grantsResponse, usageResponse, keysResponse] = await Promise.all([
      fetch(`/api/members/${user.id}/grants`),
      fetch(`/api/usage/stats?period=30d&userId=${encodeURIComponent(user.id)}`),
      fetch("/api/keys", { cache: "no-store" }),
    ]);
    const [grantsData, usageData, keysData] = await Promise.all([
      grantsResponse.ok ? grantsResponse.json() : null,
      usageResponse.ok ? usageResponse.json() : null,
      keysResponse.ok ? keysResponse.json() : null,
    ]);
    if (requestId !== selectionRequest.current) return;
    if (grantsData) setGrants(grantsData.connectionIds || []);
    if (usageData) setUsage(usageData);
    if (keysData) setMemberKeys((keysData.keys || []).filter((key) => key.ownerUserId === user.id));
    setDetailsLoading(false);
  };

  const saveGrants = async () => {
    if (!selected || detailsLoading) return;
    const response = await fetch(`/api/members/${selected.id}/grants`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionIds: grants }),
    });
    setMessage(response.ok ? "Access updated" : "Failed to update access");
  };

  const setStatus = async (user, status) => {
    await fetch(`/api/members/${user.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    await load();
  };

  const resetPassword = async () => {
    const password = window.prompt(`New password for ${selected.username}`);
    if (!password) return;
    const response = await fetch(`/api/members/${selected.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, revokeSessions: true }),
    });
    setMessage(response.ok ? "Password reset and sessions revoked" : "Failed to reset password");
  };

  const revokeSessions = async () => {
    const response = await fetch(`/api/members/${selected.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revokeSessions: true }),
    });
    setMessage(response.ok ? "All sessions revoked" : "Failed to revoke sessions");
    if (response.ok) {
      const data = await response.json();
      setSelected(data.user);
      await load();
    }
  };

  const setRole = async (role) => {
    const response = await fetch(`/api/members/${selected.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Role updated and sessions revoked" : (data.error || "Failed to update role"));
    if (response.ok) { setSelected(data.user); await load(); }
  };

  const resendOidcInvite = async () => {
    if (!selected.email) return setMessage("Set an OIDC email first");
    const response = await fetch(`/api/members/${selected.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetOidcIdentity: true, revokeSessions: true }),
    });
    const data = await response.json();
    setMessage(response.ok ? `OIDC invitation reset for ${selected.email}` : (data.error || "Failed to reset OIDC invitation"));
    if (response.ok) { setSelected(data.user); await load(); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div className="space-y-6">
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Add member</h2>
          <form className="space-y-3" onSubmit={create}>
            <Input placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            <Input placeholder="Display name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            <Input type="email" placeholder="OIDC email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input type="password" placeholder="Password (optional with OIDC email)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <Button type="submit" variant="primary" className="w-full">Create member</Button>
          </form>
          {message && <p className="mt-3 text-sm text-text-muted">{message}</p>}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Accounts</h2>
          <div className="space-y-2">
            {users.map((user) => (
              <button key={user.id} type="button" onClick={() => selectMember(user)} className={`w-full rounded-lg border p-3 text-left ${selected?.id === user.id ? "border-primary bg-primary/5" : "border-border"}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{user.displayName || user.username}</span><span className="text-xs uppercase text-text-muted">{user.role}</span></div>
                <p className="text-xs text-text-muted">{user.username} · {user.status}</p>
              </button>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        {selected ? <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">{selected.displayName || selected.username}</h2><p className="text-sm text-text-muted">Exact connection access</p></div>
            <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={resetPassword}>Reset password</Button>{selected.email && <Button variant="secondary" onClick={resendOidcInvite}>Reset OIDC invite</Button>}<Button variant="secondary" onClick={revokeSessions}>Revoke sessions</Button>{selected.id !== "admin" && <Button variant="secondary" onClick={() => setStatus(selected, selected.status === "active" ? "disabled" : "active")}>{selected.status === "active" ? "Disable" : "Activate"}</Button>}</div>
          </div>
          {selected.id !== "admin" && <div className="mb-5 flex items-center gap-3 rounded-lg border border-border p-4"><div className="min-w-0 flex-1"><p className="text-sm font-medium">Role</p><p className="text-xs text-text-muted">Role changes revoke existing sessions.</p></div><select className="rounded-lg border border-border bg-bg px-3 py-2 text-sm" value={selected.role} onChange={(e) => setRole(e.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select></div>}
          {detailsLoading ? <p className="mb-5 text-sm text-text-muted">Loading member details...</p> : <div className="mb-5 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-text-muted">Owned connections</p><p className="mt-1 text-xl font-semibold">{connections.filter((connection) => connection.ownerUserId === selected.id).length}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-text-muted">API keys</p><p className="mt-1 text-xl font-semibold">{memberKeys.length}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-text-muted">30d requests</p><p className="mt-1 text-xl font-semibold">{usage?.totalRequests || 0}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-text-muted">30d cost</p><p className="mt-1 text-xl font-semibold">${Number(usage?.totalCost || 0).toFixed(3)}</p></div>
          </div>}
          <div className="mb-5 rounded-lg border border-border p-4"><h3 className="mb-3 font-semibold">Owned connections</h3><div className="space-y-2">{connections.filter((connection) => connection.ownerUserId === selected.id).map((connection) => <div key={connection.id} className="flex items-center justify-between rounded bg-black/[0.02] px-3 py-2 text-sm dark:bg-white/[0.03]"><span>{connection.name || connection.email || connection.id}</span><span className="text-xs text-text-muted">{connection.provider}</span></div>)}{!connections.some((connection) => connection.ownerUserId === selected.id) && <p className="text-sm text-text-muted">No owned connections.</p>}</div></div>
          <div className="mb-5 rounded-lg border border-border p-4"><h3 className="mb-3 font-semibold">API keys</h3><div className="space-y-2">{memberKeys.map((key) => <div key={key.id} className="flex items-center justify-between rounded bg-black/[0.02] px-3 py-2 text-sm dark:bg-white/[0.03]"><span>{key.name}</span><span className="text-xs text-text-muted">{key.isActive ? "Active" : "Disabled"}</span></div>)}{!memberKeys.length && <p className="text-sm text-text-muted">No API keys.</p>}</div></div>
          {selected.role === "admin" && <div className="mb-5 rounded-lg border border-border p-4"><label className="mb-2 block text-sm font-medium">Administrator OIDC email</label><div className="flex gap-2"><Input type="email" value={selected.email || ""} onChange={(e) => setSelected({ ...selected, email: e.target.value })} placeholder="admin@example.com" /><Button variant="secondary" onClick={async () => { const response = await fetch(`/api/members/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: selected.email, resetOidcIdentity: true, revokeSessions: true }) }); const data = await response.json(); setMessage(response.ok ? "Administrator OIDC invitation updated and prior identity revoked" : (data.error || "Failed to update administrator")); if (response.ok) setSelected(data.user); await load(); }}>Save and reset identity</Button></div><p className="mt-2 text-xs text-text-muted">Saving revokes the previous OIDC identity and sessions. The first verified sign-in matching this email binds the new issuer and subject.</p></div>}
          {selected.role !== "admin" && <>
          <div className="space-y-2">
            {connections.map((connection) => (
              <label key={connection.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <input type="checkbox" checked={grants.includes(connection.id)} disabled={connection.ownerUserId === selected.id} onChange={() => setGrants((current) => current.includes(connection.id) ? current.filter((id) => id !== connection.id) : [...current, connection.id])} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{connection.name || connection.email || connection.provider}</span><span className="block text-xs text-text-muted">{connection.provider}{connection.ownerUserId === selected.id ? " · owned" : ""}</span></span>
              </label>
            ))}
          </div>
          <Button variant="primary" className="mt-5" onClick={saveGrants} disabled={detailsLoading}>Save access</Button>
          </>}
        </> : <div className="flex min-h-64 items-center justify-center text-text-muted">Select member to manage access.</div>}
      </Card>
    </div>
  );
}
