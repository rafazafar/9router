import { parseJson } from "../helpers/jsonCol.js";

const migration = {
  version: 4,
  name: "request-detail-users",
  up(db) {
    const columns = new Set(db.all(`PRAGMA table_info(requestDetails)`).map((row) => row.name));
    if (!columns.has("userId")) db.exec(`ALTER TABLE requestDetails ADD COLUMN userId TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rd_user ON requestDetails(userId)`);

    const settings = parseJson(db.get(`SELECT data FROM settings WHERE id = 1`)?.data, {});
    const legacySubject = settings.oidcSubject || settings.oidcSub || null;
    const legacyIssuer = settings.oidcIdentityIssuer || settings.oidcIssuerUrl || null;
    const legacyEmail = settings.oidcEmail || settings.oidcAdminEmail || null;
    if (legacySubject && legacyIssuer) {
      db.run(
        `UPDATE users SET oidcIssuer = COALESCE(oidcIssuer, ?), oidcSubject = COALESCE(oidcSubject, ?), email = COALESCE(email, ?), updatedAt = ? WHERE id = 'admin'`,
        [String(legacyIssuer).replace(/\/$/, ""), String(legacySubject), legacyEmail, new Date().toISOString()]
      );
    } else if (legacyEmail) {
      db.run(`UPDATE users SET email = COALESCE(email, ?), updatedAt = ? WHERE id = 'admin'`, [legacyEmail, new Date().toISOString()]);
    }
  },
};

export default migration;
