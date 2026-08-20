// Tier gate: CLI/server integration suites are opt-in via CCV_TEST_CLI=1
// (`pnpm run test:cli`, which is what CI runs). The default `pnpm run test` skips
// them so the dev-loop suite stays fast, in-process, and incapable of spawning
// the ccv/claude boot path.
//
// Bare `node --test` executes every .js/.mjs under test/ — this non-*.test.js
// helper registers no tests and reports as an empty passing file, exactly like
// the existing test/_shims/*.mjs files.
import { describe } from 'node:test';

export const CLI_TIER = process.env.CCV_TEST_CLI === '1';
export const describeCli = CLI_TIER ? describe : describe.skip;
