import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";

function normalizeOidcIssuer(issuer) {
  return typeof issuer === "string" ? issuer.replace(/\/+$/, "") : issuer;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    oidcIssuer: row.oidcIssuer,
    oidcSubject: row.oidcSubject,
    sessionVersion: row.sessionVersion || 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getUsers() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM users ORDER BY role = 'admin' DESC, createdAt ASC`).map(rowToUser);
}

export async function getUserById(id, { includePassword = false } = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!row) return null;
  return includePassword ? { ...rowToUser(row), passwordHash: row.passwordHash } : rowToUser(row);
}

export async function getUserByUsername(username, { includePassword = false } = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM users WHERE lower(username) = lower(?)`, [username]);
  if (!row) return null;
  return includePassword ? { ...rowToUser(row), passwordHash: row.passwordHash } : rowToUser(row);
}

export async function getUserByOidcIdentity(issuer, subject) {
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE rtrim(oidcIssuer, '/') = ? AND oidcSubject = ?`, [normalizeOidcIssuer(issuer), subject]));
}

export async function getInvitedOidcUserByEmail(email) {
  if (!email) return null;
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM users WHERE lower(email) = lower(?) AND status = 'active' AND oidcSubject IS NULL`,
    [email]
  );
  return rows.length === 1 ? rowToUser(rows[0]) : null;
}

export async function createUser(data) {
  const username = String(data.username || "").trim();
  if (!username) throw new Error("Username is required");
  if (!data.password && !data.email) throw new Error("Password or OIDC email is required");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const user = {
    id: uuidv4(), username, email: data.email?.trim() || null,
    displayName: data.displayName?.trim() || username,
    role: "member", status: "active", sessionVersion: 1,
    createdAt: now, updatedAt: now,
  };
  const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : null;
  db.run(
    `INSERT INTO users(id, username, email, displayName, passwordHash, role, status, oidcIssuer, oidcSubject, sessionVersion, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, 'member', 'active', NULL, NULL, 1, ?, ?)`,
    [user.id, user.username, user.email, user.displayName, passwordHash, now, now]
  );
  return user;
}

export async function updateUser(id, data) {
  const db = await getAdapter();
  const existing = db.get(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!existing) return null;
  if (existing.id === "admin" && (data.status === "disabled" || data.role === "member")) {
    throw new Error("Initial administrator cannot be disabled or demoted");
  }
  const next = {
    displayName: data.displayName === undefined ? existing.displayName : String(data.displayName).trim(),
    email: data.email === undefined ? existing.email : (String(data.email).trim() || null),
    role: data.role === undefined ? existing.role : data.role,
    status: data.status === undefined ? existing.status : data.status,
    sessionVersion: existing.sessionVersion || 1,
  };
  if (!['admin', 'member'].includes(next.role)) throw new Error("Invalid role");
  if (!['active', 'disabled'].includes(next.status)) throw new Error("Invalid status");
  if (data.password || next.role !== existing.role || next.status !== existing.status || data.revokeSessions) next.sessionVersion += 1;
  const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : existing.passwordHash;
  const oidcIssuer = data.resetOidcIdentity ? null : existing.oidcIssuer;
  const oidcSubject = data.resetOidcIdentity ? null : existing.oidcSubject;
  if (data.resetOidcIdentity) next.sessionVersion += 1;
  db.run(
    `UPDATE users SET displayName = ?, email = ?, passwordHash = ?, role = ?, status = ?, oidcIssuer = ?, oidcSubject = ?, sessionVersion = ?, updatedAt = ? WHERE id = ?`,
    [next.displayName, next.email, passwordHash, next.role, next.status, oidcIssuer, oidcSubject, next.sessionVersion, new Date().toISOString(), id]
  );
  return getUserById(id);
}

export async function bindUserOidcIdentity(id, issuer, subject) {
  const db = await getAdapter();
  const result = db.run(
    `UPDATE users SET oidcIssuer = ?, oidcSubject = ?, sessionVersion = sessionVersion + 1, updatedAt = ?
     WHERE id = ? AND status = 'active' AND oidcIssuer IS NULL AND oidcSubject IS NULL`,
    [normalizeOidcIssuer(issuer), subject, new Date().toISOString(), id]
  );
  return (result?.changes || 0) > 0 ? getUserById(id) : null;
}

export async function migrateUserOidcIssuer(id, currentIssuer, subject, nextIssuer) {
  const db = await getAdapter();
  const result = db.run(
    `UPDATE users SET oidcIssuer = ?, sessionVersion = sessionVersion + 1, updatedAt = ?
     WHERE id = ? AND status = 'active' AND rtrim(oidcIssuer, '/') = ? AND oidcSubject = ?`,
    [normalizeOidcIssuer(nextIssuer), new Date().toISOString(), id, normalizeOidcIssuer(currentIssuer), subject]
  );
  return (result?.changes || 0) > 0 ? getUserById(id) : null;
}

export async function clearUserPassword(id) {
  const db = await getAdapter();
  db.run(`UPDATE users SET passwordHash = NULL, sessionVersion = sessionVersion + 1, updatedAt = ? WHERE id = ?`, [new Date().toISOString(), id]);
  return getUserById(id);
}

export async function deleteUser(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT role FROM users WHERE id = ?`, [id]);
  if (!row) return false;
  if (id === "admin") throw new Error("Administrator cannot be deleted");
  const owned = db.get(`SELECT COUNT(*) AS count FROM providerConnections WHERE ownerUserId = ?`, [id]);
  if ((owned?.count || 0) > 0) throw new Error("Delete or transfer member connections first");
  db.transaction(() => {
    db.run(`DELETE FROM connectionGrants WHERE userId = ?`, [id]);
    db.run(`DELETE FROM apiKeys WHERE ownerUserId = ?`, [id]);
    db.run(`DELETE FROM users WHERE id = ?`, [id]);
  });
  return true;
}
