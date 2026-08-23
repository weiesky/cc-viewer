/**
 * approval-policy.test.js
 *
 * Covers server/lib/approval-policy.js (the approval policy leaf shared by perm-bridge
 * and sdk-manager):
 *   - exact members of the APPROVAL_TOOLS six-tool set (matching the semantics both
 *     consumers already rely on)
 *   - isPublishCommand: Bash + npm publish hits; non-Bash / non-publish / missing
 *     command / non-string do not hit
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APPROVAL_TOOLS, isPublishCommand } from '../server/lib/approval-policy.js';

describe('APPROVAL_TOOLS', () => {
  it('精确包含六个审批工具(与 perm-bridge/sdk-manager 既有集合一致)', () => {
    assert.deepEqual(
      [...APPROVAL_TOOLS].sort(),
      ['Bash', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Write'],
    );
  });

  it('交互工具(AskUserQuestion/ExitPlanMode)不在集合内', () => {
    assert.equal(APPROVAL_TOOLS.has('AskUserQuestion'), false);
    assert.equal(APPROVAL_TOOLS.has('ExitPlanMode'), false);
  });
});

describe('isPublishCommand', () => {
  it('Bash + npm publish → true(大小写/空白变体)', () => {
    assert.equal(isPublishCommand('Bash', { command: 'npm publish' }), true);
    assert.equal(isPublishCommand('Bash', { command: 'NPM  PUBLISH --provenance' }), true);
    assert.equal(isPublishCommand('Bash', { command: 'cd pkg && npm publish --tag beta' }), true);
  });

  it('非 publish 的 Bash 命令 → false(含 npm 其他子命令)', () => {
    assert.equal(isPublishCommand('Bash', { command: 'npm install' }), false);
    assert.equal(isPublishCommand('Bash', { command: 'npm run publish-docs' }), false);
    assert.equal(isPublishCommand('Bash', { command: 'git push origin main' }), false);
  });

  it('子串语义与 perm-bridge 原正则严格一致(pnpm publish 也命中 — 同为不可撤销发布)', () => {
    // The predicate is a /npm\s+publish/i substring match, byte-for-byte consistent with
    // perm-bridge.js's historical behavior; "pnpm publish" contains "npm publish" starting
    // at index 1, so it hits. This is a feature, not a bug: pnpm publish is likewise an
    // irreversible outward publish and should go through the same hard gate.
    assert.equal(isPublishCommand('Bash', { command: 'pnpm publish' }), true);
    assert.equal(isPublishCommand('Bash', { command: 'yarn npm publish' }), true);
  });

  it('非 Bash 工具 → false(即使 input 里有 publish 字样)', () => {
    assert.equal(isPublishCommand('Write', { command: 'npm publish' }), false);
    assert.equal(isPublishCommand('Edit', { file_path: 'x', new_string: 'npm publish' }), false);
  });

  it('缺 command / 非字符串 command / 空 input → false(不 throw)', () => {
    assert.equal(isPublishCommand('Bash', {}), false);
    assert.equal(isPublishCommand('Bash', { command: 42 }), false);
    assert.equal(isPublishCommand('Bash', { command: null }), false);
    assert.equal(isPublishCommand('Bash', undefined), false);
    assert.equal(isPublishCommand('Bash', null), false);
  });
});
