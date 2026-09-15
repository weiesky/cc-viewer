Using `!important` in CSS is prohibited.
New interactive controls must come with the matching i18n entries: `apps/web/src/i18n.js` (frontend) or `packages/app/server/i18n.js` (server/CLI) — adding them to the wrong file is prohibited.
After any code change, `pnpm run build` must be run.
Never commit `package-lock.json`. Any new dependency that ships an install/postinstall script must first be added to `allowBuilds` in `pnpm-workspace.yaml`.
Before committing to GitHub, `pnpm run test:cli` must pass. New scripts under `packages/app/server/**` must come with unit tests in `packages/app/test/`. Update history.md accordingly; when needed, update all README language versions. New cross-layer imports that violate `pnpm run verify:boundaries` are prohibited (the `scripts/boundary-allowlist.json` allowlist is shrink-only).
The `files` array in `packages/app/package.json` must cover any new top-level file; the published manifest must never contain `workspace:`/`catalog:` specifiers.
Do not commit/push/publish unless the user explicitly asks — always ask first, every time.
The version number is only ever bumped by `pnpm changeset version`; hand-editing `packages/app/package.json`'s version is prohibited.
**Only the third version component may ever increase: every changeset must declare `"cc-viewer": patch`, no matter how large the change — minor bumps are prohibited.** When writing, reviewing, or carrying over a changeset, downgrade any `minor` to `patch`; after `changeset version` and before committing, verify the version shows a third-component increment (e.g. 1.8.14 → 1.8.15).
Never create/push a `vX.Y.Z` tag while `packages/app/package.json` is still on the old version (release.yml hard-fails).
Any feature/fix touching `packages/app/` or `packages/content/` must include a changeset file. Never hand-edit `pnpm-lock.yaml`.
Code comments, commit messages, and inline documentation must be in English — no language mixing in the codebase.
Swallowed catch blocks with diagnostic value (SSE/WS event parsing, entry ingest, state updates, fetch handling) must not stay silent — call `reportSwallowed(tag, err)` from `@ccv/core/error-report` (web components may use the `apps/web/src/utils/errorReport.js` shell); purely benign best-effort guards (localStorage, tabBridge IPC, revokeObjectURL, listener cleanup) may stay bare `catch {}`.
