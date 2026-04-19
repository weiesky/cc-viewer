# Changelog

## 1.6.172 (2026-04-20)

- UX (permission approval panel no longer covers typed text): the `ToolApprovalPanel` approval dialog used to anchor to the bottom of the viewport (`bottom: 60px` on desktop, `bottom: 16px` on mobile/pad) — shorter than the actual `ChatInputBar`, so it would float on top of whatever the user was mid-typing. Fix: on desktop+iPad (local-render path via ChatView), wrap both `<ToolApprovalPanel>` instances and `<ChatInputBar>` in a new `.inputStack { position: relative; flex-shrink: 0 }` container, and switch the panel to `position: absolute; bottom: 100%; margin-bottom: 8px` — the panel's bottom edge now anchors to the input bar's top edge regardless of how tall the input bar grows (multi-line, pasted images, etc.). On mobile (global-render path via `Mobile.jsx`, rendered outside `mobileCLIBody` to avoid transform affecting fixed positioning — so it can't be wrapped in `.inputStack`), `ChatInputBar` now publishes its own `offsetHeight` to a `--chat-input-bar-height` CSS custom property on `document.documentElement` via a `ResizeObserver`; `.panelGlobal` uses `bottom: calc(var(--chat-input-bar-height, 140px) + 12px)` to track the input bar dynamically. The 140px fallback matches the mobile single-line minimum (10+16 padding + 52px textarea + ~38px bottom button row + border). Cleanup on unmount disconnects the observer and removes the property. Pad mode's `:global(html.pad-mode) .panel` stopped setting `position: fixed` — it now inherits the base `position: absolute; bottom: 100%` and the `.inputStack` wrapper, keeping the same anchor behavior as desktop. Media query for `max-width: 768px` similarly dropped its `position: fixed; bottom: 16px`, keeping only horizontal padding. Net effect: the panel always appears immediately above the input bar, never covers the cursor or typed text, works identically across desktop / iPad / mobile
- Cleanup (remove "open [Terminal] to approve" hint): the secondary tip `ui.chatInput.hintTerminal` shown to the right of the Enter/Tab hint on desktop is removed — its 18 language translations are deleted from `src/i18n.js`, the `.chatInputHintSep` and `.chatInputHintTerminal` CSS classes are dropped from `ChatInputBar.module.css`, and the `<span>` nodes rendering them are gone from `ChatInputBar.jsx`. Desktop users now see only the Enter/Tab hint; mobile `hintMobile` (which has a different wording about "switching to [Terminal] mode") is untouched

## 1.6.171 (2026-04-19)

- Feat (animated Claude logo avatar during SSE streaming): when `MainAgent` model is Claude and the message is the one currently being streamed (`showTrailingCursor=true`), the avatar swaps from the static Claude starburst to a **continuous-wave morph animation** where each of the 12 tentacles takes turns extending outward (the extensions physically punch beyond the 32px circular avatar via `overflow="visible"`, giving a "reaching out" effect). Built as a single-path CSS `d` property animation — 11 unique `@keyframes` states, each being the full original logo with exactly one tentacle's interior vertices pushed out by 1.2x from that tentacle's waist midpoint (waist anchor points are shared with neighbors and stay fixed, so the path morph is seamless with zero cross-tentacle gaps or junction flicker). Linear interpolation between adjacent states (3.2s cycle, ~0.27s per tentacle) produces a traveling wave where two adjacent tentacles are partially extended at any moment. Optimizations applied: integer-rounded coordinates (~15% size cut, imperceptible on a 1024 viewBox), 0%/100% keyframe deduplication, CSS whitespace minified, `will-change: d` hint for path-shape caching, `shape-rendering: geometricPrecision` to prevent browsers from dropping antialiasing during morph. Final asset 17.5KB (down 31% from the 25KB first cut); imported raw via Vite `?raw` and attached as `svgAnimated` field on the Claude provider in `MODEL_PROVIDERS` so `getModelInfo()` returns it alongside the static `svg`. `ModelAvatar` (ChatMessage.jsx:51) now takes a `streaming` prop and picks `svgAnimated` when streaming-and-available, falling back to static otherwise; `renderAssistantMessage` passes `!!showTrailingCursor`. Honors `prefers-reduced-motion: reduce` (animation disabled entirely, renders as static bumped-state-0)
- Fix (monochrome model logos invisible in light theme): GLM, Kimi, and MiniMax logos were all drawn with pure white fill (GLM via `.st0 { fill: #fff }` in an inlined `<style>`, Kimi via `fill="#F4F4F4"`, MiniMax via `fill="#fff"` + `stroke="#fff"`) — designed for the dark-theme black avatar background (`--bg-model-avatar: #000`) but invisible under snow-mountain-white theme where the background becomes `transparent` and sits on top of the page's light surface. Fix swaps all three SVGs' hardcoded whites to `currentColor`, adds a new theme-driven CSS variable `--model-logo-mono` (dark = `#fff`, light = `#000`) in `src/global.css`, and routes it through both avatar container classes — `ChatMessage.module.css::.avatar` (previously hardcoded `color: #fff`) and `TeamSessionPanel.module.css::.teamAgentAvatar` + its nested `svg` rule (previously both `#fff`). Inline SVG rendering via `dangerouslySetInnerHTML` cascades `color` through to `currentColor` automatically. Brand-colored logos (Claude `#D97757`, OpenAI `#EFA474`, Gemini `#448AFF`, Qwen `#7D5DED`, DeepSeek `#4D6BFE`) use explicit hex fill and are unaffected. Source files at `src/img/model-{glm,kimi,minimax}.svg` are also updated to `currentColor` for consistency even though they aren't loaded at runtime (the rendered SVGs are inlined strings in `helpers.js::MODEL_PROVIDERS`)
- Fix (MainAgent avatar stability, 3 root causes): the conversation-view MainAgent avatar icon was unstable — it would display the wrong model for earlier messages, flicker during scroll / re-render, and go stale in intermediate states after `requests` prop changes. Root cause analysis uncovered three overlapping bugs: (1) `ChatView.jsx::_reqScanCache.modelName` only retained the **last-seen** MainAgent request's `body.model` (scan loop kept overwriting), so every message in a session shared one global modelInfo — in a multi-model session (Opus → Sonnet mid-conversation) all earlier messages were retroactively relabeled with the latest model. (2) `helpers.js::getModelInfo()` constructed a fresh `{name, provider, color, svg}` object on every call, breaking `React.memo(ModelAvatar)` and `ChatMessage.shouldComponentUpdate`'s `p.modelInfo !== n.modelInfo` shallow compare — memo always failed, the SVG innerHTML got re-injected on every render, and on long lists with Virtuoso virtualization this accumulated into visible flicker. (3) `componentDidUpdate`'s "requests changed but mainAgentSessions didn't" branch (399-404) cleared `tsToIndex` and `processedCount` but left `modelName` stale, producing an intermediate state where the cache was half-reset. Three-layer fix: **Phase 1** in `src/utils/helpers.js` wraps `getModelInfo` with a module-level `Map<modelName, modelInfo>` — same name returns same reference, so memo and SCU bail out correctly; unknown-model fallback object is also cached, capping memory at ~30 entries in practice. **Phase 2** in `src/components/ChatView.jsx` adds `_reqScanCache.modelNameByReqIdx: []` (dense array indexed by request position) populated with **carry-over semantics**: during the scan loop (1037-1048) `let lastModelName = cache.modelName` carries the prior scan's final value, each iteration updates `lastModelName` only when the request actually has `body.model`, and every position gets `modelNameByReqIdx[i] = lastModelName` — this makes the array **append-only**: once a slot is written, it never changes, so `_sessionItemCache` entries that have already baked a modelInfo into their JSX stay correct across subsequent scans (critical for avoiding cache invalidation logic). **Phase 3** introduces a `resolveModelInfo(ts)` closure in `buildAllItems`: for each message's `_timestamp`, looks up `tsToIndex[ts] → requestIndex → modelNameByReqIdx[idx] → getModelInfo(name)`; falls back to `globalModelInfo = getModelInfo(cache.modelName)` when the timestamp has no matching request (teammate-session fallback, messages with null ts). `renderSessionMessages` signature changes from `(messages, keyPrefix, modelInfo, tsToIndex, startIdx)` to `(messages, keyPrefix, resolveModelInfo, tsToIndex, startIdx)`; its internal loop sets `const modelInfo = resolveModelInfo(ts)` per message and passes that to each `<ChatMessage>`. Three call sites updated (989 teammate-fallback with `() => null`, 1160 incremental-render path, 1183 full-render path); initialization points for `modelNameByReqIdx: []` added at constructor (76), sessions-changed reset (386), requests-changed reset (401-404, also now clears `modelName`), and `startIdx === 0` reset branch (1031-1035). `cache.modelName` itself is deliberately **preserved** because 4 other consumers (`collectedRolesMap` at 2830/2840 for the sidebar agent-roles menu, plus 3 permission-modal sites at 323/3302/3355/3410) semantically need "current active model," not per-message. Last Response panel (1321) uses `globalModelInfo` for the same reason — it's always the last response of the last session. ChatMessage.shouldComponentUpdate (107) and ModelAvatar memo (51-60) are unchanged: Phase 1's stable references make the existing `!==` compare reliable. Net effect: per-message modelInfo accuracy in multi-model sessions, memo actually bails out (no more SVG re-injection on scroll), and carry-over semantics mean the `_sessionItemCache` needs no new invalidation logic — existing entries are immutable. 976 tests green; manual verification on a session that switches models mid-conversation shows each message displays its contemporaneous model's avatar

## 1.6.170 (2026-04-19)

- Perf (send-button spinner, real fix): the CSS `transform: rotate()` animation on the send-button streaming ring was actually running on the **main thread**, not the compositor — a Chrome Performance trace uploaded by the user revealed `compositeFailed: 1024` (`kTransformRelatedPropertyDependsOnBoxSize`) on the `_ccvSendSpin_*` animation at t=4007ms. Root cause: the SVG element had `inset: -3px; width: calc(100% + 6px); height: calc(100% + 6px)` plus `transform-origin: 50% 50%`, and the percentage transform-origin combined with box dimensions that depended on the parent's layout prevented Blink from promoting the animation to its own compositor layer. During main-thread stalls (seen: eight RunTasks >200ms, one 1037ms) the rotation would freeze and then snap forward — exactly the stutter the user perceived. Fix: wrap the decorative SVG in a new `.streamingSpinner` HTML div with **explicit pixel dimensions** for every breakpoint (34×34 desktop + pad-mode, 53×53 under `@media (max-width: 768px)`) so Blink can resolve the box size at layer-commit time and promote. The animation (`transform-origin: 50% 50%`, `will-change: transform`, `animation: ccvSendSpin 1.8s linear infinite`) moves onto the HTML div; the SVG inside is now purely static geometry (three `<circle>` elements with staggered static `stroke-dashoffset` values). Old `.streamingSvgFading` class renamed to `.streamingSpinnerFading` to match. `prefers-reduced-motion: reduce` still applies, now on the spinner class. No-op for the user-visible behavior when compositor promotion succeeds — smooth rotation survives arbitrary main-thread stalls
- Perf (SSE streaming overlay, rAF + startTransition): every SSE `stream-progress` event arrived in a separate macrotask and ran its own `setState({ streamingLatest })`, triggering a full ChatView → ChatMessage → MarkdownBlock reconcile per chunk. Main-thread trace showed 40% of wall time spent in React reconciliation during streaming (8,295ms out of 20,579ms, 45 tasks >100ms, worst input latency p95 = 910ms; interactive elements like the send button and textarea effectively froze). Fix at `src/AppBase.jsx::stream-progress` handler: buffer each chunk's payload into `this._pendingStreamingLatest`, schedule a single `requestAnimationFrame` via `this._streamingRaf` single-in-flight guard, and on the rAF tick apply `React.startTransition(() => setState({streamingLatest: pending}))`. Net effect: ChatView renders are now capped at display refresh rate (coalescing 3-4 chunks per rAF during burst windows) AND marked as non-urgent so concurrent user input / clicks can preempt them. Latest-wins pending keeps the data fresh; `componentWillUnmount` cancels the rAF and clears the pending ref to avoid late-landing setState on an unmounted component. Final-chunk correctness preserved: the authoritative terminal state is delivered via the separate entry path (`_flushPendingEntries`), not via `stream-progress`, so dropping trailing stream-progress frames on unmount is safe. The `existingFinal` stale-duplicate check runs before pending is written so a delayed chunk for an already-finalized timestamp cannot resurrect the overlay
- Perf (incremental markdown, B.2): `src/utils/markdownIncremental.js` (new file) adds a `splitFrozenTail(text)` helper and a `renderIncremental(text)` function. Mid-stream, `MarkdownBlock` (when `trailingCursor=true`) now splits the growing text at the last `\n\n` that is outside an unclosed fence, rendering the **frozen prefix** via `renderMarkdown` (which hits the existing `_mdCache` Map after the first pass → essentially free on subsequent chunks) and only the **tail** gets re-parsed + re-sanitized. Expected 30-50% parse-time reduction during streaming, since the tail is typically <2KB while the full cumulative text can reach tens of KB by end of response. Four safety gates in `splitFrozenTail`: (1) no `\n\n` → whole string is tail; (2) odd fence count (still inside an unclosed ``` block) → whole string is tail; (3) text contains a reference-style link definition `[x]: url` anywhere → whole string is tail (definition and usage may span the cut, causing the link to silently not resolve); (4) the line immediately before or after the `\n\n` cut starts with `|` (pipe-table row) → whole string is tail (prevents tables from being shredded into two fragments that marked can't reassemble). When `trailingCursor` flips to false at stream end, MarkdownBlock falls back to `renderMarkdown(text)` which hits the normal cache → the final HTML is always byte-identical to what you'd get from one full-text parse. Known remaining edge case (accepted): loose-list continuations that span the cut briefly render as two adjacent `<ul>` blocks with slightly different item styling mid-stream; resolves the instant the final parse happens
- Build (vendor chunk split): `vite.config.js` adds `rollupOptions.output.manualChunks` partitioning eight vendor groups (`vendor-react`, `vendor-antd`, `vendor-virtuoso`, `vendor-highlight`, `vendor-markdown`, `vendor-qrcode`, `vendor-xterm` covering 5 xterm packages, `vendor-codemirror` covering 15 codemirror packages). Previously Rollup had merged these into a single 3.2MB chunk misnamed `AppHeader.module-*.js` because AppHeader.jsx (1966 lines) was the first importer that pulled a shared CSS module, giving the chunk its nominal name. The shared vendor code was being re-parsed by V8 every time the shared chunk was re-downloaded (app-code change → full 3.2MB invalidation). After the split: largest chunk drops to `vendor-codemirror` at 1.06MB (only loaded when TerminalPanel is opened), `vendor-antd` at 1.04MB, the renamed `AppHeader.module-*.js` settles at 827KB of actual app code. V8 parse time is roughly linear in chunk bytes; the app-code chunk is now ~26% of the previous size, and vendor chunks are cache-stable across app patches so re-downloads are much smaller. No static `antd/dist/reset.css` is imported (antd 5 uses cssinjs), so chunk splitting doesn't risk CSS-ordering FOUC; mermaid / katex / html2canvas are already dynamic-imported by the code-paths that need them (kept out of the manual list to avoid eager bundling)

## 1.6.169 (2026-04-19)

- Feat: Chat input now has a microphone button that uses the Web Speech API (`webkitSpeechRecognition`) for voice-to-text. Tap-to-start / tap-to-stop continuous recognition; interim transcripts are shown in italic grey below the textarea, and finalized text is inserted at the caret position the moment recording began (start-position is captured as a `{prefix, suffix}` anchor so each `onresult` event rebuilds `textarea.value = prefix + finalAcc + suffix`, letting Chrome's cumulative `event.results` array be re-iterated every tick without double-counting). Recognition locale auto-follows the UI language through a closed `SPEECH_LANG_MAP` that maps cc-viewer's 18 supported languages to BCP 47 codes (zh→zh-CN, zh-TW→zh-TW, en→en-US, no→nb-NO, etc. — `'en-US'` fallback). Button is feature-detected at module load via `window.isSecureContext && (window.SpeechRecognition || window.webkitSpeechRecognition)` and simply not rendered in environments that lack either — so Electron (Chromium's cloud-speech endpoint was removed upstream), Firefox, AND the very common mobile-QR flow where the phone hits `http://192.168.x.x:PORT` (not a secure context, `getUserMedia`/speech would be blocked anyway) all see a clean UI with no broken affordance. Robustness: typing into the textarea while recording aborts the session via an `onInput` wrapper that checks `e.nativeEvent?.inputType` — prevents the prefix/suffix model from being desynced by concurrent edits; component-unmount cleanup calls `recRef.current?.abort()` to release the browser's microphone indicator; `onerror` branches on `'not-allowed' | 'service-not-allowed'` to surface a new `ui.chatInput.voicePermissionDenied` alert (explicitly mentioning HTTPS/localhost to unblock users who QR-scanned via a LAN IP), silently ignores `'no-speech'` and `'aborted'`, and logs everything else. Parent-state sync reuses the existing `onChange` prop pathway (`onChange({ target: textarea })`) so `ChatView`'s `inputEmpty` flips correctly without touching `ChatView.jsx`. Visual state: `.micBtn` shares `.plusBtn`'s 28×28 circular base via combined selector (preserves desktop/mobile/pad-mode responsive rules in one place), and `.micBtnRecording` layers a red fill plus a `ccvMicPulse` keyframe box-shadow ring
- i18n: +3 chat-input keys × 18 languages — `ui.chatInput.voiceStart`, `ui.chatInput.voiceStop`, `ui.chatInput.voicePermissionDenied`
- Docs: README.md + all 17 translated docs/README.{lang}.md files now carry a "Voice input" note in the Mobile Programming section that explains both paths — the in-app mic button (requires HTTPS/localhost) and the platform keyboard's built-in dictation (Gboard on Android, iOS system dictation), so LAN-HTTP users who can't see the button know how to get voice input anyway
- Hardening (post-review): (1) `onresult` now verifies `textarea.value.startsWith(anchor.prefix) && .endsWith(anchor.suffix)` before merging — if the parent overwrote textarea imperatively (Enter-send clears to empty, `/clear` writes `/clear`, Tab accepts a suggestion), the recognizer aborts instead of re-inserting the sent text. (2) New `useEffect([terminalVisible])` aborts recording when the terminal panel takes over, so switching away from chat doesn't leave a silent recording session with the browser mic indicator stuck on. (3) Unmount cleanup nulls `rec.onend/onresult/onerror` before `abort()` to prevent React "setState on unmounted component" warnings when the late `onend` fires. (4) `toggleRecording` and `startRecording` now guard on `recRef.current` (the authoritative state) rather than the `recording` React state, closing a double-click race where two sessions could spin up before React flushed. (5) `r[0]?.transcript ?? ''` defensive fallback if a result entry is somehow malformed. (6) IME-composition safe: `handleTextareaInput` additionally checks `!e.nativeEvent?.isComposing` so mid-composition input events in CJK IMEs don't abort the session until the character is actually committed. (7) Mic button now has `type="button"`, `aria-pressed={recording}`, and a matching `aria-label` for screen-reader toggle-state announcement
- Theming: `--color-error-rgb` added to `src/global.css` in both dark (`239, 68, 68`) and light (`207, 34, 46`) palettes so `ccvMicPulse` keyframes can use `rgba(var(--color-error-rgb), 0.45)` instead of a hardcoded Material red (`#e53935`) that mismatched the actual `--color-error` token in light theme. `.micBtnRecording` background/border fallback `#e53935` dropped. `@media (prefers-reduced-motion: reduce)` override disables the pulse animation for vestibular-sensitive users
- Layout: `.interimPreview` moved from in-flow (which shifted the mic button down ~40px on desktop / ~60px on mobile the instant recording started, pulling the tap target out from under the user's finger) to `position: absolute` inside `.chatTextareaWrap`, anchored at `bottom: 4px` with `pointer-events: none` and a `linear-gradient` fade into `--bg-elevated` so interim transcript overlays the textarea's bottom edge without affecting layout. Color bumped from `--text-tertiary` to `--text-secondary` for WCAG AA contrast at 12px. `z-index: 101` keeps it above the `.plusOverlay` (z-index: 99) when the `+` menu is open

## 1.6.168 (2026-04-19)

- Fix (CLAUDE_CONFIG_DIR follow-up, 6 real bugs): audit of PR #65's migration surface turned up several runtime paths that still hardcoded `~/.claude/` and would silently misfire for third-party wrappers. (1) `electron/main.js:506` theme watcher routed through `getClaudeConfigDir()` — Electron app now watches the correct preferences.json. (2) `findcc.js::resolveNativePath` step 3: `~/.claude/local/claude` in `NATIVE_CANDIDATES` is now rewritten through `getClaudeConfigDir()` while `~/.local/` keeps raw `homedir()` expansion. (3) `lib/ensure-hooks.js` malformed-settings warn interpolates the real `settingsPath`. (4) `server.js::/api/preferences` GET now exposes a home-friendly `claudeConfigDir` field; the canonicalization uses `path.join(_home, '.claude')` instead of string concat so Windows paths round-trip correctly. (5) `TerminalPanel.jsx::handleEnableAgentTeam` now interpolates the real config dir into the prompt it sends Claude — previously hardcoded `~/.claude/settings.json` twice, which would make Claude edit the wrong file under CLAUDE_CONFIG_DIR. (6) `TerminalPanel.jsx:1116` disabled-state Popover for the Agent Team toolbar button now uses the new `tc()` wrapper so `{configDir}/settings.json` resolves (was leaking the literal placeholder under the prior refactor)
- i18n: 36 tooltip/help strings across 18 languages × 2 keys (`ui.enableThinkingSummariesTip`, `ui.terminal.agentTeamDisabledTip`) migrated from embedded `~/.claude/settings.json` literals to a `{configDir}/settings.json` placeholder. Frontend caches the server-provided `claudeConfigDir` in `src/utils/tClaude.js` (single file owning both the state singleton and the `tc()` wrapper); hydration lives in `AppBase.jsx:211` inside the canonical unconditional `/api/preferences` fetch, not in component-level handlers gated by feature flags. `tc(key, params)` locks the injected `configDir` — callers cannot override — since a UI must always render the real path. Net effect: CLAUDE_CONFIG_DIR users see their actual directory in tooltips instead of the misleading default; default users continue to see `~/.claude/settings.json` exactly as before
- Feat: `ccv` now launches Claude with `--thinking-display summarized` by default, since Opus 4.7 no longer streams thinking without explicit opt-in. New `withDefaultThinkingDisplay(args)` helper (exported from `pty-manager.js`) appends the flag only when absent in both space form (`--thinking-display X`) and equals form (`--thinking-display=X`); users who pass their own value always win. Applied at both spawn sites (`pty-manager.js::spawnClaude` and `cli.js::runProxyCommand`). +7 unit tests covering empty array / append-at-end / space-form override / equals-form override / non-mutation / non-array defensive / mid-array detection
- Feat: Custom UltraPlan Expert modal now has a `?` help icon in its title; clicking opens a new `concepts/{zh,en}/CustomUltraplanExpert.md` guide that explains the two input fields, the auto-wrapping `<system-reminder>` behavior, and breaks down the researchExpert template section-by-section (scope header, opening task definition, 5-step workflow, sub-role roster, deliverable checklist). Concrete recommendations: keep the wrapper, rewrite the opening sentence for non-software domains, flex the workflow based on task complexity, rewrite sub-roles per domain, align the deliverable checklist to the real need. Closes with a refactored Competitive Analyst example (4 steps, 3 sub-roles vs researchExpert's 5/6)
- UI: `.compactBtnNoBorder` (AppHeader) font-size bumped from 12px→18px; the accompanying `inline-flex` centering fix makes icon-only buttons sit on the same baseline as neighbor Ant Button siblings regardless of font-size, preventing the "floating up" issue that would otherwise show when the class's content differs in baseline metrics from the siblings
- Tests: +2 for `resolveNativePath`'s `~/.claude/` CLAUDE_CONFIG_DIR rewrite branch (one happy path, one empty-custom-dir guard). +2 for `/api/preferences` claudeConfigDir field (default `~/.claude` + CLAUDE_CONFIG_DIR absolute-path override — the latter is the regression guard for the Windows path-separator fix). 974 tests total, all green

## 1.6.167 (2026-04-18)

- Fix: `ccv -logger` mode selection no longer depends on the `realpath(which claude).includes('node_modules')` heuristic. That check was designed for the 1.x era when `node_modules` meant "npm JS install" — but Claude Code 2.x native binaries also live under `node_modules`, so the check misfired (`prefersNative = false` for 2.x, the opposite of what it should be). Under 1.6.166 the bug was masked by `hasNpm=false` forcing fallthrough to `native`, but a user with both a 2.x install AND a stale cli.js elsewhere would have been wrongly pushed into npm-injection mode. The `prefersNative` loop is deleted; mode is now decided purely by `hasNpm ? 'npm' : (nativePath ? 'native' : 'unknown')` — one fact, one decision
- Fix: Legacy npm-mode shell hooks self-heal on Claude Code 2.x upgrade. Pre-2.x users have a `~/.zshrc` hook that loops over `@anthropic-ai/claude-code/cli.js` candidates; on 2.x those paths don't exist, the loop leaves `cli_js=""`, and the hook silently falls through to `command claude "$@"` — cc-viewer is never triggered. The npm hook template now includes an `if [ -z "$cli_js" ]` branch that, on detecting the 2.x layout, backgrounds `ccv -logger &` to rewrite `~/.zshrc` with the native hook AND routes the current invocation through `ccv run -- claude --ccv-internal "$@"` so this very command gets proxied instead of running bare. Next shell reads the native hook directly; no user intervention needed. Also adds a `case "$1" in --ccv-internal)` recursion guard at the top of the npm hook (previously only in the native hook)
- Feat: `cli.claude2x.binaryMissing` + `cli.claude2x.reinstallHint` + `cli.notFound.nativeHint` i18n keys (18 languages each). The "claude not found" error path (`runCliMode`, `runProxyCommand`, `ccv -logger` mode=unknown) now routes through a unified `reportClaudeNotFound()` helper that distinguishes "Claude Code 2.x wrapper installed but postinstall didn't run / `--omit=optional`" (prints the exact `node install.cjs` path to run) from "claude not installed at all" (generic hint). New `hasClaude2xWrapper(nodeModulesRoot)` export in `findcc.js` detects the 2.x layout by `install.cjs` presence
- Tests: +4 for `hasClaude2xWrapper` (null, missing, present in 2.x, absent in 1.x). +4 source-grep invariant tests in `test/cli.test.js` guarding the `if [ -z "$cli_js" ]` self-heal branch, the `ccv run -- claude --ccv-internal` routing, the repeated-repair path for missing CC-Viewer marker, and a regression guard that the deleted `prefersNative` loop can't come back. 964 tests total (+8)

## 1.6.166 (2026-04-18)

- Fix: `ccv` on Claude Code 2.x still failed with `Error: claude native binary not installed` whenever the wrapper package's `postinstall` didn't run (`--ignore-scripts`, some pnpm configs, `--omit=optional`). 1.6.165 correctly located `@anthropic-ai/claude-code/bin/claude.exe`, but that file is a placeholder stub — the real native binary is copied over it by `install.cjs` only after postinstall completes. If postinstall was skipped, exec'ing the stub prints the install-instructions error and exits code 1. `resolveNativePath` now probes the platform-specific optional dependency first (e.g. `@anthropic-ai/claude-code-darwin-arm64/claude`), which is the authoritative source of the native binary regardless of postinstall state — both the hoisted (flat under global node_modules) and nested (under the wrapper package's own node_modules) layouts are checked. Only falls back to `which claude` / `NATIVE_CANDIDATES` / the wrapper's `bin/claude.exe` if the platform-specific package is missing entirely (e.g. user really did `--omit=optional`). New exports `detectPlatformKey()` (darwin/linux/win32 + arch, with Rosetta 2 + musl detection mirroring upstream `install.cjs`) and `findPlatformBinary(nodeModulesRoot)` — +5 unit tests covering platform key shape, null/missing-root guards, flat layout, nested layout. Also updated the subprocess-driven `resolveNativePath` tests to set `NPM_CONFIG_PREFIX` to a nonexistent path so step 1 misses and step 2 (`which`) is what's being exercised, preventing cross-test contamination from the host machine's real npm root

## 1.6.165 (2026-04-18)

- Fix: `ccv` no longer exits with "claude not found" on Claude Code 2.x — the upstream `@anthropic-ai/claude-code@2.x` package dropped `cli.js` and now ships a native binary at `bin/claude.exe` *inside* the npm package. The previous `findcc.js::resolveNativePath` deliberately rejected any `which claude` result whose realpath lived under `node_modules` (a rule that used to skip the legacy JS cli wrapper) — with 2.x this rule misfired and both resolvers returned null. The rejection is now narrowed to realpaths ending in `.js` (true JS wrappers), so 2.x native binaries in `node_modules` are accepted. A 3rd fallback scans `{globalRoot}/{pkg}/bin/claude(.exe)` directly, so discovery works even when `claude` is not on `PATH`. New exported `findPackagedBinary(nodeModulesRoot)` helper for testability. +7 tests: 5 for `findPackagedBinary` (null root, empty pkg, `.exe` 2.x layout, unix `claude` name, package priority) and 2 subprocess-driven tests that actually exercise the rejection rule (accepts non-`.js` binary under `node_modules`, still rejects `.js` shim under `node_modules`) so a regression to the old `node_modules`-wide rejection would be caught
- Feat: Custom UltraPlan experts — users can now author their own named role templates alongside the built-in 代码专家/调研专家. New "+" button in the UltraPlan popover header (both `UltraPlanModal.jsx` mobile entry and `TerminalPanel.jsx` desktop popover) opens a lightweight `CustomUltraplanEditModal` for title + body; saved entries render as clickable role buttons in the variant row with a hover pencil for edit/delete. At send-time the stored body is auto-wrapped in `<system-reminder>[SCOPED INSTRUCTION]…</system-reminder>` using the same preamble as the two built-ins. Persistence piggybacks on `/api/preferences` (new `customUltraplanExperts` key, generic `Object.assign` merge on the server side — no new route). Cross-component sync: both `persist*` methods dispatch the existing `ccv-presets-changed` event, both loaders re-read the list and reset `ultraplanVariant` to `codeExpert` if the currently-selected custom id was removed remotely, so creating/editing/deleting in one entry point is immediately visible in the other. i18n: 9 new `ui.ultraplan.custom*` keys × 18 languages
- Docs: `concepts/{zh,en}/UltraPlan.md` now carry a "原文" section with the two raw `<system-reminder>` prompt templates (codeExpert + researchExpert) in `<textarea readonly>` blocks, matching the format already used by `Tool-Bash.md`. Makes the actual text that UltraPlan sends to Claude Code inspectable from the ConceptHelp modal, so users can see exactly what the role instruction does before invoking it
- Fix: `TerminalPanel.handleUltraplanSend` now guards `if (!assembled) return` **before** clearing `ultraplanPrompt/Files` state. With the new custom variant, an expert whose body somehow became empty would previously wipe the user's typed prompt silently; now the prompt is preserved. Aligns with the order `ChatView._handleUltraplanSend` already used
- a11y: `.editPencil` / `.ultraplanEditPencil` use `inset-inline-end: -4px` instead of `right: -4px` so the pencil affordance lands correctly on the button's trailing edge in RTL locales (ar, etc.) instead of clipping the icon

## 1.6.164 (2026-04-18)

- UI: Redesigned the QR-code toolbar icon in `AppHeader.jsx` as a single `<path fill-rule="evenodd">` (three 10×10 finder patterns with hollow ring + center dot, plus a symmetric 5-dot X-shaped data pattern in the bottom-right). Removes 2 dead `fill="none"` rects from the old inline SVG, all features ≥ 3 SVG units so the 18px render no longer sub-pixel blurs, path length −57% (637 → 272 chars)
- Sec: `countUntrackedLines` (lib/git-diff.js) now refuses symlinks and paths that resolve outside `cwd`. Without this guard a user symlinking e.g. `/etc/passwd` into a repo would cause `/api/git-status` to read the target and add its line count to `insertions`, leaking the file's existence and rough size. Matches git's own numstat behavior (does not follow symlinks for untracked paths). +3 security test cases
- Perf: `/api/git-status` caps untracked-file processing at `MAX_UNTRACKED = 1000` to keep the event loop responsive on repos that forget to gitignore large directories (node_modules etc.)
- Fix: Mount profiling no longer double-counts parse time — `MarkdownBlock.jsx` moves `mountStartRef.current = performance.now()` to after the `useMemo(renderMarkdown)` call, so `md-parse` and `md-mount` measures are now disjoint. Without this fix the P1 decision matrix in `docs/profile-baseline.md` would have been fed a mount number that included parse.
- Chore: Rename `__DEV_PROFILER__` → `DEV_PROFILER_ENABLED` (markdownProfiler.js + callers) to match the project's existing constant style (`_MD_CACHE_MAX`, not double-underscored macros)
- Chore: `test/markdown-profiler.test.js` now imports `percentile` and `createStats` directly from `src/utils/markdownProfiler.js` instead of keeping inlined copies; the module's DEV check short-circuits to false under `node --test` so no side effects fire. Eliminates the source-vs-test drift risk flagged in the review
- Fix: Git Changes aggregate `+N -M` badge now includes untracked files — `server.js` `/api/git-status` handler previously summed only `git diff --numstat` and `git diff --cached --numstat`, neither of which covers untracked (`??`) files, so the panel header could report `+22 -2` while the file list showed additional untracked entries with their own `+182`-style counts coming from the separate `/api/git-diff` pipeline. New helper `countUntrackedLines(cwd, file)` in `lib/git-diff.js` reads each untracked file and counts lines with `git diff --numstat` semantics (skip binary via null-byte probe in first 8KB, skip >5MB, count trailing unterminated line). Server adds these counts into `insertions` after the numstat pass. +14 unit tests including a semantic-equivalence check against `git diff --numstat` output for a typical JS source file
- Test: Markdown render regression suite — `test/markdown-render.test.js` (basic elements, cache FIFO eviction, escapeHtml fallback), `test/markdown-stream.test.js` (unclosed fenced code blocks, Go struct-tag backtick backtracking guard mirroring Streamdown issue #357, list stability across streaming prefixes, incomplete table rows, nested lists, unclosed inline tokens; 1000-line parse budget tightened to 50ms), and `test/markdown-profiler.test.js` (percentile boundaries, bounded-array eviction, parse/mount isolation, summary immutability, reset). +43 assertions, all green. Closes prior test coverage gap that blocked any future engine swap
- Perf/Dev: `src/utils/markdownProfiler.js` — dev-only instrumentation gated on `import.meta.env.DEV`, exposes `window.__mdStats.summary()` (P50/P95 of parse and mount) and emits Chrome DevTools Performance `md-parse` / `md-mount` measures for attributing SSE chunk cost between marked+DOMPurify parse vs. React update + innerHTML DOM replace. Auto-prunes `performance.clearMeasures` every 500 samples so long dev sessions do not accumulate DevTools entries. Production build dead-code-eliminates every export (verified — no profiler symbols in dist/assets/*.js)
- Docs: `docs/profile-baseline.md` — data-collection protocol + decision matrix so the P1 engine-swap branch (markdown-it vs. block-level React.memo vs. no-op) is picked from numbers, not guesses. `docs/streamdown-watchlist.md` — 8 upstream conditions tracking when to reevaluate Vercel Streamdown (Shiki CSP fix, mermaid peer dep, error boundary, Go backtick fix, lodash vuln, benchmark, API stability, non-Tailwind path)
- Chore: `src/utils/markdown.js` wraps the DOMPurify+marked call in `measureParse()`; `src/components/MarkdownBlock.jsx` uses a ref-based mount measurement (`recordMountSample`) so a discarded render under React 18 concurrent mode simply gets overwritten by the next render's timestamp without leaking state. Both branches compile to the original code path in production

## 1.6.163 (2026-04-18)

- Fix: proxy-prefixed Claude-compatible endpoints now captured in logger mode — `lib/interceptor-core.js::isAnthropicApiPath` removes the leading `^` anchor from the `/v1/messages` regex so paths like `/proxy/group_xxx:8100/v1/messages` match. Trailing `$` kept to still reject invalid suffixes (e.g. `/v1/messages/unknown`); `/api/eval/sdk-` anchor left untouched. Adds 2 test cases for proxy-prefixed URLs

## 1.6.162 (2026-04-17)

- Perf: SSE smooth sticky follow — `ChatView.jsx` replaces per-chunk instant `scrollTop = scrollHeight` with rAF easeOut loop (each frame consumes ~35% of gap, clamped 1~120px); eliminates visible viewport jump on newline, dramatically smoother typewriter effect
- Perf: `.streamingTail` stabilization — adds `contain: layout style` and `min-height` on common streaming leaf elements; reduces reflow chain when marked re-parses partial markdown
- Perf: streaming thinking auto-collapse softened — `.collapseStream` scoped CSS overrides antd Collapse transition to 600ms easeOutCubic with body opacity fade-out; non-streaming Collapse keeps default 200ms response unchanged
- Perf: cursor fade-in — `cursorEnter` 40ms ease-out animation smooths `::after` cursor hard-appear at block-structure transitions
- Perf: AppHeader `renderTokenStats` lazy via Popover function content — `<Popover content={() => this.renderTokenStats()}>` only invokes on open; previously ran on every AppHeader re-render. Eliminates the 3x O(N) aggregations (token / tool / skill stats) and large JSX subtree construction when popover is closed
- Perf: AppHeader `renderTokenStats` instance-level memoization — `===` compare on `requests` / `cacheHighlightIdx` / `cacheHighlightFading` returns cached JSX on hit; perf trace confirms ~98% reduction in stack samples when popover stays open across many re-renders
- Perf: AppHeader countdown loop — `requestAnimationFrame` recursion at 60fps replaced by `setTimeout` aligned to next-second boundary (`1000 - now % 1000`); eliminates ~1900 profiler samples and frees up rAF queue for actual animations
- Perf: ChatMessage avatar / label memo extraction — new `ModelAvatar` and `AssistantLabel` `React.memo` components with stable props (`modelInfo` / `name` / `timeStr` / `requestIndex` / `onViewRequest`) bail out during SSE chunks when only content changes
- Refactor: `_teardownTransientLiveState` helper in `AppBase.jsx` consolidates transient live-state cleanup (`_pendingEntries` / `_flushRafId` / `_streamingOffTimer` / `_loadingCountRafId` / `_chunkedEntries` / `_chunkedTotal` / `_isIncremental` / `_sseSlimmer` / `_sseReconstructor`); called from `workspace_stopped` / `handleReturnToWorkspaces` / `_reconnectSSE` to prevent old-workspace entries from flushing into new state. Does NOT close EventSource — connection is session-level singleton reused across workspaces

## 1.6.161 (2026-04-17)

- Feat: SSE live typewriter effect for latest assistant message in PTY mode — `lib/interceptor-core.js` exports `createStreamAssembler` for incremental SSE parsing; `interceptor.js` adds throttled HTTP POST (100ms / 16KB / content_block_stop) to new `/api/stream-chunk` endpoint; `server.js` broadcasts via dedicated `stream-progress` named SSE event; `AppBase.jsx` adds `streamingLatest` state; `ChatView.jsx` renders live overlay that occupies Last Response position (scheme C) with pendingBubble above it; mainAgent only, Teammate / sub-agent / SDK mode unchanged
- Feat: inline streaming cursor `▌` — `MarkdownBlock.jsx` accepts `trailingCursor` prop; CSS `::after` multi-selector covers last leaf element of paragraph / list / code block / blockquote / table in `.streamingTail` container
- Feat: streaming thinking auto-collapse — `ChatMessage.jsx` switches `Collapse` to controlled `activeKey` during streaming so the panel collapses with ~250ms antd transition when the first text token arrives, eliminating the height jump when overlay hands off to finalized Last Response
- Feat: SSE overlay sticks to bottom during streaming — `ChatView.jsx` double-rAF compensates for Virtuoso ResizeObserver async measurement; works on all layouts (desktop / iOS / iPad non-Virtuoso)
- Feat: loading spinner auto-hides while SSE overlay is active to avoid duplicate "in-progress" indicators
- Fix: SSE overlay was disappearing mid-stream under long thinking pauses / network jitter / tab switches — removed aggressive 10s timeout and `onerror` immediate clear; streamingLatest lifecycle now ends only via atomic clear on final entry arrival (normal) or `_reconnectSSE` (connection death)
- Fix: `process.env.CCVIEWER_PORT` no longer polluted on main process — `setLivePort(port)` module-level setter in `interceptor.js` replaces env write, preventing leak to Bash / MCP / Electron tab-worker child processes
- Fix: `/api/stream-chunk` now enforces loopback-only + `x-cc-viewer-internal: 1` header to prevent same-machine injection into SSE broadcast
- Fix: stream-chunk POST payload slimmed to 4 fields (`timestamp` / `url` / `content` / `model`) instead of cloning full requestEntry, eliminating O(N²) accumulated copy cost on long responses
- Fix: skeleton POST first frame now has `onDone` callback for 413 circuit-breaking
- Fix: roleFilter with assistant deselected now also skips streamingLiveItem to honor filter semantics
- Fix: scrollToTimestamp targeting Last Response during streaming now attaches `_scrollTargetRef` to streamingLiveItem as fallback
- Fix: `workspace_stopped` / `project_selected` / `handleReturnToWorkspaces` now clear streamingLatest to prevent zombie overlay on project switch

## 1.6.160 (2026-04-16)

- Fix: permission hook concurrency — `pendingPermHook` single variable → `pendingPermHooks` Map, supports concurrent sub-agent/teammate approval requests without superseding
- Fix: SDK mode answer routing — use `resolveApproval()` return value to prevent hook-based responses from being silently swallowed
- Feat: permission queue — multiple concurrent approval requests are queued in UI, shown one at a time with `+N queued` badge
- Feat: "Clear Context" shortcut button in + menu — sends `/clear` with Modal.confirm safety dialog
- Feat: Git diff stats — `+N -M` insertion/deletion badges in Git Changes panel header and per-repo rows
- Fix: perm-bridge.js — defensive 409 handling for legacy server compatibility

## 1.6.159 (2026-04-15)

- Feat: custom user name and avatar via CLI — `--user-name <name>` and `--user-avatar <path|url>` override macOS system identity in chat UI
- Feat: avatar supports online URLs (http/https) and local image files (png/jpg/jpeg/gif/webp, ≤2MB)
- Feat: i18n — `cli.userNameRequired`, `cli.userAvatarRequired` with 18 languages; help text updated
- Fix: UltraPlan send — simplify by reusing input textarea + handleInputSend instead of direct WebSocket with retry

## 1.6.158 (2026-04-15)

- Feat: responsive mode switching — PC width <600px prompts sidebar mode, iPad width >1400px prompts full view mode (matchMedia, zero perf cost)
- Feat: auto narrow detection — PC browser width <750px at startup auto-switches to iPad mode
- Feat: env.js localStorage view mode preference with URL param override priority
- Feat: iPad header blood bar — context window usage progress bar matching PC AppHeader
- Feat: FileExplorer right-click "Insert path to chat" — writes quoted relative path to terminal or chat input
- Feat: MobileGitDiff close button (X) in header
- Fix: UltraPlan send — retry 3x on WebSocket failure, keep modal open on error, unmounted guard
- Fix: scroll stick-to-bottom — direct scrollTop=scrollHeight for all platforms, scrollToTimestamp guard
- Fix: useVirtuoso excludes pad mode — prevents PC users in sidebar mode from incorrect Virtuoso path
- Fix: UltraPlan iPad modal zoom — pad-mode backdrop zoom:1 override
- Style: loading spinner — pure CSS spinner replaces antd Spin for load-more buttons

## 1.6.157 (2026-04-15)

- Feat: mobile hamburger menu — "Project Folder" entry opens file explorer overlay
- Feat: mobile file explorer — top-bottom split layout (file tree + PC FileContentView/ImageViewer)
- Feat: chat file path click — tapping file paths in mobile chat opens file explorer and navigates to file
- Feat: i18n — `ui.projectFolder`, `ui.mobileFileExplorerHint` with 18 languages
- Fix: overlay mutual exclusion — all setState calls include `mobileFileExplorerVisible`
- Fix: Git Diff / Terminal header toggles missing `mobilePromptVisible: false`
- Style: responsive file list height `min(300px, 45vh)` for small screens
- Style: iOS zoom/transform and iPad pad-mode overrides for file explorer overlay

## 1.6.156 (2026-04-15)

- Feat: UltraPlan mobile entry — "+" menu item opens modal with role selector, file upload, image paste
- Feat: markdown action bar — hover dropdown "Save As" with Markdown file / Save as Image / Save to Project
- Feat: "Save to Project" writes markdown content to project directory via `/api/file-content`
- Style: UltraPlan modal with mobile zoom compensation, backdrop blocks background interaction
- Fix: UltraPlan upload/paste failure shows user-visible error toast

## 1.6.155 (2026-04-14)

- Feat: multi-repo git support — scan project root + first-level subdirs for git repos
- Feat: `/api/git-repos` endpoint discovers all git repos with `resolveRepoCwd` security validation
- Feat: git changes list shows collapsible repo sections (name + change count badge)
- Feat: single-repo projects retain original flat layout (backward compatible)
- Feat: iPad drag-drop routes to terminal or dialog based on active panel
- Fix: GitDiffView image preview and header display use repo-resolved paths
- Fix: git detection falls back to `/api/git-status` for older servers
- Refactor: extract `fetchAllRepos()` to shared `src/utils/gitApi.js`

## 1.6.154 (2026-04-14)

- Feat: iPad drag-and-drop file upload support (mirrors desktop pattern)
- Feat: iPad terminal panel image paste — images stay on terminal with preview strip
- Fix: iPad approval panel uses `position: fixed` globally, visible in both dialog and terminal mode
- Fix: iPad file explorer sidebar defaults to collapsed, respects user preference via localStorage
- Refactor: extract terminal pending-image callbacks to stable class methods

## 1.6.153 (2026-04-14)

- Feat: markdown save-as-image — capture rendered bubble as PNG via html2canvas
- Feat: action bar now has 3 buttons: copy, download .md, save as image
- Fix: action bar excluded from screenshot via `data-html2canvas-ignore`
- Fix: concurrent click guard prevents multiple canvas allocations
- Style: use Ant Design `CameraOutlined` icon for consistent styling

## 1.6.152 (2026-04-14)

- Feat: `--log-dir <path>` CLI option — specify custom JSONL log storage directory at startup (alternative to CCV_LOG_DIR env)
- Feat: `--no-open` CLI option — prevent auto-opening browser on startup, server still runs normally
- Feat: UltraPlan role selector — replace toggle with "代码专家" / "调研专家" pill buttons
- Feat: add scoped instruction to UltraPlan templates to limit influence on subsequent interactions
- Feat: update UltraPlan concept docs across all 18 locales
- Style: pill buttons with SVG icons, auto-width, focus-visible accessibility
- Chore: remove unused simple/visual/auto template variants

## 1.6.151 (2026-04-14)

- Feat: UltraPlan "强制执行" toggle default to ON

## 1.6.150 (2026-04-13)

- Feat: iPad/tablet mode (`?ipad=1`) — Mobile layout with PC-level text scaling and interactions
- Feat: iPad mode enables hover, desktop terminal font/scrollback, file explorer, ResizeObserver
- Fix: notarize timeout reduced to 45min (within CI 60min step limit)

## 1.6.149 (2026-04-13)

- Fix: ImageLightbox auto-fit — small images now scale up to fill viewport on open
- Fix: ImageLightbox double-click toggles between fit-to-screen and natural size
- Fix: notarize timeout reduced to 45min (within CI's 60min step limit)

## 1.6.148 (2026-04-13)

- Feat: Markdown hover action buttons — copy to clipboard & save as .md file (with native OS save dialog)
- Feat: mobile git entry hidden when project has no git (consistent with PC)
- Feat: auto-approve toggle now also approves the current pending permission request
- Fix: PC header QR code icon replaced (phone → QR code SVG), alignment fixed
- Fix: Ant Design Tooltip text color in light theme
- Fix: removed unused `.svgIcon` CSS class

## 1.6.147 (2026-04-13)

- Chore: remove signing guide docs
- Fix: notarization timeout protection (6h) — skip notarization on timeout instead of blocking CI
- Fix: macOS CI build step timeout set to 60 minutes

## 1.6.145 (2026-04-12)

- Feat: UltraPlan Route C template upgrade — webSearch pre-research, up to 5 agents, post-execution TeamCreate Code Review loop
- Feat: UltraPlan send button now directly submits (no manual Enter needed)
- Feat: UltraPlan (?) help icon with concept docs in 18 languages
- Feat: context window warning in UltraPlan panel for non-1M models
- Feat: render `<task-notification>` as structured MainAgent card (summary + collapsible result + usage stats)
- Fix: UltraPlan panel Switch position moved before label text

## 1.6.144 (2026-04-12)

- Fix: iOS Safari mobile font-size clamping — WebKit minimumLogicalFontSize (9px) broke font hierarchy under zoom:0.6; iOS now uses transform:scale(0.6) with non-virtualized rendering to bypass the clamp

## 1.6.143 (2026-04-12)

- Fix: ToolApprovalPanel no longer steals focus when auto-approve countdown is enabled, avoiding interruption of user input in other fields

## 1.6.142 (2026-04-12)

- Feat: macOS code signing / notarization infrastructure (entitlements, notarize script, mac-sign.sh, SIGNING_GUIDE)
- Fix: Electron process cleanup and system text filtering

## 1.6.141 (2026-04-12)

- Feat: sidebar nav adds user avatar button with hover popover showing all user prompts for quick navigation

## 1.6.136 (2026-04-10)

- Feat: Ultraplan button in terminal toolbar — wraps user prompt with ultraplan instructions (AutoModel/level-1/level-2/◇level-3) and sends directly via bracket paste mode; supports file upload

## 1.6.134 (2026-04-10)

- Feat: auto-approve default countdown varies by model family (Claude/OpenAI 3s, Gemini/DeepSeek/Qwen 5s, GLM/Kimi/MiniMax 10s, unknown 10s)

## 1.6.131 (2026-04-09)

- Feat: terminal panel focus border animation (4px + box-shadow glow, 0.3s ease-out)
- Feat: QR code theme-aware colors (white/black for light, dark/gray for dark)
- Feat: Claude Code missing detection with install guide banner (npm + native)
- Feat: footer version display with [NEW] badge and update modal (npm + Electron steps)
- Feat: language settings added to preferences drawer
- Feat: file explorer drag auto-expand folders on 500ms hover (internal move + external import)
- Fix: external file import to subdirectories (server dir parameter parsing from req.url)
- Fix: file explorer external drag state cleanup (dragover timer + document-level fallback)
- Fix: network packets detail panel defaults to Context tab
- Docs: QRCode help docs add "same router/network name" note (18 languages)

## 1.6.130 (2026-04-09)

- Fix: hide git changes button when project has no git repository
- Fix: hide country flag module for CN region
- Fix: i18n trim "查看" prefix from network packets label (zh/zh-TW/ko)

## 1.6.129 (2026-04-09)

- Feat: theme switch (雪山白/曜石黑) in AppHeader toolbar for quick theme toggle
- Feat: theme sync to Claude Code CLI via /theme command with output verification and retry
- Feat: terminal auto-focus on theme switch for visual feedback
- Fix: Electron window close (× button) now shows quit confirmation when projects are open
- Fix: theme sync PTY output buffer capped at 4KB to prevent memory accumulation
- Fix: terminal focus only triggers when terminal panel is visible

## 1.6.128 (2026-04-09)

- UI: request list active/hover border styling with blue border and faint background
- UI: context tab (history sessions) active state with blue border and rounded corners

## 1.6.127 (2026-04-09)

- Feat: auto-approve tool permissions with configurable countdown (off/3s/5s/10s/15s/20s/30s/60s)
- Feat: import external files by dragging from OS into FileExplorer panel
- Feat: new POST /api/import-file endpoint for direct project directory import
- Fix: auto-approve countdown useEffect dependency array completeness
- Fix: server error messages use generic text instead of leaking internal paths

## 1.6.126 (2026-04-09)

- Feat: file explorer drag-and-drop to move files/folders between directories
- Feat: Electron quit confirmation dialog when projects are open (i18n 17 languages)
- Feat: image format support for bmp, icns, avif across all viewers
- Feat: Mermaid chart theme-aware re-rendering on theme switch
- Feat: extract file icons and system-open logic into shared modules (fileIcons.jsx, fileOpen.js)
- Fix: terminal file upload uses two-step Enter (inject path first, confirm send second)
- Fix: path injection uses single-quote escaping to prevent shell expansion
- Fix: move-file API EXDEV cross-filesystem fallback (copy + delete)
- Fix: move-file API returns generic error messages (no path leakage)
- Fix: Electron quit dialog checks mainWindow.isDestroyed() before showing
- Fix: SubAgent avatar background color contrast improved (new --bg-sub-avatar variable)
- Chore: app icon updated

## 1.6.122 (2026-04-08)

- Perf: batch slimmer covers all 9 data loading paths — SSE load, cache restore, partial restore, loadMoreHistory, full\_reload, loadSession, file import
- Refactor: extract \_batchSlim() helper, remove \_sseSlimEnabled opt-out flag (slimmer always on)

## 1.6.121 (2026-04-08)

- Feat: upload file size limit raised from 50MB to 100MB (server + client)

## 1.6.120 (2026-04-08)

- Perf: SSE entry slimmer enabled on all platforms (previously desktop-only) — reduces within-session memory from O(n²) to O(n)
- Perf: un-slim entries before hot/cold splitHotCold to preserve IndexedDB data integrity
- Fix: restoreSlimmedEntry clears \_slimmed/\_fullEntryIndex flags to prevent stale index corruption after array reorganization
- Fix: iPadOS 13+ detection via maxTouchPoints — iPad now correctly treated as mobile (hot/cold + Virtuoso + memory limits)
- Fix: Team panel restoreSlimmedEntry protection for findToolResult, strategy-2 user message extraction, and teammate message extraction

## 1.6.119 (2026-04-08)

- Perf: renderMarkdown LRU cache (1024) — eliminates 5000+ redundant DOMPurify.sanitize calls per render cycle
- Perf: highlight() LRU cache (512) — code syntax highlighting result caching
- Perf: renderAssistantText() LRU cache (512) — system tag parsing result caching
- Perf: session-level incremental buildAllItems — skips unchanged sessions, renders only new messages
- Perf: editSnapshotMap eviction (300 cap with null tombstone) — prevents unbounded snapshot growth
- Fix: TerminalPanel ghost WebSocket reconnect loop — tracked timer + onclose nulled before close
- Fix: AppHeader missing clearTimeout for 3 cache scroll timers in componentWillUnmount

## 1.6.118 (2026-04-08)

- Feat: Electron multi-tab architecture — each tab is an isolated fork() child process with its own proxy/server/PTY
- Feat: BaseWindow + WebContentsView tab bar with project tabs, "+" button, close with confirmation
- Feat: workspace selector as landing page, tab-worker.js for per-project process isolation
- Feat: keyboard shortcuts — Cmd+T (new tab), Cmd+W (close tab), Cmd+1-9 (switch), Cmd+Shift+[/] (cycle)
- Feat: macOS hiddenInset title bar with traffic light padding
- Feat: launch buttons renamed to "常规启动" / "免审启动" with blue/yellow colors
- Feat: server.js supports CCV_ELECTRON_MULTITAB mode — management server delegates launch to tab-worker
- Feat: server.js port range configurable via CCV_START_PORT/CCV_MAX_PORT env vars
- Fix: Electron process isolation — child env cleaned of ANTHROPIC_BASE_URL/CCV_PROXY_PORT to prevent proxy crosstalk
- Fix: pty-manager.js resolves real node path in Electron (process.versions.electron detection)
- Fix: interceptor.js initForWorkspace supports forceNew option for Electron log isolation
- Refactor: ensureHooks() extracted from cli.js to lib/ensure-hooks.js (shared with Electron)
- i18n: added ui.workspaces.normalLaunch / ui.workspaces.skipPermLaunch keys (18 languages)

## 1.6.117 (2026-04-07)

- Feat: Electron desktop app support — workspace mode with dual launch buttons (ccv / ccv --d)
- Feat: workspace launch auto-adds `-c` flag when project has existing logs
- Feat: server `/api/workspaces/launch` accepts `extraArgs` for Claude CLI flags
- Feat: loading pet animation (pixel art gif) on sticky-bottom button when streaming
- Fix: workspace mode uses themeConfig (supports 耀石黑/雪山白) instead of hardcoded dark
- Fix: workspace terminal panel hidden by default after launch
- Fix: FileExplorer header and RoleFilterBar height aligned to 38px
- Fix: RoleFilterBar background → var(--bg-base-pure) for light mode
- Fix: WorkspaceList DirBrowser hardcoded colors → CSS variables
- Fix: gantt chart idle opacity 0.15 → 0.25, agent bar color → var(--text-tertiary)
- Fix: useCallback dependency array: added onAttachToChat in FileExplorer
- Fix: SendMessage/TaskUpdate tool detail no longer truncated at 200 chars
- UI: theme names updated to 耀石黑/雪山白 in all 18 languages
- Chore: removed orphaned i18n key ui.workspaces.open

## 1.6.116 (2026-04-07)

- Feat: file explorer right-click "Attach to chat" — add file as attachment to chat input
- Fix: image attachment remove button (×) always white on both ChatInputBar and TerminalPanel
- Fix: terminal pending file chip background hardcoded → var(--bg-surface)
- Fix: live tag (context progress bar) background → var(--bg-base-pure) for clean light mode
- Fix: light theme folder icon color → #CB7C5E
- UI: theme names renamed — 耀石黑 (Obsidian Dark) / 雪山白 (Snow White)

## 1.6.115 (2026-04-07)

- Fix: stats panel cache rebuild card and teammate card spacing when no SubAgent stats
- Fix: image viewer checkerboard pattern too harsh — use rgba(0,0,0,0.08) for both themes
- Fix: teammate SVG avatars always white (color: #fff) on colored backgrounds in both themes
- Feat: mobile git diff image preview — inline preview with click-to-zoom lightbox
- Fix: log management preview popover hardcoded dark background → var(--bg-elevated)
- Fix: user bubble dashed animation border uses fixed #fff instead of var(--text-white)

## 1.6.114 (2026-04-07)

- Fix: model avatar background hardcoded #000 → var(--bg-model-avatar), light theme uses #e8e8e8
- Fix: ToolApprovalPanel shadow too heavy in light mode — extracted to CSS variables
- Fix: approval panel dashed border and label color now use CSS variables, black in light mode
- Fix: chat input bar background dark overlay in light mode → white
- Fix: Write/Bash tool detail text hardcoded #c9d1d9 → var(--text-primary)
- Fix: sticky bottom button background dark in light mode → white translucent
- Fix: chat-boxer hover gradient too dark in light mode — lighter values + direction flipped
- UI: .chat-md inline code color uses blue (#0969DA) in light mode

## 1.6.113 (2026-04-07)

- Feat: light theme (Standard White) — full CSS variable system with `[data-theme]` switching
- Feat: all 31 component CSS modules converted to CSS variables (backgrounds, borders, text colors)
- Feat: Ant Design ConfigProvider switches between darkAlgorithm / defaultAlgorithm based on theme
- Feat: CodeMirror light theme with custom HighlightStyle for file content viewer
- Feat: xterm terminal light theme with ANSI 16-color palette
- Feat: react-json-view-lite conditionally uses lightStyles / darkStyles
- Feat: teammate SVGs adapted for both dark and light backgrounds
- Feat: global.css root CSS variables define ~50 semantic color tokens for dark/light themes
- UI: all inline styles in JSX converted to CSS variable references

## 1.6.112 (2026-04-06)

- Fix: ExitPlanMode approval status not updating after permission denial — status stayed "pending" with buttons visible
- Fix: Ultraplan scenario properly detected — shows "Ultraplan Executing" status with lightning icon instead of stuck "pending"
- UI: plan header text now dynamic — "计划就绪，等待审批" when pending, "计划审批" when resolved
- i18n: added ui.planUltraplan / ui.exitPlanModeResolved keys (18 languages)

## 1.6.111 (2026-04-06)

- Feat: theme color selector in preferences — dropdown with "Standard Dark" / "Standard Light", persisted via /api/preferences
- Feat: mobile settings panel also supports theme color selection
- Fix: ExitPlanMode approval not updating without page refresh — added _planDirty counter for planApprovalMap cache invalidation (same pattern as _askDirty)
- i18n: added ui.themeColor / ui.themeColor.dark / ui.themeColor.light keys (18 languages)

## 1.6.110 (2026-04-06)

- Feat: git diff image preview — image files show inline preview with click-to-zoom lightbox
- UI: dropdown menu and submenu border (1px solid #3a3a3a) with 4px border-radius
- UI: footer background #000 → #1e1e1e, border-top color adjusted
- UI: sticky bottom button moved to right side on desktop, stays left on mobile

## 1.6.109 (2026-04-06)

- Fix: AskUserQuestion "Other" submit stuck — localAskAnswers state change now triggers Last Response rebuild
- Fix: align transient filter condition between AppBase timestamp accumulation and sessionMerge
- Fix: tighten plan file regex to prevent false positives on unrelated paths containing "plans"
- Fix: mergedAskAnswerMap cache invalidation — added dirty counter for incremental AskUserQuestion updates
- Test: added 4 boundary edge cases for incremental merge (empty messages, exact-length, threshold boundary, null timestamp)

## 1.6.108 (2026-04-06)

- Perf: incremental chat rendering — session.messages uses push instead of full array replacement, keeping WeakMap cache stable
- Perf: ChatView smart reset — only resets incremental state when session objects actually change, not on every shallow copy
- Perf: targeted lastPendingAskId/PlanId delivery — only the matching ChatMessage receives the ID, eliminating cascade re-renders
- Perf: cached mergedAskAnswerMap reference — avoids new object creation per render cycle
- Fix: historical log timestamps — added transient protection in batch loading to prevent timestamps[] reset by short intermediate entries
- Fix: plan preview missing when plan file updated via Edit tool (was only tracked for Write)
- Fix: ipinfo geolocation — added 5s timeout, fail/timeout hides flag instead of showing default

## 1.6.107 (2026-04-06)

- Feat: ToolApprovalPanel exit animation (slideDown on dismiss)

## 1.6.106 (2026-04-05)

- Feat: unified mobile layout — Android now matches iOS with chat as main panel, terminal as overlay
- Fix: iOS diff view font size inconsistency caused by Safari text auto-sizing under zoom

## 1.6.105 (2026-04-05)

- Feat: custom shortcuts entry in Agent Team popover and mobile `+` menu, opens preset management modal
- Feat: PresetModal standalone component for mobile preset management with full CRUD and drag-drop
- Feat: preset state sync via `ccv-presets-changed` event between PresetModal, TerminalPanel, and ChatView
- Fix: mobile sticky-bottom scroll broken when Last Response appears/disappears (Virtuoso footer height change)
- Fix: mobile ToolApprovalPanel full border-radius with 16px bottom spacing (was half-round flush to bottom)
- Fix: preset input/textarea responsive width `min(600px, 80vw)` for mobile
- Fix: mobile ChatInputBar background transparent to match chat area
- Style: ChatMessage simplified tool popover refactored from global CSS to inline + scoped styles
- Chore: removed footer contact link and orphaned i18n key

## 1.6.104 (2026-04-05)

- Feat: animated dashed border on ToolApprovalPanel (yellow), AskUserQuestion (blue), Plan approval (blue)
- Feat: ToolApprovalPanel keyboard support — auto-focus Allow button, Tab/Shift+Tab cycle, Escape to deny
- Feat: focus restore — approval panel returns focus to previous element on close
- Style: focus-visible outline for approval buttons, optionDesc color in interactive questions

## 1.6.103 (2026-04-05)

- Feat: terminal pending file tag strip — uploaded files shown as tags/thumbnails above toolbar, multi-device sync
- Feat: terminal Enter key auto-injects pending file paths into PTY, skips alternate screen (vim/less)
- Fix: git restore untracked files — use `git clean -fd` instead of `git checkout` for `??` status files
- Fix: git status path decoding — handle octal escapes and quoted paths for non-ASCII filenames
- Fix: terminal scroll position reset — save/restore viewport scroll around `fitAddon.fit()` with proportional ratio
- Fix: perm-bridge bypass mode hook error — use explicit `allow` + `exit(0)` instead of `exit(1)` fallback
- Style: DetailPanel remove hardcoded background, JsonViewer background unified to `#111`

## 1.6.99 (2026-04-05)

- Fix: git commit/push and npm publish force Web UI approval even in `--d` (bypass permissions) mode

## 1.6.98 (2026-04-05)

- Feat: global settings log directory config — runtime `setLogDir()` with preferences UI, dynamic `getPrefsFile()`/`getPluginsDir()`/`getWorkspacesFile()`
- Feat: GlobalSettings concept doc (?) — 13-section configuration reference in 18 languages
- Feat: perm-bridge merge git/npm guard — eliminate Bash matcher hook conflict, `ensureHooks()` auto-cleanup
- Feat: WebFetch/WebSearch added to APPROVAL_TOOLS — external access tools now require Web UI approval
- Feat: explicit allow for non-APPROVAL_TOOLS — prevent Claude Code terminal fallback for safe tools
- Feat: approval panel positioned inside chat area — `position: absolute` relative to `messageListWrap`, dynamic width
- Fix: 7 `apiUrl()` omissions fixed — FileExplorer, ChatView, ChatMessage, FileContentView, GitDiffView, ConceptHelp
- Fix: `setLogDir()` path traversal protection — restrict to `homedir()` or `/tmp/`
- Fix: ES module live binding — `workspace-registry.js` and `plugin-loader.js` use getter functions for `LOG_DIR`-derived paths
- Test: 7 git guard tests (3 deny + 4 pass-through), plugin-loader test updated for `getPluginsDir()`

## 1.6.97 (2026-04-04)

- Feat: terminal-chat image awareness bridge — `pendingImages` state with preview strip (thumbnails for images, file chips for non-images)
- Feat: chat textarea image paste support — clipboard image paste uploads and adds to preview
- Feat: multi-device file upload/remove sync via WS `image-upload-notify` / `image-remove-notify`
- Feat: deferred path injection — file paths not inserted into textarea, prepended at send time from `pendingImages`
- Fix: PTY prompt detection — allow trailing hint lines (e.g. "Enter to confirm") in both numbered and cursor option patterns
- Fix: ConceptHelp event isolation — triple stop propagation (click/mousedown/pointerdown) prevents parent handler triggers
- Fix: ImageLightbox zoom sensitivity — scroll factor reduced from 15% to 6% per tick
- Fix: Last Response divider — dashed line via `::before`/`::after` pseudo-elements
- Fix: mobile image preview broken — use `apiUrl()` for LAN token authentication on thumbnail URLs
- Fix: terminal upload skip `pendingImages` on receiving device to prevent double-send
- Security: server-side path validation for `image-upload-notify`/`image-remove-notify` — reject `..` traversal, restrict to upload directories
- Security: send-time path sanitization — strip `"` from image paths before quoting

## 1.6.96 (2026-04-04)

- Feat: multi-device approval sync — broadcast `*-resolved` messages when permission/plan/ask is answered on one device
- Feat: PTY ask-hook cross-device sync — add `ask-hook-resolved` broadcast and handler
- Fix: conditional broadcast — only send `perm-hook-resolved` when an answer was actually processed
- Fix: SDK ask submit null guard — prevent sending `id: null` when another device already answered
- Fix: SDK perm-hook path `msg.id` guard for robustness

## 1.6.95 (2026-04-04)

- Fix: Last Response rendering vs stick-to-bottom race — lock scroll handler during startRender DOM transition
- Fix: scrollToBottom uses stickyBottom snapshot to prevent state race during content batch updates
- Fix: mobile Virtuoso `atBottomStateChange` guarded by scroll lock to prevent stickyBottom flip during Footer rendering
- Fix: mobile Footer (Last Response) scroll — rAF to scroll past Virtuoso LAST index to actual container bottom
- Refactor: perm-bridge whitelist inversion — only Bash/Edit/Write/NotebookEdit require approval, all other tools auto-pass
- Refactor: SDK mode canUseTool applies same APPROVAL_TOOLS filter, read-only tools no longer show approval UI
- Security: move toolName/toolInput guard before APPROVAL_TOOLS check as defensive measure
- Test: add 32 perm-bridge unit tests covering APPROVAL_TOOLS filtering, bypass mode, and server approval flow

## 1.6.94 (2026-04-04)

- Feat: Agent SDK integration — new `lib/sdk-adapter.js` and `lib/sdk-manager.js` for running Claude via Agent SDK without PTY
- Feat: SDK mode plan approval — ExitPlanMode review via WebSocket canUseTool callback
- Feat: SDK mode AskUserQuestion — structured answer submission through WebSocket
- Feat: "Allow for session" button in tool approval panel for session-level permission grant
- Feat: mobile global permission/plan approval overlay (fixed positioning outside transform context)
- Feat: mobile AskUserQuestion responsive CSS (larger touch targets)
- Refactor: rename `ensureAskHook` → `ensureHooks`, expand perm-bridge matcher to all tools with legacy cleanup
- Fix: AskUserQuestion dedup — prevent duplicate rendering between message history and Last Response
- Fix: hide terminal panel and toggle in SDK mode
- Dep: add `@anthropic-ai/claude-agent-sdk` as optionalDependencies

## 1.6.93 (2026-04-03)

- Feat: tool permission approval panel — floating overlay above chat input for Bash/Write/Edit/NotebookEdit approval via PreToolUse hook bridge
- Feat: open HTML/HTM files in browser via file-raw API with CSP sandbox protection
- Feat: open Office files (doc/xlsx/ppt/pdf etc.) with system default application
- Feat: /api/open-file endpoint for launching local files with OS default app
- Feat: /api/perm-hook endpoint with long-poll + WebSocket for permission bridge
- Security: add Content-Security-Policy: sandbox header when serving HTML files to prevent same-origin XSS
- Security: require strict ID matching for perm-hook-answer WebSocket messages
- Fix: clear pending permission state on WebSocket disconnect to prevent stale approval panel

## 1.6.92 (2026-04-03)

- Fix: hide empty "Last Response" section when filtered content has no visible blocks
- Fix: debounce streaming spinner hide by 2s to prevent flickering during tool call gaps
- Fix: cancel spinner fade-out when streaming resumes mid-fade
- Fix: clear streaming debounce timer on SSE reconnect and local log switch to prevent race condition

## 1.6.91 (2026-04-03)

- Feat: add simplified tool display mode — tool calls collapse to compact tags by default, Edit/Write/Agent/TaskCreate/EnterPlanMode/ExitPlanMode/AskUserQuestion keep full display
- Feat: hover popover on simplified tags (desktop), click popover with zoom fix (mobile)
- Feat: "完整展示所有内容" toggle in settings (default OFF = simplified mode)
- Feat: gray "调用工具:" label before simplified tool tags, resets after full-display tools
- Fix: Write tool no longer truncates at 20 lines
- Fix: Agent/TaskCreate tool content no longer truncates at 200 chars

## 1.6.90 (2026-04-03)

- Fix: shell hook re-injection — use `ccv -logger` instead of `ccv` to prevent launching programming mode when claude is invoked

## 1.6.89 (2026-04-03)

- Fix: TeamDelete detection — treat missing tool_result as success (entry-slim clears messages, making tool_result unreachable)
- Fix: test suite hang — cleanup interceptor StatWatcher in stopViewer and streaming-state test teardown
- Fix: stopViewer — call closeAllConnections() before server.close() to prevent keep-alive connections blocking exit

## 1.6.88 (2026-04-03)

- Fix: delta reconstruction — skip orphaned inProgress entries to prevent accumulated message offset (align reconstructEntries/reconstructSegment with createIncrementalReconstructor)
- Fix: loadLocalLogFile — move entry-slim after reconstructEntries to prevent delta increment data loss
- Fix: v2.1.90+ native teammate name resolution — add raw prompt fallback for Agent-tool spawned sub-agents
- Fix: markdown image stretching — add height:auto to all markdown img CSS rules
- Docs: sync all 17 README translations with latest zh source
- Util: add extractCcVersion() for billing header version detection

## 1.6.87 (2026-04-02)

- Fix: tsToIndex cache invalidation — reset on filteredRequests change to prevent highlight offset
- Fix: scroll fade delay — defer scroll listener 500ms to avoid smooth scroll animation triggering premature fading
- Fix: highlight precise positioning — use visibleIdx instead of timestamp findIndex for same-timestamp messages
- Fix: ConceptHelp modal click propagation — use onMouseDown instead of onClick to prevent overriding mask close
- Style: userPromptNavList background (#111) and border-radius

## 1.6.86 (2026-04-02)

- Style: close button ghost style — remove border/background, show semi-transparent bg on hover (FileContentView, GitDiffView)
- Style: reduce hamburger menu font-size to 12px (keep padding unchanged)
- Fix: cache countdown only shown in raw/network mode, hidden in chat mode
- Fix: enable terminal snap lines in all modes (remove incorrect token-based CLI mode detection)
- Refactor: remove enableSnap dead code, simplify snap condition checks

## 1.6.85 (2026-04-02)

- UI: enlarge hamburger dropdown menu font (14px) and item padding (8px 12px)
- Refactor: remove !important from dropdown menu CSS, use doubled class selector for specificity

## 1.6.84 (2026-04-02)

- Fix: deduplicate startup port logs in CLI mode (server.js suppresses when cli.js prints)
- Fix: suppress HTTP proxy diagnostic log by default (gated behind CCV_DEBUG)

## 1.6.83 (2026-04-02)

- Fix: Shift+Enter in xterm terminal now inserts newline instead of submitting
  - Uses bracketed paste sequence to send literal LF to PTY
  - Graceful fallback when WebSocket is disconnected (does not swallow keypress)

## 1.6.82 (2026-04-02)

- Feature: Git Changes panel — hover actions + context menu
  - Hover file: "Open File" icon (jump to file browser with directory expand) + "Discard Changes" icon (git checkout with confirm)
  - Right-click file: Reveal in Explorer, Copy Path, Copy Relative Path
  - New API: `/api/git-restore` with conditional realpathSync (safe for deleted files)
- Feature: FileExplorer header + folder context menu — "Open in Terminal" + "New Folder"
  - New APIs: `/api/open-terminal` (macOS/Windows/Linux) + `/api/create-dir`
  - realpathSync protection on open-terminal
- Feature: FileExplorer header right-click menu (7 items for project root)
- Fix: resolve-path API supports empty path (returns project root)
- Fix: log manager "Open" button includes token for remote access via /api/local-url fallback
- UI: hamburger menu SVG replaces favicon.ico logo
- i18n: 5 new keys × 18 languages (newDir, openTerminal, gitChanges.openFile/restoreFile/restoreConfirm)

## 1.6.81 (2026-04-02)

- Feature: folder context menu — right-click directories for quick actions
  - "Reveal in Explorer", "New File", "Copy Path", "Copy Relative Path", "Rename", "Delete"
  - New API: `/api/create-file` with path validation and realpathSync protection
  - `/api/delete-file` now supports recursive directory deletion with `rmSync`
  - Protected directories: node_modules, .git, .svn, .hg (checked at any path depth)
  - Control character validation for new file names (NUL bytes, etc.)
  - Delete confirmation uses stronger warning for directories ("and all its contents")
  - i18n: 2 new keys × 18 languages (newFile, deleteDirConfirm)
- Fix: refreshTrigger now cascades to expanded TreeNodes for proper child refresh
- Docs: CONTRIBUTING.md adds distillation permission statement

## 1.6.80 (2026-04-02)

- Feature: file context menu — right-click files in File Explorer for quick actions
  - "Reveal in Explorer" — open system file manager and select the file (macOS/Windows/Linux)
  - "Copy Path" / "Copy Relative Path" — copy to clipboard
  - "Rename" — enter inline edit mode (same as double-click)
  - "Delete" — with confirmation dialog, file-only (not directories)
  - New APIs: `/api/delete-file`, `/api/reveal-file`, `/api/resolve-path`
  - Security: realpathSync symlink traversal protection on delete/reveal
  - i18n: 6 new keys × 18 languages
- Feature: auto-refresh open file content when Claude edits it via Edit/Write tools
  - Detects tool_use file_path matching the currently viewed file
  - 500ms debounce, endsWith fallback for path matching robustness
- Docs: CLAUDE.md clarifies separate frontend/server i18n files
- Docs: CONTRIBUTING.md adds distillation permission statement

## 1.6.79 (2026-04-01)

- Fix: AskUserQuestion hook 5-min delay on Node.js v24+ (#44)
  - Replace `req.on('close')` with `res.on('close')` in `/api/ask-hook` long-poll endpoint
  - Node.js v24+ fires `req` close immediately after body read; `res` close fires on actual disconnect

## 1.6.78 (2026-04-01)

- Feature: print all LAN IP addresses on startup (Vite-style multi-line output)
  - New `getAllLocalIps()` returns all non-internal IPv4 addresses
  - Console output now shows Local + all Network addresses with access token
  - CLI mode and Workspace mode both display the same format
  - i18n: `server.startedLocal` / `server.startedNetwork` keys (18 languages)

## 1.6.76 (2026-04-01)

- Refactor: CSS color consolidation — 203 unique colors reduced to 102 (-49%)
  - Unified all rgba/rgb/named colors to hex format
  - Merged near-duplicate grays, blues, reds, greens, yellows across 36 CSS files
  - Extracted 15 inline styles from JSX to CSS modules
  - Standardized blue-gray background palette (16 shades → 6)
- Feature: PC terminal hint in chat input bar (18 languages)
- Fix: inline styles extracted to CSS classes (ChatView, AppHeader, ChatMessage, RequestList, Mobile, App, DetailPanel, WorkspaceList)

## 1.6.75 (2026-03-31)

- Feature: Proxy Hot-Switch — dynamically switch API proxy (URL + API Key + Model) without restarting Claude Code
  - interceptor.js: profile loading via `fs.watchFile`, URL/Auth/Model rewrite before `_originalFetch`
  - server.js: GET/POST `/api/proxy-profiles` API, SSE `proxy_profile` broadcast, apiKey mask in responses
  - UI: logo menu entry, gray badge tag, Modal with profile list + inline edit form
  - Default profile captures startup config (origin, authType, apiKey, model) for restore
  - Auto-match: if startup config matches a configured proxy profile, auto-select it
  - Config stored at `~/.claude/cc-viewer/profile.json` (mode 0o600)
  - ConceptHelp (?) doc for ProxySwitch (18 languages)
  - Required field validation, warning banner for Max subscribers
  - i18n: 16 new keys × 18 languages
- Feature: dynamic document.title — shows project name instead of static "Claude Code Viewer"

## 1.6.74 (2026-03-31)

- Fix: rejected AskUserQuestion rendered as interactive form — mark `__rejected__` in askAnswerMap to prevent pending state
- Fix: AskUserQuestion submit stuck on "提交中..." — local answer map for Last Response immediate UI transition
- UI: favicon, AppHeader, CSS, i18n polish

## 1.6.73 (2026-03-31)

- Feature: role filter interaction redesign — default unselected (show all), click to select (show selected only), close funnel resets
- Feature: ConceptHelp (?) for Teammate stats, Request Body fields, Response Body fields
- Feature: ConceptHelp modal width 800px, markdown styles aligned with FileContentView
- Feature: mobile input hint — "如果遇到流程阻塞，切换到[终端]模式审批权限" (18 languages)
- Fix: Ant Design focus outline removed via controlOutline token + global CSS
- Fix: mobile tap highlight removed (-webkit-tap-highlight-color: transparent)
- Fix: footer starRequest text removed
- Docs: removed "cc-viewer 中的意义" section from all concept docs (18 languages × 30+ files)
- Docs: added Teammate, BodyFields, ResponseFields concept docs (18 languages)
- Docs: updated KVCacheContent — corrected cache key order (Tools → System Prompt → Messages), added multi-level caching strategy

## 1.6.72 (2026-03-30)

- Fix: Mermaid SVG text invisible — DOMPurify sanitize config now uses `svg` profile with `style`/`foreignObject` tags allowed

## 1.6.71 (2026-03-30)

- Feature: Mermaid diagram rendering in markdown — `\`\`\`mermaid` code blocks auto-rendered as SVG charts
- Uses global MutationObserver with lazy-loaded mermaid.js (~460KB code-split chunk, loaded on first encounter)
- SVG output sanitized via DOMPurify for defense-in-depth security
- Dark theme with consistent styling, graceful fallback to raw code on render failure

## 1.6.70 (2026-03-30)

- Fix: Opus model defaults to 1M context — removed obsolete "Opus 4.6" (200K) and "Sonnet 4.6 (1M)" calibration options
- Fix: auto mode context bar now correctly identifies Opus as 1M across all code paths (readModelContextSize, getContextSizeForModel, getModelMaxTokens)
- Fix: localStorage graceful degradation — stale calibration values from removed options fall back to "Auto" on upgrade

## 1.6.69 (2026-03-30)

- Feature: sidebar user prompt navigation — hover user avatar icon to browse all user messages, click to scroll and highlight with blue dashed border animation
- Feature: navigation list supports legacy messages (no timestamp) from previous log slices
- Fix: `highlightIdx` now computed from `visible.findIndex()` instead of `_tsItemMap`, fixing highlight offset when role filter is active
- Fix: image markers (`[Image...]`, quoted upload paths) stripped from navigation list display text
- Fix: navigation list cached per `visible` reference to avoid re-computation on every render

## 1.6.68 (2026-03-30)

- Feature: `+` button rotates to `×` with animation when menu opens (ChatInputBar)
- Feature: mobile input area scaled x1.3 — textarea, buttons, menu items, fonts all proportionally enlarged
- Feature: user messages with quoted image paths (`"/tmp/cc-viewer-uploads/..."`) now render as inline images with fallback
- Fix: user message `&quot;` rendering — removed `escapeHtml` + `dangerouslySetInnerHTML` anti-pattern, replaced with safe React JSX children
- Fix: `.sendBtn svg` height mismatch in mobile (was 18px, now 23px matching width)
- Security: `/api/file-raw` path traversal protection — `resolve()` result validated with `startsWith` for both upload and persist directories

## 1.6.67 (2026-03-30)

- Feature: Last Response hides tool_use blocks (Bash, Read, Edit, etc.) — only text, thinking, and interactive cards (AskUserQuestion / ExitPlanMode) are shown, reducing screen clutter
- Fix: hook bridge retry — `_askHookActive` no longer cleared immediately after submit, allowing users to retry via hook bridge path after 30s button recovery
- Fix: SubAgent / Teammate stats cards now have consistent spacing (modelCardSpaced)
- Fix: `.overlayPanel` z-index raised to 20, ensuring code detail / git diff / image preview panels appear above the sticky-bottom button
- Style: `.bubble` border #222→#333; `.bubbleUser` border-color #499ae1, hover #59aaf1 + color #fff
- Style: `.toolBox` border #2a2a3e→#3a3a4e, hover #4a4a5e; `.chat-boxer` added border #555 + box-sizing + hover gradient
- Style: `.chat-md code` color #9597eb→#aeafff; `.bubblePlan` hover isolation (no hover effect on 5px blue border)
- Docs: ToolsFirst.md — added "Why tools before brain" (cognitive analogy) and "MCP tools position" (pros/cons/recommendations) sections in all 18 languages

## 1.6.66 (2026-03-30)

- Fix: iOS mobile chat panel height — `mobileCLIBody` missing `display: flex; flex-direction: column`, causing chat area to collapse instead of filling available height

## 1.6.65 (2026-03-30)

- Fix: AskUserQuestion submit from chat panel — resolve timing race where streaming response renders interactive card before PreToolUse hook bridge is ready, causing submit button to hang in "submitting" state
- Fix: add hook bridge wait mechanism (up to 3s polling) before falling back to PTY simulation path
- Fix: `_submitViaHookBridge` fallback now directly calls PTY path, avoiding unnecessary 3s delay on WS reconnect race
- Fix: submit button auto-recovers after 30s timeout to prevent permanent "submitting" lock
- Fix: `_waitForHookBridge` guarded against unmounted component state updates
- Fix: duplicate submission prevented by setting `_askSubmitting` before hook bridge wait

## 1.6.64 (2026-03-30)

- Feature: mobile SSE pagination — initial load limited to latest 200 entries (checkpoint-aligned), history loaded on-demand in 100-entry batches via `/api/entries/page` REST endpoint
- Feature: session-level hot/cold memory management — mobile keeps only 8 recent sessions in memory (~5-10MB), older sessions stored per-session in IndexedDB with placeholder UI for on-demand loading
- Feature: "Load earlier conversations" button at chat top + cold session placeholders with one-click restore
- Perf: entry-slim now processes delta-format entries after reconstruction (previously skipped, causing ~60-70% redundant memory)
- Perf: server `streamRawEntriesAsync` supports `limit` parameter with checkpoint boundary alignment
- Fix: `streaming_status` SSE event never sent due to `clients.size` (Set property) used on Array — changed to `clients.length`
- Fix: SSE heartbeat timeout protection — all named SSE events now reset the 45s heartbeat timer
- Fix: SSE reconnect saves partial loaded entries to cache for incremental recovery
- Fix: mobile cache restore now applies hot/cold splitting (prevents full dataset from loading into memory)
- Fix: incremental SSE mode preserves `hasMoreHistory` state from cache instead of overwriting
- i18n: added `loadEarlierConversations`, `loadingMoreHistory`, `allConversationsLoaded`, `loadSessionPlaceholder` for 18 languages
- Test: added 20 pagination tests (limit, checkpoint alignment, readPagedEntries), 22 session manager tests, 14 SSE heartbeat tests

## 1.6.63 (2026-03-30)

- Feature: streaming state tracking — real-time SSE broadcast of Claude API streaming status
- Feature: SVG streaming border animation on chat input (5-layer gradient trail, mobile + desktop)
- Feature: loading spinner in message list during streaming (Virtuoso footer + desktop)
- Feature: Agent Team preset menu in chat input (+) button — fill textarea for review before send
- Feature: iOS mobile panel swap — chat as primary, terminal as overlay (iOS Safari compatibility)
- Fix: `resetStreamingState()` infinite recursion bug — function called itself instead of resetting fields
- Fix: Virtuoso Footer not re-rendering — use context prop pattern instead of cached closures
- Fix: mobile chat not scrolling to bottom on initial load — add `initialTopMostItemIndex`
- Fix: permission check prompts ("Do you want to make this edit?") now reliably detected and rendered as approval cards in chat
- Fix: `isDangerousOperationPrompt()` classifier missed the most common edit/write/create/delete permission patterns
- Fix: `isDangerousOperationPrompt()` options check failed to match standalone "No" (regex boundary bug)
- Fix: `_detectPrompt()` Pattern 2 required cursor marker `❯` on first option line — now supports cursor on any line
- Fix: trailing newlines in PTY buffer broke prompt detection `$` anchor — now trimmed before matching
- Cleanup: remove PtyPromptBubbles component (unused after permission checks handled by ChatMessage)
- Test: add 25 permission prompt detection test cases covering real-world CLI variations

## 1.6.62 (2026-03-29)

- Feature: add `--ad` shortcut for `--allow-dangerously-skip-permissions` (adds bypass mode to Shift+Tab cycle without activating)
- Keep existing `--d` shortcut for `--dangerously-skip-permissions` unchanged

## 1.6.61 (2026-03-29)

- Feature: image lightbox — click chat images to preview in overlay instead of opening new tab
- Supports PC (wheel zoom, drag pan, double-click toggle) and mobile (pinch-to-zoom, single-finger pan, tap-to-close)
- Auto-fit large images to viewport, fade-in/out animation, loading spinner, error state
- Covers user message images (ChatImage) and markdown-rendered images (.chat-md img) via event delegation
- iOS safe area inset support, a11y dialog role, scrollbar-gutter stability
- i18n: added `ui.imageLightbox.close` for 18 languages

## 1.6.60 (2026-03-29)

- Feature: mobile incremental SSE loading — server supports `since` filter, client Map-based dedup merge with empty delta short-circuit
- Feature: ChatView mobile virtualization via react-virtuoso — reduces DOM nodes from ~24000 to ~2000
- Perf: `_processEntries` merges 4 O(n) full-array passes into single loop (timestamp assignment + session building + filtering + index rebuild)
- Perf: `load_chunk` setState throttled via requestAnimationFrame (500×/s → ~60×/s)
- Perf: ChatMessage `shouldComponentUpdate` with stable prop references (EMPTY_OBJ/EMPTY_MAP constants)
- Perf: ChatImage `loading="lazy"` + `decoding="async"` for offscreen images
- UI: ChatInputBar redesigned with "+" menu, file upload, click-outside-to-close overlay
- UI: mobile-only enlarged input controls via `@media (max-width: 768px)`
- Fix: mobile `cliMode` prop passed correctly to ChatView
- Fix: mobile file explorer defaults to closed
- Fix: CJK IME input guard (`isComposing` + keyCode 229) prevents premature Enter send

## 1.6.59 (2026-03-29)

- Feature: auto-inject AskUserQuestion PreToolUse hook into `~/.claude/settings.json` on CLI startup (`ensureAskHook`)
- Feature: intercept consecutive Ctrl+C in web terminal — block second press within 2s and show i18n toast reminder
- Feature: preset send uses bracket paste mode (`ESC[200~...ESC[201~`) for single-block paste/delete UX
- Feature: add "Scout Regiment" (调查兵团) as built-in Agent Team preset with 18 language translations
- Refactor: update Code Reviewer / Code Reviewer Pro preset descriptions to semicolon+newline format (all 18 languages)
- Remove: ultrathink button and i18n key from TerminalPanel toolbar
- Fix: ensureAskHook skips write on malformed settings.json to avoid overwriting user config

## 1.6.58 (2026-03-29)

- Fix: React hooks order violation in TeamModal — move early return after all hooks to prevent "Rendered more hooks than during the previous render" error (#310)

## 1.6.57 (2026-03-29)

- Refactor: split ChatView.jsx (2562 lines) into 4 isolated components — TeamSessionPanel, SnapLineOverlay, RoleFilterBar, ChatInputBar — each with its own CSS module
- Feature: plan approval buttons show "Submitting..." state after click, with proper reset on plan change
- Fix: PTY prompt false positive filters — skip file paths and Claude Code status-bar output in `_detectPrompt()`
- Style: inline code color changed to #9597eb for better visibility; table border lightened to #777; table body background darkened to #000
- Cleanup: remove 3 unused imports from ChatView.jsx (extractToolResultText, parseAskAnswerText, parsePlanApproval)

## 1.6.55 (2026-03-29)

- Feature: PreToolUse hook bridge for AskUserQuestion — bypass PTY keyboard simulation with structured JSON answers via `lib/ask-bridge.js`
- Feature: `/api/ask-hook` long-poll HTTP endpoint — bridges hook script with cc-viewer web UI for AskUserQuestion
- Feature: `ask-hook-answer` WebSocket message type — routes user answers from web UI to hook bridge
- Feature: `CCVIEWER_PORT` environment variable passed to PTY child process for hook bridge discovery
- Feature: graceful fallback — if hook not configured or cc-viewer unreachable, falls back to existing PTY simulation

## 1.6.54 (2026-03-28)

- Feature: Plan approval GUI — display plan content preview and interactive Approve/Edit/Reject buttons in conversation view (ExitPlanMode)
- Feature: Dangerous operation approval GUI — amber-colored approval card for CLI permission prompts (Bash/Edit/Write) with Allow/Deny buttons
- Feature: Permission denied detection — tool_result with `is_error` and rejection text shown as red "Denied" badge with original text
- Fix: multi-select Other (Type something) submission — use ↑ instead of ↓ to exit text input mode, add isMultiQuestion condition for Enter
- Fix: sub-agent React key collision — add requestIndex to key for same-timestamp messages
- i18n: add planApproveWithEdits, dangerApproval, dangerDenied keys (18 languages)
- Robustness: null safety guards for isPlanApprovalPrompt, isDangerousOperationPrompt, planOptions, opt.text, renderDangerApproval
- Robustness: _promptSubmitting debounce to prevent double-click on approval buttons
- Robustness: reset latestPlanContent after plan approval to prevent cross-cycle content leak

## 1.6.49 (2026-03-28)

- Refactor: separate Mobile/PC entry points with AppBase class inheritance — split App.jsx (2202 lines) into AppBase.jsx (shared), App.jsx (PC), Mobile.jsx (mobile) with dynamic import code splitting
- Fix(mobile): prevent teammate requests from polluting subAgent statistics in MobileStats — merged redundant loops, matching PC-side AppHeader.jsx logic

## 1.6.48 (2026-03-28)

- Fix(mobile): hide left navSidebar in chat view on mobile for more screen space

## 1.6.47 (2026-03-28)

- Feature(mobile): add Agent Team presets to mobile virtual keyboard bar — flattened inline buttons instead of popover
- Fix(mobile): prevent system keyboard popup when tapping Agent Team preset or enable buttons (add isMobile guard to terminal.focus)
- Refactor: generalize _vkTouchEnd to accept callback, eliminating touch handler duplication
- Style: add vkSeparator, vkAction, vkTeamPreset, vkDisabled CSS classes for mobile keyboard bar

## 1.6.44 (2026-03-27)

- Fix: teammate fallback rendering now works — noData guard checks allItems to avoid Empty blocking fallback content
- Fix: remove redundant Divider if/else branch in teammate fallback

## 1.6.43 (2026-03-27)

- Fix: eliminate ChatView initialization flickering — delay SSE client broadcast registration until historical load completes (server.js)
- Fix: entry-slim clone before mutation — prevent React state shared-reference corruption causing message flash-blank
- Fix: suppress "暂无对话" Empty flash during SSE loading via fileLoading prop guard
- Fix: lower transient request filter threshold from >10 to >4, protecting early conversations (5-10 messages) from transient flicker; synchronized across 4 code locations
- Feature: teammate fallback rendering — display teammate conversation history when MainAgent sessions are empty (e.g. truncated JSONL)
- Feature: OpenFolderIcon component for file explorer and log management
- Feature: open-project-dir API endpoint and file explorer integration
- Fix: timeline gantt indicator height covers all agent rows when scrolled (scrollHeight-based)
- i18n: add ui.openProjectDir entries for all 18 languages

## 1.6.40 (2026-03-26)

- Feature: incremental entry-slim for realtime SSE — reduces browser memory O(N²) → O(N) for long sessions (behind `ccv_sseSlim` localStorage flag)
- Feature: terminal toggle button — collapsible arrow at chat/terminal boundary for quick show/hide
- Feature: built-in preset shortcuts for Agent Team (Code Reviewer / Code Reviewer Pro) with i18n support, user edits preserved across updates
- Fix: `restoreSlimmedEntry` defensive check when fullEntry has fewer messages than expected
- Fix: cacheLoss analysis now restores slimmed prevMainAgent before comparison
- Test: add 11 unit tests for `createIncrementalSlimmer` and `restoreSlimmedEntry`

## 1.6.38 (2026-03-25)

- Feature: markdown preview toggle for file browser — `.md` files default to rendered markdown view with text/editor switch button
- Feature: role filter chips now display the same avatars as conversation messages (user profile photo, model-specific SVG)
- Security: add DOMPurify sanitization to all markdown rendering (renderMarkdown)
- Style: add margin-bottom to tool result plainResult cards
- i18n: add ui.viewMarkdown / ui.viewText entries for all 18 languages

## 1.6.35 (2026-03-24)

- Feature: keyboard arrow up/down navigation in request list (network view)

## 1.6.34 (2026-03-24)

- Remove: translate feature (server /api/translate endpoint, TranslateTag component, translator.js)
- Style: footer align left

## 1.6.33 (2026-03-24)

- Fix: eliminate server-side OOM on large JSONL files — server no longer reconstructs delta entries, sends raw delta via streaming SSE; client reconstructs locally
- Feature: /api/local-log returns independent SSE stream (isolated from CLI /events), preventing mode confusion between logfile browsing and CLI mode
- Perf: chunked file reading (1MB blocks via generator) replaces readFileSync for all log reading paths
- Perf: restore MAX_LOG_SIZE from 150MB back to 250MB (now safe with streaming architecture)
- Style: refine diff view, tool result, and chat bubble colors/borders/hover states
- Style: remove redundant tool result outer labels (tr.label) from chat messages

## 1.6.32 (2026-03-24)

- Fix: reduce MAX_LOG_SIZE from 250MB to 150MB to lower OOM risk with delta-compressed logs
- Fix: filter out quota-check requests (max_tokens=1, no system, no tools) from request list
- Style: remove flex:1 from chat message contentCol

## 1.6.26 (2026-03-23)

- Perf: fix AppHeader per-frame re-render — countdown rAF now only setState when text changes (~60/s → ~1/s)
- Feature: Agent Team button Popover with "Enable Now" button that sends config prompt to terminal
- Feature: "Enable Now" button shows loading state to prevent duplicate submission
- Fix: blood bar precise mode uses settings.json model for context size correction

## 1.6.25 (2026-03-23)

- Fix: resume popup repeatedly showing — auto-skip path now directly POSTs to server, avoiding setState race that cleared saved preferences
- Fix: blood bar context size — precise mode now uses settings.json model as fallback when statusLine detected size differs from configured model

## 1.6.24 (2026-03-23)

- Feature: clipboard image paste in terminal — paste images directly from clipboard when terminal is focused, auto-uploads and inserts file path
- Feature: Retina image downscale — clipboard images on HiDPI displays (devicePixelRatio > 1) are downscaled to 1x before upload to reduce file size
- Feature: upload failure toast — shows antd message.error with localized text when clipboard image upload fails
- Feature: model calibration selector — manual model selection in KV-Cache popover to calibrate context usage blood bar, with localStorage persistence
- Feature: Agent Team button — toolbar button for native Agent Team, enabled when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in claude settings
- Fix: file explorer scroll — clicking file path in git diff view now expands ancestor directories so file is visible and scrolled to
- Fix: global text selection color — unified to #264f78 (VS Code blue) across all views
- Security: /api/claude-settings endpoint now only exposes env field instead of full settings.json

## 1.6.22 (2026-03-23)

- Feature: native teammate detection — Agent tool sub-agents now display as "Teammate" instead of "SubAgent", with automatic name extraction from hook context and message content
- Fix: request list scroll position preserved when new requests arrive — no longer jumps to selected item on data update

## 1.6.21 (2026-03-23)

- Fix: user avatar fallback — when macOS system avatar is missing or broken, automatically falls back to default avatar instead of rendering a broken image

## 1.6.20 (2026-03-23)

- Fix: AskUserQuestion multi-question form `isMultiQuestion` flag — last question now correctly identified via stored flag instead of queue length
- Fix: AskUserQuestion multi-select "Other" option missing from UI — added to checkbox branch with text input support
- Fix: AskUserQuestion single-select Other in multi-question forms — added `isMultiQuestion` parameter for correct tab navigation
- Fix: AskUserQuestion multi-select Other PTY protocol — type text directly, exit with ↓, then → Enter to submit
- Fix: PTY delay strategy — ↑↓ arrows now use settleMs delay for reliable inquirer re-rendering
- UI: file browser & git changes selected item background color changed to #532f00
- UI: file detail / git diff / image viewer header padding adjusted to 6px
- UI: file detail panel slide-in animation (left to right, 250ms)
- UI: country flag emoji font size increased to 20px

## 1.6.19 (2026-03-22)

- Feature: SSE heartbeat keep-alive — server sends ping every 30s, client auto-reconnects on 45s timeout (up to 10 retries)
- Feature: KV-Cache token display retains last valid values to prevent flickering on transient zero-token states
- Feature: close button (×) added to file viewer and git diff viewer headers
- Feature: file size display moved next to file path in file viewer header
- Fix: resume auto-choice race condition — preferences now load before SSE resume_prompt is processed
- Fix: KV-Cache token stats no longer leak across requests in DetailPanel (keyed by request timestamp)
- Fix: AppHeader shouldComponentUpdate now includes serverCachedContent for proper SSE-driven re-renders
- Security: path traversal fix in /api/file-content and /api/file-raw — uses realpathSync containment to block ".." escape and symlink bypass
- Refactor: extract lib/log-management.js, lib/file-api.js, lib/translator.js, lib/plugin-manager.js from server.js (~350 lines reduction)

## 1.6.18 (2026-03-22)

- Feature: user preferences section in Display Settings — "Default log resume behavior" with master switch and continue/new radio options
- Feature: resume dialog "Remember my choice" checkbox — skip dialog next time with saved preference
- Fix: AppHeader shouldComponentUpdate now includes resumeAutoChoice for proper re-render

## 1.6.17 (2026-03-22)

- Feature: file browser inline rename — double-click or press Enter/F2 on selected file to edit name in-place
- Feature: clickable file paths in chat — Edit/Read/Write tool calls now have clickable file paths that open the file in the viewer
- Feature: auto-expand directory tree when opening a file from chat, with scroll-into-view for the selected item
- Fix: plan content display — plans wrapped in system-reminder tags are no longer filtered out; approved plans now render with the blue-bordered plan view instead of the approval status card
- Fix: xterm focus on mode switch now only activates when terminal is visible, in CLI mode, and not on mobile
- Security: /api/rename-file POST body size limited with MAX_POST_BODY; JSON parse errors return 400 instead of 500
- Fix: /api/project-dir fetch uses apiUrl() for LAN token compatibility

## 1.6.16 (2026-03-22)

- Feature: SubAgent requests now display KV-Cache-Text in network panel
- Fix: KV-Cache system prompt extraction now includes all cached blocks in the prefix (not only those with cache_control markers), matching Anthropic API prefix caching semantics
- Fix: AppHeader KV-Cache fallback path no longer picks teammate/SubAgent requests when multiple requests are present

## 1.6.15 (2026-03-22)

- Fix: MainAgent detection threshold lowered from >10 to >5 tools, compatible with v2.1.81+ lightweight MainAgent
- Fix: SubAgent incremental scan rewinds one entry to avoid misclassification when nextReq is missing
- Fix: AskUserQuestion prompt deduplication — active prompts matching Last Response question text are no longer displayed twice

## 1.6.14 (2026-03-21)

- Fix: KV-Cache system content display now only shows blocks that have `cache_control` themselves, filtering out non-cached metadata like `x-anthropic-billing-header`

## 1.6.13 (2026-03-21)

- Chore: bump version to 1.6.13

## 1.6.12 (2026-03-21)

- Feature: header displays country flag emoji based on network IP geolocation (via ipinfo.io); hover to see city, region, org, and IP; fallback to 🇨🇳 on request failure
- Feature: drag-and-drop file upload support
- Fix: full-chain real-time conversation refresh for main agent and teammates

## 1.6.11 (2026-03-20)

- Fix: full-chain real-time conversation refresh — teammate detection expanded to `--agent-name` (native team mode), metadata extraction no longer gated by `_isTeammate`
- Fix: teammate processes no longer trigger log rotation — only leader rotates
- Fix: `migrateConversationContext` truncates old file instead of deleting, preventing watcher `statSync` errors
- Fix: log-watcher truncation handler immediately checks `getLogFile()` for rotation and switches watcher
- Perf: `_reqScanCache` split into independent counters — `subAgentEntries` full-rescans on request changes without O(n²) on `tsToIndex`
- Perf: `appendToolResultMap` — hoist `split('\n')` out of loop to avoid O(L²)
- Perf: `isTeammate` WeakMap cache, `extractTeammateName` per-request cache

## 1.6.10 (2026-03-20)

- Feature: extract teammate name from SendMessage `tool_result` — `routing.sender` field provides reliable structured name, replacing fallback "X" display
- Fix: empty temp log files no longer renamed to permanent logs — empty files are deleted instead, preventing ghost sessions in file listing
- Fix: `migrateConversationContext` deletes empty old file after full migration instead of leaving 0-byte remnant
- Fix: server skips 0-byte log files in session listing API
- Fix: terminal cursor hidden to prevent stray blinking cursor in status bar area
- Fix: ChatView last response rendering cleanup
- Fix: AskQuestionForm — handle "Other" option from API natively, avoid duplicate "Other" entry; guard `questions` with `Array.isArray` check
- Fix: AskQuestionForm import path corrected to relative `../i18n`
- Fix: ptyChunkBuilder — remove extra Enter before typing text in "Other" input
- Fix: TerminalPanel cursor width restored to 1 for visibility
- Fix: resolveResumeChoice — always use new log path after rename
- Test: add teammate empty log filtering unit tests

## 1.6.8 (2026-03-19)

- Perf: `buildToolResultMap` — 4-pass full scan refactored to single-pass `appendToolResultMap` with WeakMap caching; historical sessions O(1), active session processes only new messages incrementally
- Perf: `buildAllItems` — 3 × O(n) full request scans merged into single incremental pass with instance-level cache (`tsToIndex`, `modelName`, `subAgentEntries`)
- Perf: `appendCacheLossMap` — cache loss analysis converted from full O(n) recompute to append-only incremental scan
- Perf: Last Response separated from `allItems` into independent state — main list updates are pure tail-appends, eliminating middle-insertion reflow during streaming
- Fix: SubAgent/Teammate requests not updating chat view when `mainAgentSessions` unchanged — added `requests` change detection in `componentDidUpdate`

## 1.6.6 (2026-03-19)

- Fix: guard null/undefined entries in `isRelevantRequest` — prevents `Cannot read properties of undefined (reading 'isHeartbeat')` crash during request filtering
- Fix: `selectedIndex` TDZ (Temporal Dead Zone) bug in `_flushPendingEntries` — variable was used before `let` declaration, causing `ReferenceError` when requests exceed 5000 cap, permanently freezing all state updates

## 1.6.0 (2026-03-18)

- Feature: Teammate display optimization — `Teammate: name(model)` format with dedicated team icon and per-name HSL color hashing
- Feature: AskQuestionForm extracted as standalone component — local state isolation eliminates parent re-render bottleneck during multi-select
- Feature: `ptyChunkBuilder.js` — pure functions for building PTY keystroke sequences (single/multi/other), separated from submission logic
- Feature: `writeToPtySequential()` server-side PTY write queue with per-chunk delay; `input-sequential` WebSocket message type
- Feature: multi-select PTY submission — → + Enter submit protocol, tab navigation for multi-question forms
- Feature: multi-question support — `_planSubmissionSteps()` annotates `isLast` flag; intermediate questions use → to switch tabs, last question uses → + Enter to submit
- Refactor: context window blood bar — cc-viewer no longer writes to `context-window.json`; reads `model.id` once at startup to cache 1M/200K size, computes usage from interceptor log
- Fix: Opus 4.6 1M context window detection — `readModelContextSize()` parses `[1m]` from `model.id`, `getContextSizeForModel()` maps API model names via cached base name
- Fix: `serverCachedContent` leak — `loadLocalLogFile()` clears stale server cache on local log switch
- Fix: removed `watchContextWindow` file polling — eliminates cross-process data pollution from teammates/other projects
- Docs: updated KVCacheContent concept docs across all 17 language versions

## 1.5.45 (2026-03-17)

- Fix: KV-Cache user prompt navigation — added SVG marching-ants dashed border animation on highlighted cache blocks (matching ChatMessage style)
- Fix: highlight timing — detect actual scroll completion via `scrollend` event + 500ms minimum delay, so animation appears after scroll settles instead of during
- Feature: raw mode cross-navigation — clicking user prompt nav in header popover now selects the MainAgent request, switches to KV-Cache-Text tab, and scrolls to the message with animation in DetailPanel
- Fix: DetailPanel performance — added `componentWillUnmount` timer cleanup, limited highlight state re-renders to kv-cache-text tab only, clear timers on request switch
- i18n: added `ui.userPromptNav` entries for all 18 supported languages, changed `ui.tokens` zh/zh-TW from "令牌" to "Token"

## 1.5.43 (2026-03-17)

- Fix: AskUserQuestion multi-question submit — replaced stale React state closure check with synchronous instance variable (`_currentPtyPrompt`) for reliable prompt detection across sequential question submissions

## 1.5.42 (2026-03-17)

- Feature: ultrathink button in PC terminal toolbar — writes `ultrathink ` command into terminal input without auto-submitting
- i18n: added `ui.terminal.ultrathink` entries for all 18 supported languages

## 1.5.41 (2026-03-17)

- Fix: AskUserQuestion single-select radio now clickable — replaced antd Radio.Group with custom div-based radio implementation
- Fix: AskUserQuestion interactive card renders in streaming "Last Response" — passes askAnswerMap, lastPendingAskId, onAskQuestionSubmit props
- Fix: CLI pre-answer detection — componentDidUpdate watches askAnswerMap changes to auto-replace interactive card with static answered card
- Fix: submit works without ptyPrompt — falls back to assuming first option selected (CLI default) when terminal prompt not detected
- Fix: mobile AskUserQuestion interactive — lazy WebSocket connect on submit, uses onAskQuestionSubmit gate instead of cliMode

## 1.5.40 (2026-03-16)

- Feature: log preview Popover — hover (desktop) or click (mobile) to see all user prompts in a floating panel
- Feature: mobile log table — timestamp hides year, shows `MM-DD HH:mm:ss` format
- Fix: preview column text overflow — maxWidth 600px with ellipsis for long prompts
- Fix: stats-worker prompt extraction rewritten to align with App.jsx/contentFilter.js logic (isSystemText, stripSystemTags, extractUserTexts)
- Fix: preview dedup — file-level Set dedup removes duplicate prompt text within same log file
- Fix: stats-worker STATS_VERSION 6→8, forces cache invalidation for re-parsing

## 1.5.39 (2026-03-16)

- Feature: AskUserQuestion interactive UI — pending questions render Radio/Checkbox controls with submit button in chat panel (single-select, multi-select, Other with text input, markdown preview layout)
- Fix: statusLine non-exclusive — no longer modifies user's `statusLine` in settings.json; context window data is now extracted from API response usage in the interceptor
- Fix: ExitPlanMode approval buttons now render immediately without waiting for PTY prompt detection; uses built-in default options as fallback
- i18n: added askSubmit, askSubmitting, askOther, askOtherPlaceholder entries for all 18 supported languages

## 1.5.37 (2026-03-16)

- Feature: plan approval UI — ExitPlanMode cards show approve/reject/feedback buttons with status badges; only the last pending card is interactive
- Feature: log table preview column — shows first user prompt from each conversation
- Feature: `/api/refresh-stats` endpoint — force re-scan all project stats with 30s timeout
- Feature: refresh stats button in import modal
- Fix: preview collection in stats-worker always-true condition — same-turn duplicate requests no longer produce duplicate previews
- Fix: plan feedback submission replaced fixed 300ms delay with polling (100ms intervals, max 2s) for reliable CLI mode detection
- i18n: added plan approval and refresh stats entries for all supported languages

## 1.5.34 (2026-03-15)

- Fix: chat panel repeatedly refreshing after restart — `watchLogFile()` now initializes `lastSize` to current file size instead of 0, preventing duplicate broadcast of historical entries already sent via `/events` load flow

## 1.5.32 (2026-03-14)

- Refactor: move proxy-errors.js and proxy-env.js into lib/ directory
- Fix: skip redundant interceptor setup when CCV_PROXY_MODE is set (prevents duplicate fetch patching in Claude subprocess)
- Chore: remove stale `locales/` entry from package.json files array

## 1.5.31 (2026-03-14)

- Feature: terminal toolbar with file upload button (PC only) — uploads file to server, writes quoted path to terminal/textarea
- Feature: upload button in chatInputBar when terminal is hidden
- Fix: SSE real-time updates broken after client disconnect (clients array reference was replaced instead of mutated in-place)
- Improve: upload API uses `apiUrl()` for token auth compatibility with LAN/QR access
- Improve: 50MB upload size limit enforced on both client and server
- Improve: unique filenames with timestamp suffix to prevent silent overwrite
- Add: test/upload-api.test.js (7 test cases)

## 1.5.30 (2026-03-14)

- Fix: QR code popover hardcoded 800px width — now auto-fits content

## 1.5.29 (2026-03-14)

- Feature: auto-refresh FileExplorer and GitChanges panels when Claude uses file-mutating tools (Write, Edit, Bash, NotebookEdit)
- Improve: footer bar top border for visual consistency with other toolbars
- Improve: unit test coverage from 68.98% → 71.23% line, 69.17% → 72.81% branch
- Add: test/git-diff.test.js, test/log-watcher.test.js, test/findcc.test.js, test/context-watcher.test.js
- Add: `npm run test:coverage` script for branch coverage reporting
- Improve: supplemented branch tests for proxy-errors, updater, stats-worker

## 1.5.27 (2026-03-13)

- Remove: inflight request detection and display (spinner, tooltip, popover) — feature no longer functional
- Fix: folder/git-changes sidebar buttons now toggle instead of always-open, and no longer close the file detail panel
- Fix: hardcoded `http://` protocol in process management port links and server URL parsing — now inherits from browser/server protocol

## 1.5.26 (2026-03-13)

- Feature: "当前项目" tag replaced with context usage health bar — shows real-time context window consumption with color transitions (green → yellow → red)
- Feature: statusLine integration — auto-installs wrapper script to capture `context_window.used_percentage` from Claude Code, pushed to frontend via SSE
- Feature: `getModelMaxTokens()` helper for model context window size mapping (Claude 200k, GPT-4o 128k, DeepSeek 128k, etc.)
- Fix: statusLine lifecycle — proper install/uninstall with original config preservation, cleanup on abnormal exit
- Fix: `ccv -uninstall` now cleans up statusLine config, ccv-statusline.sh script, and context-window.json
- Fix: `removeShellHook` now scans all shell config files (.zshrc, .zprofile, .bashrc, .bash_profile, .profile)

## 1.5.25 (2026-03-13)

- Feature: inject Claude process PID (`entry.pid`) into `onNewEntry` plugin hook — CLI mode uses PTY child PID, hook-injection mode uses `process.pid`
- Add: `getPtyPid()` export in pty-manager.js
- Improve: Context tab sidebar now supports keyboard navigation across visible items, including system prompt, history toggle, history turns, current turn, and tool entries
- Improve: Context sidebar interactive rows now use focusable controls with visible keyboard focus styling
- Note: auto-selecting the latest turn when `body/response` changes remains unchanged for now

## 1.5.24 (2026-03-13)

- Feature: "当前项目" tag replaced with context usage health bar — shows real-time context window consumption with color transitions (green → yellow → red)
- Feature: statusLine integration — auto-installs wrapper script to capture `context_window.used_percentage` from Claude Code, pushed to frontend via SSE
- Feature: `getModelMaxTokens()` helper for model context window size mapping (Claude 200k, GPT-4o 128k, DeepSeek 128k, etc.)
- Fix: statusLine lifecycle — proper install/uninstall with original config preservation, cleanup on abnormal exit
- Fix: `ccv -uninstall` now cleans up statusLine config, ccv-statusline.sh script, and context-window.json
- Fix: `removeShellHook` now scans all shell config files (.zshrc, .zprofile, .bashrc, .bash_profile, .profile)

## 1.5.23 (2026-03-13)

- Fix: `claude -v` / `claude --version` / `claude -h` no longer triggers ccv startup — passthrough flags now work correctly
- Fix: `installShellHook` now compares hook content instead of just mode, so outdated hooks are automatically replaced on `ccv -logger`

## 1.5.22 (2026-03-13)

- Feature: click file path in GitDiffView to open FileContentView and scroll to first changed line
- Fix: untracked files in Git Changes now show green "U" instead of raw "??"
- Enhancement: CodeMirror Find/Replace panel styled to match antd5 dark theme (no gradient, proper input/button sizing)
- Update: editor session banner text — clearer "click to return to Terminal" wording

## 1.5.21 (2026-03-13)

- Refactor: replace hardcoded HTTPS cert with plugin hook `httpsOptions` (waterfall)
- Enhancement: `serverStarted` hook now receives `{ port, host, url, ip, token }` (added `url`, `ip`, `token`)
- Fix: `/api/local-url` now respects actual server protocol (HTTP/HTTPS) instead of hardcoded `http://`
- Enhancement: AskUserQuestion renders selected answers with green checkmark SVG directly on assistant-side card
- Remove: separate user-selection bubble for AskUserQuestion (merged into assistant card)
- Fix: AskUserQuestion answer parsing — use regex instead of broken JSON.parse for `"q"="a"` format
- Enhancement: minimap overlay contrast and activeLine highlight improved

## 1.5.20 (2026-03-12)

- Fix: `proxy-errors.js` missing from npm package, causing `ERR_MODULE_NOT_FOUND` when running `ccv -logger`

## 1.5.19 (2026-03-12)

- Refactor: ccv argument passthrough — ccv is now a drop-in replacement for claude, all args passed through directly
- Remove: `-c`/`-d` flags as ccv-specific options (now passed through to claude as `--continue`/`--debug`)
- Add: `ccv -logger` command for hook installation (replaces bare `ccv`)
- Add: `--d` shortcut for `--dangerously-skip-permissions`
- Update: help text (`ccv -h`) now shows both ccv-specific and claude passthrough options
- Update: all 18 language README files to reflect new command format

## 1.5.18 (2026-03-11)

- Improve: compact JSON log format — remove pretty-print indentation to reduce log file size
- Improve: reduce MAX_LOG_SIZE from 200MB to 150MB
- Improve: add 300MB total size limit for log merge API

## 1.5.17 (2026-03-11)

- Fix: iOS terminal severe lag — skip WebGL renderer on iOS, fall back to Canvas rendering
- Fix: iOS keyboard pushes navigation bar out of viewport — use `visualViewport` API with fixed positioning to lock layout within visible area
- Improve: reduce terminal scrollback for better mobile performance (iOS: 200, Android: 1000, Desktop: 3000)
- Add `isIOS` device detection in env.js
- Add `interactive-widget=resizes-content` to viewport meta tag

## 1.5.16 (2026-03-11)

- Fix: single-line selection invisible in FileContentView editor — `.cm-activeLine` solid background occluded CodeMirror selection layer; changed to semi-transparent `rgba(255, 255, 255, 0.06)`

## 1.5.15 (2026-03-11)

- Fix: multi-line paste in terminal triggers auto-submit — intercept paste events with bracketed paste escape sequences (`\x1b[200~`...`\x1b[201~`) to prevent newlines from being treated as Enter
- Improve: skip bracketed paste wrapping when shell has already enabled bracketedPasteMode via `\x1b[?2004h`

## 1.5.14 (2026-03-11)

- Feat: built-in $EDITOR/$VISUAL intercept — Claude Code editor requests open in FileContentView, save and close to continue
- Feat: editor session management — server-side editorSessions Map with WebSocket broadcast for open/done events
- Improve: pty-manager passes serverPort, injects CCV_EDITOR_PORT env for ccv-editor.js script
- Improve: TerminalPanel handles editor-open messages, ChatView/FileContentView support editor session banner
- i18n: add ui.editorSession.banner across all 18 supported languages

## 1.5.12 (2026-03-10)

- Feat: CCV process management — list all CCV instances (port 7008-7099), view PID/port/command/start time, stop idle processes from UI
- Feat: process management API — GET /api/ccv-processes (discover via lsof, filter child processes) and POST /api/ccv-processes/kill (with safety checks)
- Improve: shell hook passthrough — non-interactive commands (--version, --help, plugin, mcp, etc.) bypass CCV interception entirely
- Improve: interceptor skip — non-interactive arguments skip interceptor setup and server startup for faster CLI responses
- Improve: PTY manager — switch to --settings JSON injection for ANTHROPIC_BASE_URL to reliably override settings.json config
- Fix: Modal.confirm dark theme — add global CSS overrides for antd confirm dialogs (background, text, button colors)
- Fix: DetailPanel reminder select — reduce CSS specificity from !important to doubled selector for cleaner overrides
- Fix: FileContentView minimap gutter — add padding-top alignment for line number column
- i18n: add ui.processManagement.* keys (12 entries) across all 18 supported languages

## 1.5.11 (2026-03-10)

- Feat: migrate FileContentView from highlight.js to CodeMirror 6 — full-featured code editor with syntax highlighting, editing, and save support
- Feat: add CodeMirror minimap extension — provides code overview with optimized settings (characters display, mouse-over overlay)
- Feat: file editing and saving — Ctrl+S hotkey support, auto-save status indicator, POST /api/file-content endpoint
- Improve: custom line number gutter — external line numbers with scroll sync, allowing minimap to display properly
- i18n: add ui.save, ui.saving, ui.saved, ui.saveFailed, ui.unsavedChanges across all 17 languages

## 1.5.10 (2026-03-09)

- Feat: mobile user prompt viewer — add "用户Prompt" menu item in mobile hamburger menu, fully aligned with PC's original mode implementation
- Feat: complete prompt extraction logic — replicate AppHeader's parseSegments, extractUserTexts, and extractUserPrompts methods for mobile
- Feat: export prompts to .txt — mobile version supports exporting user prompts with timestamps
- Improve: mobile chat list limit adjusted from 300 to 240 items for better performance

## 1.5.9 (2026-03-09)

- Fix: DiffView restructured from single table to fixed gutter + scrollable code layout — line numbers and +/- prefix no longer shift on mobile horizontal scroll
- Fix: DiffView code background colors (red/green) now extend to full row width — fills viewport when code is short, follows longest line when code overflows

## 1.5.8 (2026-03-09)

- Feat: mobile chat list performance optimization — limit rendering to last 300 items with "load more" button (loads 100 at a time), prevents UI lag with 500+ messages
- Feat: incremental SSE loading — client sends cached metadata (since/cc) to server, receives only delta entries instead of full reload
- Feat: auto-collapse long bash commands — bash commands with more than 5 lines are automatically collapsed in chat view to improve readability
- Improve: silent incremental updates — no loading overlay when cache exists, seamless merge of new data
- Improve: mobile "stick to bottom" button — 2x larger size (120px height, 24px font) for better touch targets
- i18n: add "ui.loadMoreHistory" with {count} placeholder across 17 languages
- i18n: add "ui.bashCommand" and "ui.lines" for bash command collapse feature

## 1.5.7 (2026-03-09)

- Fix: mobile virtual keyboard no longer pops up when pressing virtual keys (arrows, enter, etc.) — uses preventDefault on touchstart and blur after key send, while preserving normal text input focus

## 1.5.6 (2026-03-09)

- Fix: hide QR code entry in history log mode on PC
- Fix: DiffView toggle button (expand/collapse) no longer wraps on narrow screens
- Improve: DiffView code area supports unified horizontal scrolling — line numbers and +/- prefix columns use `position: sticky` with opaque backgrounds to stay fixed while code scrolls

## 1.5.5 (2026-03-09)

- Feat: download log file — new download button per log entry, streams raw JSONL via `/api/download-log`
- Feat: delete logs — bulk delete selected logs with confirmation dialog via `/api/delete-logs`
- Feat: log list upgraded from List to Table component with sortable columns (time, turns, size, actions)
- Feat: mobile display settings — collapseToolResults and expandThinking switches now accessible from mobile menu
- Improve: mobile log management — converted from Modal to left-slide-in panel, consistent with stats overlay
- Improve: mobile button styling — inactive buttons use gray outline, merge=blue/delete=red when active
- Fix: ConceptHelp modal — use ConfigProvider darkAlgorithm instead of manual color hacks; fixes black title and misaligned close button on mobile
- Fix: ConceptHelp horizontal scrollbar on mobile — add box-sizing:border-box to textarea/pre, overflow-x:hidden to modalBody
- Fix: PC log modal double scroll — changed Modal body to overflow:hidden to avoid conflict with Table scroll
- i18n: added downloadLog, deleteLogs, deleteLogsConfirm, deleteSuccess, deleteFailed, cancel, logTime, logSize, logTurns, logActions across all 18 languages

## 1.5.4 (2026-03-09)

- Fix: proxy stream error handler — add persistent error listener to prevent late-arriving errors from crashing the process
- Fix: outputBuffer safe truncation — skip incomplete ANSI escape sequences when slicing to prevent terminal state corruption on WebSocket replay
- Fix: local log file mode — pass access token when opening log files in new window; hide terminal button and show chat overlay for local log viewing on mobile
- Fix: ConceptHelp modal header and close button color set to white for better visibility
- Perf: ConceptHelp mobile responsive styles — adjusted font sizes for headings, code blocks, and textareas on small screens
- Perf: Terminal rendering optimization — add smoothScrollDuration:0 and scrollOnUserInput:true; chunk large writes (>32KB) across animation frames to prevent main thread blocking during /resume

## 1.5.3 (2026-03-08)

- Fix: Chat View Edit diff line numbers now correctly reflect file position by tracking Read results and Edit mutations via editSnapshotMap
- Fix: Read tool result `cat -n` format parsing — separator is `→` (Unicode 8594), not tab
- Fix: Git Diff minimap visibility race condition — use rAF polling to detect scrollHeight changes after content renders
- Fix: Git Diff minimap markers use CSS percentage positioning instead of pixel-based mapHeight to avoid zero-height state
- Improve: Chat View DiffView line number column width dynamically adjusts based on max line number

## 1.5.2 (2026-03-08)

- Fix: ConceptHelp modal dark theme — title, text, headings, code, links and close button now use light colors on dark background for mobile readability

## 1.5.1 (2026-03-08)

- Perf: reduce JSONL log rotation threshold from 300MB to 200MB
- Refactor: remove Body Diff JSON tooltip popup, keep diff functionality intact
- Perf: incremental SSE loading — client sends last timestamp and cached count, server returns only new entries

## 1.5.0 (2026-03-08)

- Feat: mobile IndexedDB entry cache — first load caches all entries, subsequent visits restore instantly from cache before SSE arrives
- Perf: singleton IndexedDB connection with write deduplication to avoid redundant structured clone on frequent SSE updates
- Feat: 7-day automatic cache expiry with cleanup on read
- Feat: mobile stats panel (MobileStats component)

---

## Pre-1.5 版本汇总 (Pre-1.5 Version Summary)

> 以下为 1.5.0 之前所有版本的功能摘要，详细变更记录已归档。
> Below is a condensed summary of all versions prior to 1.5.0.

### 1.4.x (2026-03-02 ~ 2026-03-07) — CLI 模式与终端集成

- CLI 模式 (`ccv -c`)：内置 PTY 终端直接运行 Claude，支持 npm/nvm 安装路径自动检测
- 分屏布局：终端 + 对话双面板，可拖拽调整比例
- 文件浏览器：树形目录、文件内容预览、minimap、支持 dot files 和 gitignore 灰显
- Git 集成：变更文件列表、统一 diff 视图（双行号）、diff minimap
- 工作区管理：多工作区切换、SSE 状态同步
- 插件系统：动态加载/卸载、启用/禁用状态管理
- 自动更新器：版本检测与自动升级
- 终端优化：WebGL 渲染 + context loss 恢复、Unicode11 CJK 支持、WebLinks、scrollback 扩容、PTY 输出批量合并
- SSE 分块加载：大日志文件分 50 条 chunk 传输，带进度指示
- 安全：LAN 移动端 token 鉴权修复
- 卸载命令 (`ccv --uninstall`)：完整清理 hooks 和配置

### 1.3.x (2026-02-28 ~ 2026-03-02) — 移动端适配与国际化

- 移动端响应式：虚拟按键栏、触摸滚动惯性、固定列宽自适应字号
- 国际化 (i18n)：支持 18 种语言（中/英/日/韩/法/德/西/葡/俄/阿/印/泰/越/土/意/荷/波/瑞典）
- 代理模式 (proxy)：拦截 Claude API 流量并记录
- 设置面板：主题、语言、显示选项等可视化配置
- 对话模式增强：thinking block 折叠/展开、工具调用结果渲染优化
- 安全：访问 token 认证、CORS 配置

### 1.2.x (2026-02-25 ~ 2026-02-27) — 对话模式

- Chat 模式：将原始 API 请求/响应重组为对话视图
- Markdown 渲染：代码高亮 (highlight.js)、表格、列表
- Thinking blocks：可折叠的模型思考过程展示
- 工具调用结果：结构化渲染 tool_use / tool_result
- 搜索功能：全文搜索对话内容
- 智能自动滚动：仅在用户位于底部时自动跟随

### 1.1.x (2026-02-25) — 数据统计面板

- Dashboard：请求统计、模型用量图表、token 消耗分析
- 缓存重建分析：按原因分类统计（TTL、system/tools/model 变更、消息截断/修改）

### 1.0.x (2026-02-24 ~ 2026-02-25) — 请求查看器

- Request/Response 详情查看器：原始请求体、响应体、流式组装
- 缓存重建分析：精确识别 system prompt / tools / model 变更原因
- Body Diff：JSON/Text 视图切换、复制按钮
- 双向模式同步：Chat ↔ Raw 模式跳转定位
- Claude Code 工具参考文档（22 个内置工具）

### 0.0.1 (2026-02-17) — 初始版本

- 拦截并记录 Claude API 请求/响应

