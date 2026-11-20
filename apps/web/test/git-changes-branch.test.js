import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-contract tests for the current-branch display in the GIT changes panel
// (components/git/GitChanges.jsx). No renderer exists in apps/web/test, so these
// lock the wiring the same way file-drag-drop.test.js does for drag sources.
const read = (path) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8');

describe('git changes panel current branch', () => {
  it('renders an explicit null branch as the detached-HEAD fallback, undefined as no chip', () => {
    const src = read('components/git/GitChanges.jsx');
    // Unknown (undefined: legacy server without the field / failed unpushed request)
    // must NOT be conflated with the server's explicit null (detached/unborn HEAD).
    assert.ok(src.includes('if (branch === undefined) return null;'));
    assert.ok(src.includes("const label = branch ?? t('ui.gitChanges.detachedHead');"));
    // Single shared chip keeps single-repo row and multi-repo header in sync.
    assert.ok(src.includes('<BranchChip branch={repo.branch} />'));
    assert.ok(src.includes('<BranchRow branch={repos[0].branch} />'));
  });

  it('gates the single-repo branch row and its separator on render conditions', () => {
    const src = read('components/git/GitChanges.jsx');
    // BranchRow only for exactly one loaded repo (multi-repo uses header chips).
    assert.ok(src.includes('repos && repos.length === 1 && ('));
    // Separator only when working-tree rows follow (no dangling/doubled rule).
    assert.ok(src.includes('{(repos[0].changes || []).length > 0 && ('));
    // Fully clean single repo repeats the empty message below the branch row.
    assert.ok(src.includes("{(repos[0].changes || []).length === 0 && !(repos[0].commits || []).length && ("));
  });

  it('keeps the repo name visible next to the header chip (flex floor + title)', () => {
    const src = read('components/git/GitChanges.jsx');
    const css = read('components/git/GitChanges.module.css');
    // Long branch names must not starve the repo name to zero width.
    assert.ok(css.includes('.repoName {') && /\.repoName \{[^}]*min-width:\s*56px/s.test(css));
    // Truncated repo name stays recoverable via hover title.
    assert.ok(src.includes('<span className={styles.repoName} title={repo.name}>{repo.name}</span>'));
  });

  it('keeps the chip read-only and ProxyChip-shaped (pill, ellipsis, no pointer)', () => {
    const css = read('components/git/GitChanges.module.css');
    const chip = css.match(/\.branchChip \{([^}]*)\}/s);
    assert.ok(chip, '.branchChip block exists');
    assert.ok(chip[1].includes('border-radius: 12px;'));
    assert.ok(chip[1].includes('text-overflow: ellipsis;'));
    assert.ok(chip[1].includes('flex-shrink: 1;'));
    assert.ok(!chip[1].includes('cursor: pointer'));
  });

  it('preserves undefined-vs-null branch semantics in the fetch layer', () => {
    const src = read('utils/gitApi.js');
    // `|| null` here would erase the unknown state and make the panel claim
    // "detached HEAD" for old servers / failed requests.
    assert.ok(src.includes('branch: commitsData.branch === null ? null : (commitsData.branch ?? undefined)'));
  });
});
