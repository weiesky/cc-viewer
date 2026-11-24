// Per-session (per SDK instance) proxy binding. Maps an SDK instanceKey to the
// session's proxy choice ({ main, roles }) so one session's proxy change never
// leaks into another session sharing the same ccv process.
//
// This is intentionally process-local and IN-MEMORY ONLY: bindings are seeded when
// a session is registered/activated and dropped when it closes or the process stops.
// Nothing is persisted — a restart simply has no bindings (matches the product
// requirement that the choice need not survive a restart).
//
// Boundary: this is an L1 lib. It must NOT import sdk-manager (that would eagerly
// load the Agent SDK in PTY mode) or interceptor (an L2 consumer). interceptor
// registers a global-default provider here; proxy.js and the fetch hook read the
// per-request override through interceptor, never from sdk-manager directly.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from '../../findcc.js';
import { reportSwallowed } from './error-report.js';

const INSTANCE_KEY_RE = /^ccv-[0-9a-f]+$/;
const MAX_ENTRIES = 1024; // defensive cap: an unbounded map would be a slow leak

// instanceKey -> { main: profileId|'max', roles: { subagent, teammate } }
// 'max' is the explicit "Default" (no rewrite) value and MUST be stored verbatim —
// an absent mapping means "not bound" (fall back to the process-global profile),
// which is a different thing from "this session explicitly chose Default".
const _byInstance = new Map();

let _globalDefaultProvider = null;
// Returns { main, roles } used to SEED a fresh session's binding — the workspace-effective
// main (getActiveProfileId: workspace override > profile.json.active) and the workspace's
// stored role assignments, so a seeded session matches the legacy behavior exactly (same
// upstream as an unbound request AND the same sub/teammate routing).
let _seedProvider = null;

export function isValidInstanceKey(key) {
  return typeof key === 'string' && INSTANCE_KEY_RE.test(key);
}

// interceptor registers the live global-default reader (profile.json.active) here so
// seeding can resolve the default without this module importing interceptor (L2).
export function registerGlobalDefaultProvider(fn) {
  _globalDefaultProvider = typeof fn === 'function' ? fn : null;
}

// interceptor registers the workspace-effective seed reader ({ main, roles }).
export function registerSeedProvider(fn) {
  _seedProvider = typeof fn === 'function' ? fn : null;
}

// The global default profile id: the registered provider first (live value), then a
// one-off disk read of profile.json.active (so sdk-manager tests / early boot that
// haven't registered a provider still resolve), then 'max'.
export function getGlobalDefaultProfileId() {
  if (_globalDefaultProvider) {
    try {
      const v = _globalDefaultProvider();
      if (typeof v === 'string' && v) return v;
    } catch (err) {
      reportSwallowed('proxy-session-registry.defaultProvider', err);
    }
  }
  try {
    const data = JSON.parse(readFileSync(join(LOG_DIR, 'profile.json'), 'utf8'));
    if (typeof data?.active === 'string' && data.active) return data.active;
  } catch { /* missing/corrupt profile.json → fall through to 'max' */ }
  return 'max';
}

// The seed { main, roles } for a fresh session: the registered seed provider first;
// falls back to the global default main with follow/follow roles.
function _seedValue() {
  if (_seedProvider) {
    try {
      const v = _seedProvider();
      if (v && typeof v === 'object' && typeof v.main === 'string' && v.main) {
        return {
          main: v.main,
          roles: {
            subagent: typeof v.roles?.subagent === 'string' && v.roles.subagent ? v.roles.subagent : 'follow',
            teammate: typeof v.roles?.teammate === 'string' && v.roles.teammate ? v.roles.teammate : 'follow',
          },
        };
      }
    } catch (err) {
      reportSwallowed('proxy-session-registry.seedProvider', err);
    }
  }
  return { main: getGlobalDefaultProfileId(), roles: { subagent: 'follow', teammate: 'follow' } };
}

export function getSessionProxy(instanceKey) {
  if (!isValidInstanceKey(instanceKey)) return undefined;
  return _byInstance.get(instanceKey);
}

// Overwrite a session's binding (user-driven change). Unknown keys are dropped;
// 'max' is a valid explicit Default for main and for each role.
export function setSessionProxyProfile(instanceKey, { main, roles } = {}) {
  if (!isValidInstanceKey(instanceKey)) return false;
  const entry = {
    main: typeof main === 'string' && main ? main : getGlobalDefaultProfileId(),
    roles: {
      subagent: typeof roles?.subagent === 'string' && roles.subagent ? roles.subagent : 'follow',
      teammate: typeof roles?.teammate === 'string' && roles.teammate ? roles.teammate : 'follow',
    },
  };
  if (_byInstance.size >= MAX_ENTRIES && !_byInstance.has(instanceKey)) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldest = _byInstance.keys().next().value;
    _byInstance.delete(oldest);
  }
  _byInstance.set(instanceKey, entry);
  return true;
}

// Seed a session's binding ONLY when none exists yet (a returning/reattached session
// must never lose the choice the user already made). Seeds from the workspace-effective
// main + stored roles (via the seed provider) so a fresh session matches legacy behavior.
export function seedSessionProxyProfile(instanceKey) {
  if (!isValidInstanceKey(instanceKey)) return false;
  if (_byInstance.has(instanceKey)) return false;
  const seed = _seedValue();
  return setSessionProxyProfile(instanceKey, { main: seed.main, roles: seed.roles });
}

export function clearSessionProxyProfile(instanceKey) {
  return _byInstance.delete(instanceKey);
}

export function clearSessionProxyProfiles() {
  _byInstance.clear();
}

// A deleted profile must not leave a dangling binding behind: drop mappings whose
// main (or a role) points at a profile that no longer exists. 'max' and 'follow'
// are always valid. Resolution also falls back at read time, so this is belt+braces.
export function pruneSessionProxyProfiles(validIds) {
  if (!(validIds instanceof Set)) return;
  const valid = (id) => id === 'max' || id === 'follow' || validIds.has(id);
  for (const [key, entry] of _byInstance) {
    if (!valid(entry.main)) { _byInstance.delete(key); continue; }
    if (!valid(entry.roles.subagent)) entry.roles.subagent = 'follow';
    if (!valid(entry.roles.teammate)) entry.roles.teammate = 'follow';
  }
}

export function listSessionProxyProfiles() {
  return [..._byInstance.entries()].map(([instanceKey, v]) => ({ instanceKey, ...v }));
}

export function __resetSessionProxyProfilesForTests() {
  _byInstance.clear();
  // NOTE: providers (_globalDefaultProvider / _seedProvider) are owned by the registrar
  // (interceptor) and intentionally NOT cleared here — clearing them would silently
  // degrade later seeds to the disk fallback within the same process.
}
