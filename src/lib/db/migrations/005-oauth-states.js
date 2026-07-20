const migration = {
  version: 5,
  name: "oauth-states",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS oauthStates (value TEXT PRIMARY KEY, userId TEXT NOT NULL, expiresAt TEXT NOT NULL)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauthStates(expiresAt)`);
  },
};

export default migration;
