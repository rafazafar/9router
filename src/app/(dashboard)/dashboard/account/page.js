"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/shared/components";

export default function AccountPage() {
  const [user, setUser] = useState(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" }).then(async (response) => {
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setHasPassword(data.hasPassword === true);
      }
    });
  }, []);

  const changePassword = async (event) => {
    event.preventDefault();
    if (form.newPassword !== form.confirmPassword) return setMessage("New passwords do not match");
    const response = await fetch("/api/account", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "Password change failed");
    window.location.assign("/login");
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  };

  return <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
    <Card><h2 className="mb-4 text-lg font-semibold">Account</h2><dl className="space-y-3 text-sm"><div><dt className="text-text-muted">Name</dt><dd className="font-medium">{user?.displayName || user?.username || "-"}</dd></div><div><dt className="text-text-muted">Username</dt><dd>{user?.username || "-"}</dd></div><div><dt className="text-text-muted">Email</dt><dd>{user?.email || "Not configured"}</dd></div><div><dt className="text-text-muted">Role</dt><dd className="capitalize">{user?.role || "-"}</dd></div></dl><Button variant="secondary" className="mt-6" onClick={logout}>Sign out</Button></Card>
    {hasPassword ? <Card><h2 className="mb-2 text-lg font-semibold">Change password</h2><p className="mb-4 text-sm text-text-muted">Changing password revokes every active dashboard session.</p><form className="space-y-3" onSubmit={changePassword}><Input type="password" placeholder="Current password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required /><Input type="password" placeholder="New password (8+ characters)" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required /><Input type="password" placeholder="Confirm new password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required /><Button type="submit" variant="primary">Change password</Button>{message && <p className="text-sm text-text-muted">{message}</p>}</form></Card> : <Card><h2 className="mb-2 text-lg font-semibold">OIDC account</h2><p className="text-sm text-text-muted">This account signs in through OIDC and has no local password. An administrator can add or reset a local password from Members.</p></Card>}
  </div>;
}
