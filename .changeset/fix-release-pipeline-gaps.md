---
"cc-viewer": patch
---

fix(ci): close the three gaps that made release failures recur. (1) `bump-homebrew` in release.yml now `needs: npm-publish` (not `publish`) — it was racing the npm registry write and timing out its poll every release (v1.8.8/1.8.9/1.8.10) because it only waited on the GitHub Release job. (2) A cheap `verify:tarball-drift` guard (scripts/verify-tarball-drift.mjs) now runs in every `pretest*` hook and fails the local suite when a publishable source file (server/, concepts/, ultraAgents/, plugins/, @ccv/core/src) is added/removed without regenerating `scripts/tarball-baseline.json` — previously only the slow `verify:tarball` (not in pretest) caught this, and only in CI. (3) CLAUDE.md now documents the baseline-regen rule and warns against pushing a feature together with its changeset (which skips the per-commit CI run).
