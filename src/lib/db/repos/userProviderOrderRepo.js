import { getAdapter } from "../driver.js";

function compareDefaultOrder(a, b) {
  const priorityDiff = (a.priority ?? 999) - (b.priority ?? 999);
  if (priorityDiff !== 0) return priorityDiff;
  return a.id.localeCompare(b.id);
}

function defaultOrder(connections) {
  return [...connections].sort(compareDefaultOrder);
}

export async function getUserProviderConnectionOrder(userId, provider) {
  if (!userId || !provider) return [];
  const db = await getAdapter();
  return db.all(
    `SELECT connectionId FROM userProviderConnectionOrder WHERE userId = ? AND provider = ? ORDER BY priority, connectionId`,
    [userId, provider],
  ).map((row) => row.connectionId);
}

export async function hasUserProviderConnectionOrder(userId, provider) {
  if (!userId || !provider) return false;
  const db = await getAdapter();
  const row = db.get(`SELECT 1 AS found FROM userProviderConnectionOrder WHERE userId = ? AND provider = ? LIMIT 1`, [userId, provider]);
  return !!row;
}

export async function applyUserProviderConnectionOrder(connections, userId, provider) {
  if (!connections.length || !userId || !provider) return defaultOrder(connections);
  const order = await getUserProviderConnectionOrder(userId, provider);
  if (!order.length) return defaultOrder(connections);

  const rank = new Map(order.map((connectionId, index) => [connectionId, index]));
  return [...connections].sort((a, b) => {
    const aRank = rank.get(a.id);
    const bRank = rank.get(b.id);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return compareDefaultOrder(a, b);
  });
}

export async function setUserProviderConnectionOrder(userId, provider, connectionIds) {
  if (!userId || !provider) throw new Error("userId and provider are required");
  if (!Array.isArray(connectionIds) || connectionIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("connectionIds must contain non-empty strings");
  }
  const uniqueIds = [...new Set(connectionIds.map((id) => id.trim()))];
  if (uniqueIds.length !== connectionIds.length) throw new Error("connectionIds must be unique");

  const db = await getAdapter();
  db.transaction(() => {
    const accessibleRows = db.all(
      `SELECT id FROM providerConnections
       WHERE provider = ? AND (
         ownerUserId = ?
         OR EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'admin' AND status = 'active')
         OR id IN (SELECT connectionId FROM connectionGrants WHERE userId = ?)
       )`,
      [provider, userId, userId, userId],
    );
    const accessibleIds = new Set(accessibleRows.map((row) => row.id));
    if (uniqueIds.length !== accessibleIds.size || uniqueIds.some((id) => !accessibleIds.has(id))) {
      throw new Error("connectionIds must exactly match accessible provider connections");
    }

    db.run(`DELETE FROM userProviderConnectionOrder WHERE userId = ? AND provider = ?`, [userId, provider]);
    uniqueIds.forEach((connectionId, index) => {
      db.run(
        `INSERT INTO userProviderConnectionOrder(userId, provider, connectionId, priority) VALUES(?, ?, ?, ?)`,
        [userId, provider, connectionId, index + 1],
      );
    });
  });
  return uniqueIds;
}

export async function resetUserProviderConnectionOrder(userId, provider) {
  if (!userId || !provider) return false;
  const db = await getAdapter();
  return (db.run(`DELETE FROM userProviderConnectionOrder WHERE userId = ? AND provider = ?`, [userId, provider])?.changes || 0) > 0;
}
