const migration = {
  version: 10,
  name: "user-provider-order",
  up(db) {
    db.run(`DROP TABLE IF EXISTS connectionPriorityOverrides`);
    db.run(`
      CREATE TABLE IF NOT EXISTS userProviderConnectionOrder (
        userId TEXT NOT NULL,
        provider TEXT NOT NULL,
        connectionId TEXT NOT NULL,
        priority INTEGER NOT NULL,
        PRIMARY KEY (userId, provider, connectionId),
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (connectionId) REFERENCES providerConnections(id) ON DELETE CASCADE
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_userProviderConnectionOrder_lookup ON userProviderConnectionOrder(userId, provider, priority)`);
  },
};

export default migration;
