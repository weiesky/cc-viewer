---
"cc-viewer": patch
---

feat(web+server): context compaction settings — configurable /compact rules with threshold-based confirm

Quick-settings menu gains a "Context compaction" entry managing a list of compaction rules (title / custom script / percent-or-K threshold), stored as the global `contextCompaction` key in preferences.json. After a turn ends, context usage is read from the SDK snapshot (get_context_usage) or the PTY context_window event; only two consecutive fresh over-threshold readings surface a reminder, and `/compact <script>` is injected through an idle-guarded server path (SDK sendUserMessage turn-gate / PTY chatQueue.injectCommand with strict anchor routing). Includes hysteresis, cooldown, a failure circuit-breaker, cross-tab dedupe, and a management modal sharing the quick-shortcuts list UI.

Each rule also carries an "execution timing": ask-the-user, auto-after-30s, auto-after-3min (a countdown bubble that can be acted on or declined early, paused while hidden), or fully automatic (inject without a bubble). The reminder now floats as a bubble above the composer aligned to the quick-settings star instead of a full-width bar, with an explicit (x) "decline this time, remind me later" (re-reminds after the next turn ends or context grows +50K tokens / +5%).

A built-in "default compaction rule" (75% / ask-the-user) is now always present — it cannot be deleted (whitelisted `builtinId`, merged into every config so existing users who cleared their list get it back), but its title / script / threshold / enabled / timing are all user-editable. A watermark line marks the lowest enabled rule's threshold on the context usage bar, shown only once usage comes within 100K of it. When context usage crosses 960K tokens mid-turn, a forced compaction fires immediately: the current turn is interrupted and the default rule's current script is injected (user-edited, or the built-in fallback) — SDK `forceSendUserMessage` queue + send-now; PTY enqueue + sendNow ESC-interrupt + bracketed paste, never blind-write. A post-compaction latch prevents re-firing on stale readings until usage genuinely drops.
