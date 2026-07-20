import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function normalizeLimit(value) {
  if (value === null || value === undefined || value === "") return null;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("API key limits must be positive integers");
  return limit;
}

function normalizeConnectionIds(value) {
  if (!Array.isArray(value)) throw new Error("allowedConnectionIds must be an array");
  if (value.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("allowedConnectionIds must contain non-empty strings");
  }
  return [...new Set(value.map((id) => id.trim()))];
}

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function rowToKey(row) {
  if (!row) return null;
  const parsedConnectionIds = parseJson(row.allowedConnectionIds, []);
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    dailyRequestLimit: row.dailyRequestLimit ?? null,
    dailyTokenLimit: row.dailyTokenLimit ?? null,
    requestCount: row.requestCount || 0,
    tokenCount: row.tokenCount || 0,
    quotaDate: row.quotaDate || utcDateKey(),
    allowedConnectionIds: Array.isArray(parsedConnectionIds) ? parsedConnectionIds : ["__invalid_policy__"],
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    dailyRequestLimit: normalizeLimit(options.dailyRequestLimit),
    dailyTokenLimit: normalizeLimit(options.dailyTokenLimit),
    requestCount: 0,
    tokenCount: 0,
    quotaDate: utcDateKey(),
    allowedConnectionIds: normalizeConnectionIds(options.allowedConnectionIds || []),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, dailyRequestLimit, dailyTokenLimit, requestCount, tokenCount, quotaDate, allowedConnectionIds) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, apiKey.dailyRequestLimit, apiKey.dailyTokenLimit, 0, 0, apiKey.quotaDate, stringifyJson(apiKey.allowedConnectionIds)]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    if (Object.hasOwn(data, "dailyRequestLimit")) merged.dailyRequestLimit = normalizeLimit(data.dailyRequestLimit);
    if (Object.hasOwn(data, "dailyTokenLimit")) merged.dailyTokenLimit = normalizeLimit(data.dailyTokenLimit);
    if (Object.hasOwn(data, "allowedConnectionIds")) merged.allowedConnectionIds = normalizeConnectionIds(data.allowedConnectionIds);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, dailyRequestLimit = ?, dailyTokenLimit = ?, allowedConnectionIds = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.dailyRequestLimit, merged.dailyTokenLimit, stringifyJson(merged.allowedConnectionIds), id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}

export async function getApiKeyByValue(key) {
  const db = await getAdapter();
  return rowToKey(db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]));
}

export async function reserveApiKeyRequest(key) {
  const db = await getAdapter();
  let result = { allowed: false, reason: "invalid" };
  db.transaction(() => {
    let row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
    if (!row || !(row.isActive === 1 || row.isActive === true)) return;

    const today = utcDateKey();
    if (row.quotaDate !== today) {
      db.run(`UPDATE apiKeys SET requestCount = 0, tokenCount = 0, quotaDate = ? WHERE id = ?`, [today, row.id]);
      row = { ...row, requestCount: 0, tokenCount: 0, quotaDate: today };
    }

    if (row.dailyRequestLimit && row.requestCount >= row.dailyRequestLimit) {
      result = { allowed: false, reason: "requests", apiKey: rowToKey(row) };
      return;
    }
    if (row.dailyTokenLimit && row.tokenCount >= row.dailyTokenLimit) {
      result = { allowed: false, reason: "tokens", apiKey: rowToKey(row) };
      return;
    }

      db.run(`UPDATE apiKeys SET requestCount = COALESCE(requestCount, 0) + 1 WHERE id = ?`, [row.id]);
    result = { allowed: true, apiKey: rowToKey({ ...row, requestCount: (row.requestCount || 0) + 1 }) };
  });
  return result;
}
