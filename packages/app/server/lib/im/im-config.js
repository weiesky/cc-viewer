// Generic multi-IM bridge config — pure storage logic, unit-tested.
//
// Each platform's config is persisted as a flat top-level key inside the same
// LOG_DIR/preferences.json the rest of cc-viewer uses (e.g. `dingtalk`, `feishu`).
// Flat sibling keys (not nested under `im.<platform>`) mean adding a platform needs
// NO on-disk migration. Like the rest of cc-viewer, the IM binding is GLOBAL ONLY
// (one bot ↔ one cc-viewer instance) — there is no per-project scope, which would
// fight the singleton-PTY model.
//
// Credential fields (`cred`: appKey/appId, low sensitivity) and secret fields
// (`secret`: appSecret) are both base64-encoded on disk so preferences.json never
// shows them in literal plaintext. This is light obfuscation, NOT encryption. The
// admin API masks secret fields entirely (→ hasSecret).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mutateJsonSync } from '../json-store.js';
import { readSecretOr, writeSecret } from '../credential-access.js';
import { LOG_DIR } from '../../../findcc.js';

const MIN_CHUNK = 500;
const MAX_CHUNK = 5000;
const DEFAULT_CHUNK = 3800;

// ─── per-platform descriptors ───
// `fields` drives normalize / encode-on-disk / decode-on-load / admin-mask uniformly.
//   type 'bool'   → !!v
//   type 'cred'   → trimmed string, base64 on disk, returned plaintext in config + admin state
//   type 'secret' → trimmed string, base64 on disk, plaintext in config, MASKED (→hasSecret) in
//                   admin state, PRESERVED when saved empty
//   type 'idlist' → de-duplicated trimmed string[]
//   type 'chunk'  → number clamped to [500, 5000], default 3800
//   type 'region' → 'lark' | 'feishu' (Feishu/Lark cloud selector; plaintext)
const DESCRIPTORS = {
  dingtalk: {
    prefKey: 'dingtalk',
    allowListField: 'allowStaffIds',
    defaults: {
      enabled: false, appKey: '', appSecret: '', allowStaffIds: [],
      maxChunkChars: 3800, blockOnSkipPermissions: false, ackCard: true, cardTemplateId: '', aiCardTemplateId: '', aiCardStreamKey: '',
    },
    fields: [
      { key: 'enabled', type: 'bool' },
      { key: 'appKey', type: 'cred' },
      { key: 'appSecret', type: 'secret' },
      { key: 'allowStaffIds', type: 'idlist' },
      { key: 'maxChunkChars', type: 'chunk' },
      { key: 'blockOnSkipPermissions', type: 'bool' },
      { key: 'ackCard', type: 'bool', default: true },
      { key: 'cardTemplateId', type: 'string' },
      // AI 卡片场景模板 id（声明流式变量 + flowStatus 状态变量）。非空即启用「逐字流式 +
      // flowStatus 状态标签」AI 卡片；留空回退到 cardTemplateId 普通卡片或纯文本。
      { key: 'aiCardTemplateId', type: 'string' },
      // AI 卡片模板里那个「流式 Markdown 变量」的名字。留空按钉钉/官方惯例用 'content'；模板若用别名在此填。
      { key: 'aiCardStreamKey', type: 'string' },
    ],
  },
  feishu: {
    prefKey: 'feishu',
    allowListField: 'allowUserIds',
    defaults: {
      enabled: false, appId: '', appSecret: '', region: 'feishu', allowUserIds: [],
      maxChunkChars: 3800, blockOnSkipPermissions: false, ackCard: true, aiCard: false,
    },
    fields: [
      { key: 'enabled', type: 'bool' },
      { key: 'appId', type: 'cred' },
      { key: 'appSecret', type: 'secret' },
      { key: 'region', type: 'region' },
      { key: 'allowUserIds', type: 'idlist' },
      { key: 'maxChunkChars', type: 'chunk' },
      { key: 'blockOnSkipPermissions', type: 'bool' },
      { key: 'ackCard', type: 'bool', default: true },
      // 开启即用 CardKit v1 流式卡片逐字回复（需应用具备 cardkit:card:write scope）；关闭/缺 scope
      // 回退到「占位卡片 + 整段替换」。
      { key: 'aiCard', type: 'bool', default: false },
    ],
  },
  wecom: {
    prefKey: 'wecom',
    allowListField: 'allowUserIds',
    defaults: {
      enabled: false, botId: '', secret: '', allowUserIds: [],
      maxChunkChars: 3800, blockOnSkipPermissions: false, ackCard: true, aiCard: false,
    },
    fields: [
      { key: 'enabled', type: 'bool' },
      { key: 'botId', type: 'cred' },
      { key: 'secret', type: 'secret' },
      { key: 'allowUserIds', type: 'idlist' },
      { key: 'maxChunkChars', type: 'chunk' },
      { key: 'blockOnSkipPermissions', type: 'bool' },
      { key: 'ackCard', type: 'bool', default: true },
      // 开启即用智能机器人长连接 stream 消息逐字回复；关闭回退到「整段 proactive 文本」。
      { key: 'aiCard', type: 'bool', default: false },
    ],
  },
  discord: {
    prefKey: 'discord',
    allowListField: 'allowUserIds',
    defaults: {
      // 1900 < Discord's hard 2000-char/message limit (the adapter also hard-splits as defense).
      enabled: false, botToken: '', allowUserIds: [],
      maxChunkChars: 1900, blockOnSkipPermissions: false, ackCard: true,
    },
    fields: [
      { key: 'enabled', type: 'bool' },
      { key: 'botToken', type: 'secret' }, // Discord's only credential (one secret, no separate cred)
      { key: 'allowUserIds', type: 'idlist' },
      { key: 'maxChunkChars', type: 'chunk', default: 1900 }, // < Discord's 2000-char limit
      { key: 'blockOnSkipPermissions', type: 'bool' },
      { key: 'ackCard', type: 'bool', default: true },
    ],
  },
};

export function getDescriptor(id) { return DESCRIPTORS[id]; }
export function listPlatforms() { return Object.keys(DESCRIPTORS); }

/** Path computed fresh each call: LOG_DIR is a live binding and tests redirect it via CCV_LOG_DIR before import. */
export function getPrefsPath() {
  return join(LOG_DIR, 'preferences.json');
}

function readPrefs() {
  try {
    const p = getPrefsPath();
    if (!existsSync(p)) return {};
    const obj = JSON.parse(readFileSync(p, 'utf-8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

// Credential fields (`cred`: appKey/appId/botId, LOW sensitivity) stay base64 in preferences.json.
// Secret fields (`secret`: appSecret/botToken) live in the encrypted credential vault
// (credentials.json, AES-256-GCM) — never in preferences.json. The legacy base64 secret fields
// are migrated out at startup and cleared. Secrets are keyed `<platform>.<field>`.
export function encodeSecret(plain) {
  return plain ? Buffer.from(plain, 'utf-8').toString('base64') : '';
}
export function decodeSecret(stored) {
  if (!stored || typeof stored !== 'string') return '';
  try { return Buffer.from(stored, 'base64').toString('utf-8'); } catch { return ''; }
}

function secretRef(id, fieldKey) { return `${id}.${fieldKey}`; }

function clampChunk(n, dflt = DEFAULT_CHUNK) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt; // missing/invalid → the field's default (per-platform, e.g. Discord 1900)
  return Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, Math.round(v)));
}

function normalizeIdList(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const s of v) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function normField(type, v, dflt) {
  switch (type) {
    case 'bool': return v !== undefined && v !== null ? !!v : (dflt !== undefined ? !!dflt : false);
    case 'cred':
    case 'secret': return typeof v === 'string' ? v.trim() : '';
    case 'idlist': return normalizeIdList(v);
    case 'chunk': return clampChunk(v, dflt);
    case 'region': return v === 'lark' ? 'lark' : 'feishu';
    default: return typeof v === 'string' ? v : '';
  }
}

function decodeField(id, f, v) {
  switch (f.type) {
    case 'secret': {
      // Vault-first, legacy base64 as the one-version read-fallback. readSecretOr distinguishes
      // "unreadable" (lost key / tampered) from "absent"; for a bridge secret, unreadable and
      // absent both degrade to "bridge won't start" (hasCreds false) — a down bot, never a leak.
      const legacyPlain = decodeSecret(v);
      return readSecretOr('im-secret', secretRef(id, f.key), legacyPlain).value;
    }
    case 'cred': return decodeSecret(v);
    case 'bool': return v !== undefined && v !== null ? !!v : (f.default !== undefined ? !!f.default : false);
    case 'idlist': return normalizeIdList(v);
    case 'chunk': return clampChunk(v, f.default);
    case 'region': return v === 'lark' ? 'lark' : 'feishu';
    default: return typeof v === 'string' ? v : '';
  }
}

/** Pure normalization (no disk I/O). Returns the in-memory plaintext shape. */
export function normalize(id, cfg) {
  const desc = DESCRIPTORS[id];
  if (!desc) throw new Error(`unknown IM platform: ${id}`);
  const out = {};
  for (const f of desc.fields) out[f.key] = normField(f.type, cfg ? cfg[f.key] : undefined, f.default);
  return out;
}

function decodeStored(id, stored) {
  const desc = DESCRIPTORS[id];
  const out = {};
  for (const f of desc.fields) {
    // No on-disk entry for this field → its default. For a secret that ALSO means "don't
    // consult the vault": a stray vault entry must not resurrect a secret for a platform the
    // prefs say nothing about (e.g. after preferences.json was wiped while credentials.json
    // survived). Only a field actually present on disk resolves through the vault.
    if (!stored || typeof stored !== 'object' || !(f.key in stored)) {
      out[f.key] = normField(f.type, undefined, f.default);
      continue;
    }
    out[f.key] = decodeField(id, f, stored[f.key]);
  }
  return out;
}

// On-disk shape for preferences.json[platform]: cred fields stay base64; a secret field is
// CLEARED (empty string) when the vault write succeeded, or kept as base64 when it failed (so
// the secret is not lost). `cleared` maps fieldKey → bool per secret field.
function encodeForDisk(id, n, cleared = {}) {
  const desc = DESCRIPTORS[id];
  const out = {};
  for (const f of desc.fields) {
    if (f.type === 'secret') out[f.key] = cleared[f.key] ? '' : encodeSecret(n[f.key]);
    else if (f.type === 'cred') out[f.key] = encodeSecret(n[f.key]);
    else out[f.key] = n[f.key];
  }
  return out;
}

/** Effective config for the backend (plaintext cred/secret fields). */
export function loadConfig(id) {
  return decodeStored(id, readPrefs()[DESCRIPTORS[id].prefKey]);
}

/**
 * Admin-facing state: secret fields are NEVER returned — only `hasSecret`. cred fields are
 * returned (low sensitivity, lets the admin confirm which app). The route layer adds live
 * connection status.
 */
export function loadState(id) {
  const desc = DESCRIPTORS[id];
  const c = decodeStored(id, readPrefs()[desc.prefKey]);
  const out = {};
  for (const f of desc.fields) {
    if (f.type === 'secret') out.hasSecret = !!c[f.key];
    else out[f.key] = c[f.key];
  }
  return out;
}

/**
 * Persist a platform's config (read-merge-write, preserving all other prefs and other
 * platforms). Secret fields are written to the credential vault; if a secret field is empty
 * AND a secret is already stored (in the vault), the existing secret is PRESERVED (lets the
 * admin edit other fields without re-typing the secret). To remove the secret, disable the
 * bridge. cred fields stay base64 in preferences.json. Returns the in-memory (plaintext)
 * normalized shape.
 */
export function saveConfig(id, cfg) {
  const desc = DESCRIPTORS[id];
  const normalized = normalize(id, cfg);
  // Resolve each secret field's EFFECTIVE plaintext BEFORE writing. An empty field means "keep
  // the stored one". The stored value may live in the VAULT and/or (pre-migration) in the legacy
  // base64 preferences field — try the vault first, then the legacy field, so an unreadable vault
  // (lost key / corrupt) never resolves a still-present legacy secret to empty and wipes it.
  const legacyPlain = {};
  const vaultUnreadableNoFallback = new Set();
  mutateJsonSync(getPrefsPath(), (prefs) => {
    const storedCfg = prefs[desc.prefKey];
    for (const f of desc.fields) {
      if (f.type !== 'secret') continue;
      const ref = secretRef(id, f.key);
      legacyPlain[f.key] = decodeSecret(storedCfg && storedCfg[f.key]);
      if (!normalized[f.key]) {
        const { value, unreadable } = readSecretOr('im-secret', ref, legacyPlain[f.key]);
        if (value) normalized[f.key] = value;
        else if (legacyPlain[f.key]) normalized[f.key] = legacyPlain[f.key];
        else if (unreadable) vaultUnreadableNoFallback.add(f.key); // vault unreadable & nothing on disk
      }
    }
  }, { mode: 0o600 });
  // Write each resolved secret to the vault. A field whose vault write failed, or whose vault is
  // unreadable with no legacy fallback, KEEPS its legacy base64 in preferences.json (secret not
  // lost); only a field safely written to the vault is cleared from preferences.json.
  const cleared = {};
  for (const f of desc.fields) {
    if (f.type !== 'secret') continue;
    const ref = secretRef(id, f.key);
    if (vaultUnreadableNoFallback.has(f.key)) {
      cleared[f.key] = false; // vault unreadable & no legacy copy → keep whatever is on disk
    } else {
      cleared[f.key] = normalized[f.key] ? writeSecret('im-secret', ref, normalized[f.key]) : true;
    }
  }
  mutateJsonSync(getPrefsPath(), (prefs) => {
    prefs[desc.prefKey] = encodeForDisk(id, normalized, cleared);
  }, { mode: 0o600 });
  return normalized;
}
