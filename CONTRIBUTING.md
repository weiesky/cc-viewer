# Contributing to CC-Viewer

The author welcomes and encourages PRs from the community. The author also doesn't mind if you distill features from this project into your own applications.

## Requirements

- When submitting a PR, please tell me what your **Prompt** was and which **model** you used to modify the code (PRs made with inferior models will not be accepted);
- If there are UI changes, tell me what functionality was modified on the interface — a **screenshot with circles** drawn around the changes is recommended;
- Changes to `cli.js`, `findcc.js`, and `server/interceptor.js` will be reviewed very carefully, as I don't want issues in core files to affect everyone's usage;
- Please make sure to **verify the functionality locally** before submitting — much appreciated!
- ⚠️ `server/_paths.js` is **physically position-sensitive**: every constant is anchored on the file's own URL (`HERE = dirname(import.meta.url)`). Moving this file with `git mv` produces no static error but shifts `PACKAGE_ROOT` / `NODE_MODULES` / `DIST_DIR` etc. Any change to its location must be followed by manual verification of every import site's resolved path.

## Running the tests

The suite has two tiers:

- `pnpm run test` — the fast default tier: in-process unit tests only. Use this in your development loop.
- `pnpm run test:cli` — the full suite: additionally runs the CLI/server integration suites gated behind `CCV_TEST_CLI=1` (spawned `cli.js` boots, real-port server lifecycle). CI runs this tier. Run it before submitting a PR.

Always run via the pnpm scripts (they carry `--test-force-exit`/`--test-timeout`): bare `node --test` hangs on files importing `server/interceptor.js` (lingering watchFile handles keep the event loop alive). Tests live in per-package `test/` dirs plus the root `test/` (cross-package integration and repo guards); discovery is automatic — no path args needed.

(The repo uses pnpm — install with `pnpm install`; Node >=22.13 required for the dev toolchain.)

Test sandboxing env switches (see the `L1`/`L7` isolation barriers in `findcc.js`): tests can never resolve or run a real `claude` binary (`CCV_TEST_ALLOW_REAL_CLAUDE=1` is the explicit per-assertion escape hatch), and browser auto-open is suppressed under tests and whenever `CCV_NO_OPEN=1` is set. New integration tests that spawn `cli.js` or bind real ports should import `describeCli` from `packages/app/test/_helpers/cli-tier.mjs` for their top-level suites.
