// End-to-end pipeline test for the sanguo bundled pack — simulates a fresh
// zh user's first launch and walks every layer that touches the binding:
//
//   getDefaultBindingsForLocale('zh')   → initial seed
//   mergeVoicePackInto(...)             → AppBase / server merge path
//   reconcileVoicePackPrefs(...)        → server persistence sanity check
//   urlForBinding(eventKey, 'sanguo')   → frontend URL builder (via require)
//   getBundledPackPath('sanguo', key)   → server-side file resolution
//
// Pre-fix, the reconcile + urlForBinding layers would silently drop 'sanguo'
// (only 'default' was whitelisted; urlForBinding routed unknown values to the
// uuid branch). This file pins the entire chain so no future refactor can
// regress one link without the whole suite catching it.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getDefaultBindingsForLocale,
  BUNDLED_PACK_IDS,
  EVENT_KEYS,
} from '../packages/app/server/lib/voice-pack-events.js';
import {
  getBundledPackPath,
  reconcileVoicePackPrefs,
} from '../packages/app/server/lib/voice-pack-manager.js';
import {
  mergeVoicePackInto,
  mergeApprovalModalPrefs,
} from '../packages/app/server/lib/approval-modal-prefs.js';

describe('sanguo end-to-end pipeline (zh user fresh launch)', () => {
  let tmpLogDir;
  beforeEach(() => { tmpLogDir = mkdtempSync(join(tmpdir(), 'ccv-sanguo-e2e-')); });
  afterEach(() => { try { rmSync(tmpLogDir, { recursive: true, force: true }); } catch {} });

  it('seed → merge → reconcile → resolve produces a real sanguo file', () => {
    // 1. Locale-aware initial seed — what AppBase constructor gives a zh user.
    const seed = getDefaultBindingsForLocale('zh');
    assert.equal(seed.planApproval, 'sanguo');
    assert.equal(seed.askQuestion, 'sanguo');
    assert.equal(seed.turnEnd, null);

    // 2. mergeVoicePackInto — the path POST /api/preferences runs the seed
    // through. Must pass 'sanguo' values verbatim, not strip them.
    const merged = mergeVoicePackInto(
      { enabled: true, volume: 0.3, events: {} },
      { events: seed },
    );
    assert.equal(merged.events.planApproval, 'sanguo');
    assert.equal(merged.events.askQuestion, 'sanguo');
    assert.equal(merged.events.turnEnd, null);

    // 3. reconcileVoicePackPrefs — server persistence whitelist. Pre-P0-fix
    // (val === 'default' only), sanguo got nulled here on every save.
    const reconciled = reconcileVoicePackPrefs(tmpLogDir, merged);
    assert.equal(reconciled.events.planApproval, 'sanguo', 'reconcile must keep sanguo (P0)');
    assert.equal(reconciled.events.askQuestion, 'sanguo');
    assert.equal(reconciled.events.turnEnd, null);

    // 4. getBundledPackPath — server-side file resolution. The file must
    // actually exist in dist/ or public/, otherwise audio 404s and frontend
    // chime-fallback fires instead of the butler/sanguo voice.
    for (const eventKey of ['planApproval', 'askQuestion']) {
      const hit = getBundledPackPath('sanguo', eventKey);
      assert.ok(hit, `getBundledPackPath('sanguo', '${eventKey}') must resolve`);
      assert.ok(existsSync(hit.path), `file ${hit.path} must exist on disk`);
      assert.equal(hit.format, 'mp3', 'sanguo files are MP3');
    }
  });

  it('mergeApprovalModalPrefs (deep-merge entry point) preserves sanguo end-to-end', () => {
    // The outer wrapper used by server POST /api/preferences — confirms the
    // top-level merge route doesn't accidentally drop voicePack.events values
    // through some shallow-merge oversight.
    const base = {
      modalEnabled: true,
      soundEnabled: true,
      voicePack: { enabled: true, volume: 0.3, events: { planApproval: 'default', askQuestion: 'default', turnEnd: null } },
    };
    const incoming = {
      voicePack: { events: { planApproval: 'sanguo', askQuestion: 'sanguo' } },
    };
    const merged = mergeApprovalModalPrefs(base, incoming, {
      reconcile: vp => reconcileVoicePackPrefs(tmpLogDir, vp),
    });
    assert.equal(merged.voicePack.events.planApproval, 'sanguo');
    assert.equal(merged.voicePack.events.askQuestion, 'sanguo');
    // turnEnd not in incoming patch — should preserve base value (null).
    assert.equal(merged.voicePack.events.turnEnd, null);
  });

  it("zh user who switched to 'default' isn't silently migrated back to 'sanguo' on reconcile", () => {
    // P0 safety rule: existing user prefs with binding='default' (butler) MUST
    // survive reconcile unchanged, even if their locale would seed sanguo on a
    // fresh install. Regression guard for "no silent migration".
    const stored = { enabled: true, events: { planApproval: 'default', askQuestion: 'default', turnEnd: null } };
    const reconciled = reconcileVoicePackPrefs(tmpLogDir, stored);
    assert.equal(reconciled.events.planApproval, 'default', "binding='default' must stay default for old users");
    assert.equal(reconciled.events.askQuestion, 'default');
  });

  it('locale-seed values are all in BUNDLED_PACK_IDS or null (server can serve them)', () => {
    // Cross-module invariant: anything getDefaultBindingsForLocale emits must
    // be servable by getBundledPackPath. Catches a future locale-seed entry
    // referencing a packId that doesn't ship.
    for (const locale of ['zh', 'zh-TW', 'en', 'ja', 'fr']) {
      const seed = getDefaultBindingsForLocale(locale);
      for (const eventKey of EVENT_KEYS) {
        const val = seed[eventKey];
        if (val == null) continue;
        assert.ok(BUNDLED_PACK_IDS.includes(val), `seed ${locale}/${eventKey}='${val}' not in BUNDLED_PACK_IDS`);
        const hit = getBundledPackPath(val, eventKey);
        assert.ok(hit, `seed ${locale}/${eventKey}='${val}' must resolve to a real file`);
      }
    }
  });
});
