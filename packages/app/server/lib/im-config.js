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
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { LOG_DIR } from '../../findcc.js';

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

function writePrefs(prefs) {
  const p = getPrefsPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(prefs, null, 2), { mode: 0o600 });
  // writeFileSync's mode only applies on creation; re-assert 0600 — the file now carries
  // the (base64) secrets.
  try { chmodSync(p, 0o600); } catch { /* best-effort; non-POSIX or race */ }
}

export function encodeSecret(plain) {
  return plain ? Buffer.from(plain, 'utf-8').toString('base64') : '';
}
export function decodeSecret(stored) {
  if (!stored || typeof stored !== 'string') return '';
  try { return Buffer.from(stored, 'base64').toString('utf-8'); } catch { return ''; }
}

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

function decodeField(type, v, dflt) {
  switch (type) {
    case 'cred':
    case 'secret': return decodeSecret(v);
    case 'bool': return v !== undefined && v !== null ? !!v : (dflt !== undefined ? !!dflt : false);
    case 'idlist': return normalizeIdList(v);
    case 'chunk': return clampChunk(v, dflt);
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
  for (const f of desc.fields) out[f.key] = decodeField(f.type, stored ? stored[f.key] : undefined, f.default);
  return out;
}

function encodeForDisk(id, n) {
  const desc = DESCRIPTORS[id];
  const out = {};
  for (const f of desc.fields) {
    out[f.key] = (f.type === 'cred' || f.type === 'secret') ? encodeSecret(n[f.key]) : n[f.key];
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
 * platforms). If a secret field is empty AND a secret is already stored, the existing
 * secret is PRESERVED (lets the admin edit other fields without re-typing the secret).
 * To remove the secret, disable the bridge. Stored base64; returns the in-memory
 * (plaintext) normalized shape.
 */
export function saveConfig(id, cfg) {
  const desc = DESCRIPTORS[id];
  const prefs = readPrefs();
  const normalized = normalize(id, cfg);
  for (const f of desc.fields) {
    if (f.type === 'secret' && !normalized[f.key]) {
      const existing = decodeSecret(prefs[desc.prefKey] && prefs[desc.prefKey][f.key]);
      if (existing) normalized[f.key] = existing;
    }
  }
  prefs[desc.prefKey] = encodeForDisk(id, normalized);
  writePrefs(prefs);
  return normalized;
}
