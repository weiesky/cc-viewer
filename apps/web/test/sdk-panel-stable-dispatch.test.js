/**
 * Source-contract guard against the infinite refetch loop in the SDK DetailPanel tabs
 * (SdkMcpStatusTab / SdkContextUsageTab).
 *
 * The bug (fixed 2026-10-11): the panel originally did
 *   `const dispatch = useCallback((e) => { setDetail(...); setStatus(...); }, [detail, status])`
 *   `const load = useCallback(async () => { ...fetch...; dispatch(...) }, [dispatch])`
 *   `useEffect(() => { ...; load(); }, [ws, load, dispatch])`
 * A successful fetch returns a fresh-ts snapshot → new `detail` object → `dispatch` and
 * `load` get new identities → the effect deps change → the effect re-runs → `load()` again
 * → infinite refetch (one control request per RTT, plus a WS broadcast to every client).
 * No pure-reducer or source-shape test caught it because nothing mounted the hooks; this
 * was confirmed empirically under react@18.3.1.
 *
 * The fix: drive the panel state with `useReducer` so `dispatch` has a STABLE identity by
 * React contract, decoupling the effect from state churn. This test pins that structure so
 * a regression to `useState + useCallback([detail, status])` fails here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TABS = [
  ['SdkMcpStatusTab.jsx', 'nextMcpPanelState'],
  ['SdkContextUsageTab.jsx', 'nextPanelState'],
];

describe('SDK DetailPanel tabs — stable-dispatch (no refetch loop)', () => {
  for (const [file, reducerName] of TABS) {
    describe(file, () => {
      const src = readFileSync(join(here, '..', 'src', 'components', 'dashboard', file), 'utf-8');

      it('drives panel state with useReducer (stable dispatch identity)', () => {
        assert.ok(
          new RegExp(`useReducer\\(${reducerName}`).test(src),
          `${file} must use useReducer(${reducerName}, ...) so dispatch is identity-stable`
        );
      });

      it('does NOT regress to useState + useCallback keyed on [detail, status]', () => {
        assert.ok(
          !/useCallback\([\s\S]*?\],\s*\[detail,\s*status\]\)/.test(src),
          `${file} must not recreate dispatch on [detail, status] — that identity churn is the loop`
        );
      });
    });
  }
});
