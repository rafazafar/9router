const migration = {
  version: 9,
  name: "connection-priority-overrides",
  up(db) {
    db.run(`CREATE TABLE IF NOT EXISTS connectionPriorityOverrides (
      connectionId TEXT NOT NULL,
      userId TEXT NOT NULL,
      priority INTEGER NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (connectionId, userId)
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cpo_user ON connectionPriorityOverrides(userId)`);
  },
};

export default migration;
