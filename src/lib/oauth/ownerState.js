import { getAdapter } from "@/lib/db/driver.js";

const OAUTH_OWNER_TTL_MS = 10 * 60 * 1000;

export async function bindOAuthOwner(value, userId) {
  if (!value || !userId) return false;
  const db = await getAdapter();
  const expiresAt = new Date(Date.now() + OAUTH_OWNER_TTL_MS).toISOString();
  let inserted = false;
  db.transaction(() => {
    db.run(`DELETE FROM oauthStates WHERE expiresAt < ?`, [new Date().toISOString()]);
    const result = db.run(
      `INSERT OR IGNORE INTO oauthStates(value, userId, expiresAt) VALUES(?, ?, ?)`,
      [String(value), userId, expiresAt]
    );
    inserted = (result?.changes || 0) > 0;
  });
  if (!inserted) throw new Error("OAuth state already exists");
  return true;
}

export async function isOAuthOwner(value, userId, { consume = false } = {}) {
  const db = await getAdapter();
  const key = String(value || "");
  const now = new Date().toISOString();
  if (consume) {
    const result = db.run(
      `DELETE FROM oauthStates WHERE value = ? AND userId = ? AND expiresAt >= ?`,
      [key, userId, now]
    );
    return (result?.changes || 0) > 0;
  }
  const row = db.get(`SELECT userId, expiresAt FROM oauthStates WHERE value = ?`, [key]);
  if (!row || row.userId !== userId) {
    return false;
  }
  if (row.expiresAt < now) {
    db.run(`DELETE FROM oauthStates WHERE value = ? AND userId = ? AND expiresAt < ?`, [key, userId, now]);
    return false;
  }
  return true;
}

export async function clearOAuthOwner(value) {
  const db = await getAdapter();
  db.run(`DELETE FROM oauthStates WHERE value = ?`, [String(value || "")]);
}
