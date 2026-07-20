import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const ADMIN_ID = "admin";

const migration = {
  version: 3,
  name: "multi-user",
  up(db) {
    const now = new Date().toISOString();
    const connectionColumns = new Set(db.all(`PRAGMA table_info(providerConnections)`).map((row) => row.name));
    const apiKeyColumns = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((row) => row.name));
    const usageColumns = new Set(db.all(`PRAGMA table_info(usageHistory)`).map((row) => row.name));
    if (!connectionColumns.has("ownerUserId")) db.exec(`ALTER TABLE providerConnections ADD COLUMN ownerUserId TEXT`);
    if (!apiKeyColumns.has("ownerUserId")) db.exec(`ALTER TABLE apiKeys ADD COLUMN ownerUserId TEXT`);
    if (!usageColumns.has("userId")) db.exec(`ALTER TABLE usageHistory ADD COLUMN userId TEXT`);
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT, displayName TEXT,
      passwordHash TEXT, role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active',
      oidcIssuer TEXT, oidcSubject TEXT, sessionVersion INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS connectionGrants (
      connectionId TEXT NOT NULL, userId TEXT NOT NULL, grantedByUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL, PRIMARY KEY (connectionId, userId)
    )`);
    const settingsRow = db.get(`SELECT data FROM settings WHERE id = 1`);
    const settings = parseJson(settingsRow?.data, {});

    db.run(
      `INSERT OR IGNORE INTO users(id, username, email, displayName, passwordHash, role, status, sessionVersion, createdAt, updatedAt)
       VALUES(?, 'admin', NULL, 'Administrator', ?, 'admin', 'active', 1, ?, ?)`,
      [ADMIN_ID, settings.password || null, now, now]
    );
    db.run(`UPDATE providerConnections SET ownerUserId = ? WHERE ownerUserId IS NULL`, [ADMIN_ID]);
    db.run(`UPDATE apiKeys SET ownerUserId = ? WHERE ownerUserId IS NULL`, [ADMIN_ID]);

    if (settings.requireLogin === false) {
      settings.requireLogin = true;
      db.run(`UPDATE settings SET data = ? WHERE id = 1`, [stringifyJson(settings)]);
    }
  },
};

export default migration;
