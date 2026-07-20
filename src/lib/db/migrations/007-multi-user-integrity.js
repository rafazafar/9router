import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const migration = {
  version: 7,
  name: "multi-user-integrity",
  up(db) {
    db.run(`UPDATE providerConnections SET ownerUserId = 'admin' WHERE ownerUserId IS NULL`);
    db.run(`UPDATE apiKeys SET ownerUserId = 'admin' WHERE ownerUserId IS NULL`);

    const settingsRow = db.get(`SELECT data FROM settings WHERE id = 1`);
    const settings = parseJson(settingsRow?.data, {});
    const admin = db.get(`SELECT oidcIssuer, oidcSubject FROM users WHERE id = 'admin'`);
    const hasDurableIdentity = !!(admin?.oidcIssuer && admin?.oidcSubject);
    if (settings.authMode === "oidc" && !hasDurableIdentity) {
      settings.authMode = "both";
      settings.requireLogin = true;
      db.run(`UPDATE settings SET data = ? WHERE id = 1`, [stringifyJson(settings)]);
    }
  },
};

export default migration;
