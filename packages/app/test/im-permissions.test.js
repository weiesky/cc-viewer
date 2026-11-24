/**
 * im-permissions.test.js — buildImDenySettings() 直接单测。
 *
 * 该 helper 是 IM worker（PTY 与 SDK 共用）的 permissions.deny 注入源。覆盖：
 *   - CCV_IM_DENY !== '1'（含未设置）→ 返回 {}（不注入 permissions）；
 *   - CCV_IM_DENY === '1' → 返回 { permissions: { deny: [...] } }，含关键规则
 *     （sudo / git push / npm publish / 凭据目录 / settings 自身 / vault 备份）。
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { buildImDenySettings } = await import('../server/lib/im/im-permissions.js');

afterEach(() => { delete process.env.CCV_IM_DENY; });

describe('im-permissions: buildImDenySettings', () => {
  it('CCV_IM_DENY 未设置 → 返回 {}', () => {
    delete process.env.CCV_IM_DENY;
    assert.deepEqual(buildImDenySettings(), {});
  });

  it("CCV_IM_DENY = '0'（非 '1'）→ 返回 {}", () => {
    process.env.CCV_IM_DENY = '0';
    assert.deepEqual(buildImDenySettings(), {});
  });

  it("CCV_IM_DENY = '1' → 注入 permissions.deny 且含关键规则", () => {
    process.env.CCV_IM_DENY = '1';
    const s = buildImDenySettings();
    const deny = s?.permissions?.deny;
    assert.ok(Array.isArray(deny), 'permissions.deny 应为数组');
    assert.ok(deny.includes('Bash(sudo:*)'), '含 sudo');
    assert.ok(deny.includes('Bash(rm -rf:*)'), '含 rm -rf');
    assert.ok(deny.includes('Bash(git push:*)'), '含 git push');
    assert.ok(deny.includes('Bash(npm publish:*)'), '含 npm publish');
    assert.ok(deny.some((r) => r.includes('.ssh/**')), '保护 ~/.ssh');
    assert.ok(deny.some((r) => r.includes('credentials.json')), '保护凭据库');
    assert.ok(deny.some((r) => r.includes('master.key')), '保护 master.key');
    assert.ok(deny.some((r) => r.includes('cc-viewer-config-backups/**')), '保护 vault 备份');
    assert.ok(deny.some((r) => r.includes('.claude/settings.json')), '保护全局 settings（防拦截机制被改）');
  });
});
