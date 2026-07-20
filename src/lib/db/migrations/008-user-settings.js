const migration = {
  version: 8,
  name: "user-settings",
  up(db) {
    db.run(`CREATE TABLE IF NOT EXISTS userSettings (
      userId TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`);
  },
};

export default migration;
