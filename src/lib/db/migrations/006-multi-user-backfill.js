import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const migration = {
  version: 6,
  name: "multi-user-backfill",
  up(db) {
    db.run(
      `UPDATE usageHistory
       SET userId = COALESCE(
         (SELECT ownerUserId FROM apiKeys WHERE apiKeys.key = usageHistory.apiKey),
         (SELECT ownerUserId FROM providerConnections WHERE providerConnections.id = usageHistory.connectionId),
         'admin'
       )
       WHERE userId IS NULL`
    );
    db.run(
      `UPDATE requestDetails
       SET userId = COALESCE(
         (SELECT ownerUserId FROM providerConnections WHERE providerConnections.id = requestDetails.connectionId),
         'admin'
       )
       WHERE userId IS NULL`
    );

    const settingsRow = db.get(`SELECT data FROM settings WHERE id = 1`);
    const settings = parseJson(settingsRow?.data, {});
    const admin = db.get(`SELECT email, oidcIssuer, oidcSubject FROM users WHERE id = 'admin'`);
    if (settings.authMode === "oidc" && admin && !admin.oidcSubject && !admin.email) {
      settings.authMode = "both";
      settings.requireLogin = true;
      db.run(`UPDATE settings SET data = ? WHERE id = 1`, [stringifyJson(settings)]);
    }
  },
};

export default migration;
