import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export const TOKEN_SAVER_SETTING_KEYS = [
  "rtkEnabled",
  "headroomEnabled",
  "headroomCompressUserMessages",
  "cavemanEnabled",
  "cavemanLevel",
  "ponytailEnabled",
  "ponytailLevel",
  "pxpipeEnabled",
  "pxpipeMinChars",
];

const BOOLEAN_KEYS = new Set([
  "rtkEnabled", "headroomEnabled", "headroomCompressUserMessages",
  "cavemanEnabled", "ponytailEnabled", "pxpipeEnabled",
]);
const LEVELS = new Set(["lite", "full", "ultra", "wenyan-lite", "wenyan-full", "wenyan-ultra"]);

function sanitizeTokenSaverSettings(value = {}) {
  const safe = {};
  for (const key of TOKEN_SAVER_SETTING_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value[key] !== "boolean") throw new Error(`${key} must be a boolean`);
      safe[key] = value[key];
    } else if (key === "pxpipeMinChars") {
      const number = Number(value[key]);
      if (!Number.isSafeInteger(number) || number < 0 || number > 10_000_000) throw new Error("pxpipeMinChars must be an integer between 0 and 10000000");
      safe[key] = number;
    } else {
      if (!LEVELS.has(value[key])) throw new Error(`${key} has an invalid level`);
      safe[key] = value[key];
    }
  }
  return safe;
}

export async function getUserTokenSaverOverrides(userId) {
  if (!userId) return {};
  const db = await getAdapter();
  return parseJson(db.get(`SELECT data FROM userSettings WHERE userId = ?`, [userId])?.data, {});
}

export async function getEffectiveUserTokenSaverSettings(userId, globalSettings) {
  const overrides = await getUserTokenSaverOverrides(userId);
  return Object.fromEntries(TOKEN_SAVER_SETTING_KEYS.map((key) => [key, overrides[key] ?? globalSettings[key]]));
}

export async function updateUserTokenSaverSettings(userId, updates) {
  const db = await getAdapter();
  const safe = sanitizeTokenSaverSettings(updates);
  let next;
  db.transaction(() => {
    const current = parseJson(db.get(`SELECT data FROM userSettings WHERE userId = ?`, [userId])?.data, {});
    next = { ...current, ...safe };
    db.run(
      `INSERT INTO userSettings(userId, data, updatedAt) VALUES(?, ?, ?)
       ON CONFLICT(userId) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`,
      [userId, stringifyJson(next), new Date().toISOString()],
    );
  });
  return next;
}
