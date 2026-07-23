import { getAdapter } from "../driver.js";

/**
 * Per-user priority overrides for provider connections.
 * Lets a user (typically an admin) reorder accounts they don't own
 * for their own request routing without changing the owner's priority.
 */

export async function getConnectionPriorityOverrides(userId) {
  if (!userId) return new Map();
  const db = await getAdapter();
  const rows = db.all(`SELECT connectionId, priority FROM connectionPriorityOverrides WHERE userId = ?`, [userId]);
  return new Map(rows.map((row) => [row.connectionId, row.priority]));
}

/**
 * Set or clear (priority = null) a user's priority override for a connection.
 * Re-normalizes the user's override sequence per provider so values stay 1..N.
 */
export async function setConnectionPriorityOverride(userId, connectionId, priority) {
  if (!userId) throw new Error("userId is required");
  const db = await getAdapter();
  db.transaction(() => {
    const conn = db.get(`SELECT provider FROM providerConnections WHERE id = ?`, [connectionId]);
    if (!conn) throw new Error("Connection not found");

    if (priority === null || priority === undefined) {
      db.run(`DELETE FROM connectionPriorityOverrides WHERE connectionId = ? AND userId = ?`, [connectionId, userId]);
    } else {
      if (!Number.isInteger(priority) || priority < 1) throw new Error("Priority must be a positive integer");
      db.run(
        `INSERT INTO connectionPriorityOverrides(connectionId, userId, priority, updatedAt) VALUES(?, ?, ?, ?)
         ON CONFLICT(connectionId, userId) DO UPDATE SET priority = excluded.priority, updatedAt = excluded.updatedAt`,
        [connectionId, userId, priority, new Date().toISOString()],
      );
    }
    normalizeOverridesInTx(db, userId, conn.provider);
  });
}

/**
 * Drop every override the user has for connections they no longer own,
 * plus overrides pointing at deleted connections.
 */
export async function cleanupConnectionPriorityOverrides() {
  const db = await getAdapter();
  const result = db.run(
    `DELETE FROM connectionPriorityOverrides
     WHERE connectionId NOT IN (SELECT id FROM providerConnections)
        OR connectionId IN (SELECT id FROM providerConnections WHERE ownerUserId = connectionPriorityOverrides.userId)`,
  );
  return result?.changes ?? 0;
}

// Keep each user's override values dense (1..N) within a provider, ordered by
// (override, owner's priority, updatedAt, id) so unset rows have a stable place.
function normalizeOverridesInTx(db, userId, provider) {
  const rows = db.all(
    `SELECT pc.id, pc.priority AS ownerPriority, o.priority AS overridePriority
     FROM providerConnections pc
     LEFT JOIN connectionPriorityOverrides o ON o.connectionId = pc.id AND o.userId = ?
     WHERE pc.provider = ?`,
    [userId, provider],
  );
  if (!rows.some((row) => row.overridePriority !== null && row.overridePriority !== undefined)) return;

  const sorted = [...rows].sort((a, b) => {
    const pa = a.overridePriority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.overridePriority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return (a.ownerPriority ?? 999) - (b.ownerPriority ?? 999);
  });
  let next = 1;
  for (const row of sorted) {
    if (row.overridePriority === null || row.overridePriority === undefined) continue;
    if (row.overridePriority !== next) {
      db.run(
        `UPDATE connectionPriorityOverrides SET priority = ?, updatedAt = ? WHERE connectionId = ? AND userId = ?`,
        [next, new Date().toISOString(), row.id, userId],
      );
    }
    next++;
  }
}

/**
 * Apply a user's overrides to a connection list (already owner-priority-sorted).
 * Effective priority: overridden connections sort AFTER all non-overridden ones
 * (1000 + override), non-overridden keep their owner priority. This lets a user
 * deprioritize accounts they don't own so they are used only as a last resort.
 * Non-mutating — returns a new array.
 */
export function applyPriorityOverrides(connections, overridesMap) {
  if (!overridesMap || overridesMap.size === 0) return connections;
  const indexed = connections.map((conn, index) => ({ conn, index }));
  indexed.sort((a, b) => {
    const oa = overridesMap.get(a.conn.id);
    const ob = overridesMap.get(b.conn.id);
    const pa = oa !== undefined ? 1000 + oa : (a.conn.priority || 999);
    const pb = ob !== undefined ? 1000 + ob : (b.conn.priority || 999);
    if (pa !== pb) return pa - pb;
    return a.index - b.index;
  });
  return indexed.map((entry) => entry.conn);
}
