// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById, getAccessibleProviderConnections,
  getAccessibleProviderConnectionById, canManageProviderConnection,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

export {
  getUsers, getUserById, getUserByUsername, getUserByOidcIdentity,
  getInvitedOidcUserByEmail, createUser, updateUser, bindUserOidcIdentity, migrateUserOidcIssuer, clearUserPassword, deleteUser,
} from "./repos/usersRepo.js";
export { getConnectionGrants, grantConnection, revokeConnectionGrant, replaceConnectionGrants } from "./repos/grantsRepo.js";
export {
  TOKEN_SAVER_SETTING_KEYS, getUserTokenSaverOverrides,
  getEffectiveUserTokenSaverSettings, updateUserTokenSaverSettings,
} from "./repos/userSettingsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, getApiKeyByValue, createApiKey, updateApiKey, deleteApiKey, validateApiKey, reserveApiKeyRequest,
} from "./repos/apiKeysRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, setModelAliasValidated, deleteModelAlias, deleteModelAliasValidated,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getUserUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "./repos/requestDetailsRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    settings: await exportSettings(),
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt, ownerUserId: r.ownerUserId })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({
      id: r.id, key: r.key, name: r.name, machineId: r.machineId,
      isActive: r.isActive === 1, createdAt: r.createdAt,
      dailyRequestLimit: r.dailyRequestLimit, dailyTokenLimit: r.dailyTokenLimit,
      requestCount: r.requestCount || 0, tokenCount: r.tokenCount || 0,
      quotaDate: r.quotaDate, allowedConnectionIds: parseJson(r.allowedConnectionIds, []), ownerUserId: r.ownerUserId,
    })),
    users: db.all(`SELECT * FROM users`).map((r) => ({
      id: r.id, username: r.username, email: r.email, displayName: r.displayName,
      passwordHash: r.passwordHash, role: r.role, status: r.status,
      oidcIssuer: r.oidcIssuer, oidcSubject: r.oidcSubject,
      sessionVersion: r.sessionVersion, createdAt: r.createdAt, updatedAt: r.updatedAt,
    })),
    connectionGrants: db.all(`SELECT * FROM connectionGrants`),
    userSettings: db.all(`SELECT * FROM userSettings`).map((r) => ({ userId: r.userId, data: parseJson(r.data, {}), updatedAt: r.updatedAt })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();
  const liveUsers = new Map(db.all(`SELECT * FROM users`).map((user) => [user.id, user]));
  const importedUsers = [...(payload.users || [])];
  if (!importedUsers.some((user) => user.id === "admin") && liveUsers.has("admin")) {
    importedUsers.push(liveUsers.get("admin"));
  }
  const importedUserIds = new Set(importedUsers.map((user) => user.id));

  db.transaction(() => {
    // Wipe all tables (keep _meta)
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM connectionGrants`);
    db.run(`DELETE FROM userSettings`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);
    for (const [id, user] of liveUsers) {
      if (!importedUserIds.has(id)) {
        db.run(`UPDATE users SET status = 'disabled', sessionVersion = ?, updatedAt = ? WHERE id = ?`, [(user.sessionVersion || 1) + 1, new Date().toISOString(), id]);
      }
    }

    // Settings
    if (payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson({ ...payload.settings, requireLogin: true })]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ownerUserId, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt, ownerUserId) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString(), ownerUserId || "admin"]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, dailyRequestLimit, dailyTokenLimit, requestCount, tokenCount, quotaDate, allowedConnectionIds, ownerUserId) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(), k.dailyRequestLimit || null, k.dailyTokenLimit || null, k.requestCount || 0, k.tokenCount || 0, k.quotaDate || null, stringifyJson(k.allowedConnectionIds || []), k.ownerUserId || "admin"]
      );
    }
    for (const u of importedUsers) {
      const liveUser = liveUsers.get(u.id);
      const sessionVersion = Math.max(liveUser?.sessionVersion || 0, u.sessionVersion || 1) + 1;
      db.run(
        `INSERT INTO users(id, username, email, displayName, passwordHash, role, status, oidcIssuer, oidcSubject, sessionVersion, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET username=excluded.username, email=excluded.email,
           displayName=excluded.displayName, passwordHash=COALESCE(excluded.passwordHash, users.passwordHash), role=excluded.role,
            status=excluded.status, oidcIssuer=excluded.oidcIssuer, oidcSubject=excluded.oidcSubject,
            sessionVersion=excluded.sessionVersion, updatedAt=excluded.updatedAt`,
        [u.id, u.username, u.email || null, u.displayName || u.username, u.passwordHash || liveUser?.passwordHash || null,
          u.role || "member", u.status || "active", u.oidcIssuer || null, u.oidcSubject || null,
          sessionVersion, u.createdAt || new Date().toISOString(), new Date().toISOString()]
      );
    }
    for (const g of payload.connectionGrants || []) {
      db.run(
        `INSERT OR REPLACE INTO connectionGrants(connectionId, userId, grantedByUserId, createdAt) VALUES(?, ?, ?, ?)`,
        [g.connectionId, g.userId, g.grantedByUserId || "admin", g.createdAt || new Date().toISOString()]
      );
    }
    for (const s of payload.userSettings || []) {
      if (!importedUserIds.has(s.userId)) continue;
      db.run(`INSERT OR REPLACE INTO userSettings(userId, data, updatedAt) VALUES(?, ?, ?)`, [s.userId, stringifyJson(s.data || {}), s.updatedAt || new Date().toISOString()]);
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }
  });

  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
