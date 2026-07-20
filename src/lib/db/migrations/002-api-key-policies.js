const COLUMNS = {
  dailyRequestLimit: "INTEGER",
  dailyTokenLimit: "INTEGER",
  requestCount: "INTEGER DEFAULT 0",
  tokenCount: "INTEGER DEFAULT 0",
  quotaDate: "TEXT",
  allowedConnectionIds: "TEXT",
};

const migration = {
  version: 2,
  name: "api-key-policies",
  up(db) {
    const existing = new Set(db.all("PRAGMA table_info(apiKeys)").map((row) => row.name));
    for (const [name, definition] of Object.entries(COLUMNS)) {
      if (!existing.has(name)) db.exec(`ALTER TABLE apiKeys ADD COLUMN ${name} ${definition}`);
    }
  },
};

export default migration;
