import { getAdapter } from "../driver.js";

export async function getConnectionGrants(connectionId = null) {
  const db = await getAdapter();
  const rows = connectionId
    ? db.all(`SELECT * FROM connectionGrants WHERE connectionId = ? ORDER BY createdAt`, [connectionId])
    : db.all(`SELECT * FROM connectionGrants ORDER BY createdAt`);
  return rows;
}

export async function grantConnection(connectionId, userId, grantedByUserId) {
  const db = await getAdapter();
  const connection = db.get(`SELECT ownerUserId FROM providerConnections WHERE id = ?`, [connectionId]);
  const user = db.get(`SELECT role, status FROM users WHERE id = ?`, [userId]);
  const granter = db.get(`SELECT role, status FROM users WHERE id = ?`, [grantedByUserId]);
  if (!connection) throw new Error("Connection not found");
  if (!user || user.status !== "active") throw new Error("Active member not found");
  if (!granter || granter.status !== "active" || (granter.role !== "admin" && connection.ownerUserId !== grantedByUserId)) {
    throw new Error("Not authorized to grant this connection");
  }
  if (connection.ownerUserId === userId || user.role === "admin") return null;
  const createdAt = new Date().toISOString();
  db.run(
    `INSERT INTO connectionGrants(connectionId, userId, grantedByUserId, createdAt) VALUES(?, ?, ?, ?)
     ON CONFLICT(connectionId, userId) DO UPDATE SET grantedByUserId = excluded.grantedByUserId`,
    [connectionId, userId, grantedByUserId, createdAt]
  );
  return { connectionId, userId, grantedByUserId, createdAt };
}

export async function revokeConnectionGrant(connectionId, userId) {
  const db = await getAdapter();
  let revoked = false;
  db.transaction(() => {
    const connection = db.get(`SELECT provider FROM providerConnections WHERE id = ?`, [connectionId]);
    revoked = (db.run(`DELETE FROM connectionGrants WHERE connectionId = ? AND userId = ?`, [connectionId, userId])?.changes || 0) > 0;
    if (revoked && connection) {
      db.run(`DELETE FROM userProviderConnectionOrder WHERE userId = ? AND provider = ?`, [userId, connection.provider]);
    }
  });
  return revoked;
}

export async function replaceConnectionGrants(userId, connectionIds, grantedByUserId) {
  if (!Array.isArray(connectionIds)) throw new Error("connectionIds must be an array");
  if (connectionIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("connectionIds must contain non-empty strings");
  }

  const db = await getAdapter();
  const requestedIds = [...new Set(connectionIds.map((id) => id.trim()))];
  let result = [];
  db.transaction(() => {
    const user = db.get(`SELECT role, status FROM users WHERE id = ?`, [userId]);
    const granter = db.get(`SELECT role, status FROM users WHERE id = ?`, [grantedByUserId]);
    if (!user || user.status !== "active" || user.role !== "member") throw new Error("Active member not found");
    if (!granter || granter.status !== "active" || granter.role !== "admin") throw new Error("Administrator access required");

    const desired = [];
    for (const connectionId of requestedIds) {
      const connection = db.get(`SELECT ownerUserId FROM providerConnections WHERE id = ?`, [connectionId]);
      if (!connection) throw new Error(`Connection not found: ${connectionId}`);
      if (connection.ownerUserId !== userId) desired.push(connectionId);
    }

    const affectedProviders = db.all(
      `SELECT DISTINCT provider FROM providerConnections WHERE id IN (SELECT connectionId FROM connectionGrants WHERE userId = ?)`,
      [userId],
    ).map((row) => row.provider);
    db.run(`DELETE FROM connectionGrants WHERE userId = ?`, [userId]);
    const createdAt = new Date().toISOString();
    for (const connectionId of desired) {
      db.run(
        `INSERT INTO connectionGrants(connectionId, userId, grantedByUserId, createdAt) VALUES(?, ?, ?, ?)`,
        [connectionId, userId, grantedByUserId, createdAt]
      );
    }
    for (const provider of affectedProviders) {
      db.run(`DELETE FROM userProviderConnectionOrder WHERE userId = ? AND provider = ?`, [userId, provider]);
    }
    result = desired;
  });
  return result;
}
