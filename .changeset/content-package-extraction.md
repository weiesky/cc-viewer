---
"cc-viewer": patch
---

Move bundled content assets (`concepts/`, `ultraAgents/`, `server/imPreset/`, `server/imSkills/`) into the internal `@ccv/content` workspace package. `assemble-dist.mjs` copies them back into the package at build/pack time, so the published tarball layout is byte-identical (enforced by the new `verify:tarball` L4 gate); in the dev repo `server/_paths.js` resolves them live from `packages/content/` via sentinel-checked probes.
