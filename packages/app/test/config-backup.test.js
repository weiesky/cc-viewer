/**
 * server/lib/config-backup.js 单测 — 启动期配置备份(2026-06-06 事故防再犯)。
 * 全部用例显式传 logDir(mkdtemp 私有目录),不触碰真实 ~/.claude。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { backupConfigs, getBackupRoot } from '../server/lib/config-backup.js';

function mkLogDir(files = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'ccv-cfgbak-'));
  const logDir = join(parent, 'cc-viewer');
  mkdirSync(logDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(logDir, name), content);
  }
  return logDir;
}

const NOW = new Date('2026-06-06T08:30:00.000Z'); // stamp = 20260606_083000

describe('backupConfigs', () => {
  it('三个配置文件齐全 → 备份到 LOG_DIR 外的兄弟目录,内容一致,权限收紧 0600', () => {
    const logDir = mkLogDir({
      'preferences.json': '{"lang":"zh","dingtalk":{"appKey":"k"}}',
      'profile.json': '{"profiles":[],"active":"max"}',
      'workspaces.json': '{"workspaces":[]}',
    });
    const r = backupConfigs(logDir, NOW);
    assert.equal(r.ok, true);
    assert.deepEqual(r.copied.sort(), ['preferences.json', 'profile.json', 'workspaces.json']);
    // 落点 = dirname(logDir)/cc-viewer-config-backups/<stamp>(在 LOG_DIR 之外)
    assert.equal(getBackupRoot(logDir), join(dirname(logDir), 'cc-viewer-config-backups'));
    assert.equal(r.dir, join(getBackupRoot(logDir), '20260606_083000'));
    assert.ok(!r.dir.startsWith(logDir + '/'), '备份必须落在 LOG_DIR 之外');
    assert.equal(readFileSync(join(r.dir, 'preferences.json'), 'utf-8'), '{"lang":"zh","dingtalk":{"appKey":"k"}}');
    assert.equal(statSync(join(r.dir, 'preferences.json')).mode & 0o777, 0o600, '备份份必须 0600');
  });

  it('配置文件部分缺失 → 只备份存在的;全缺 → ok 且不建目录', () => {
    const logDir1 = mkLogDir({ 'profile.json': '{}' });
    const r1 = backupConfigs(logDir1, NOW);
    assert.equal(r1.ok, true);
    assert.deepEqual(r1.copied, ['profile.json']);

    const logDir2 = mkLogDir({});
    const r2 = backupConfigs(logDir2, NOW);
    assert.equal(r2.ok, true);
    assert.deepEqual(r2.copied, []);
    assert.ok(!existsSync(getBackupRoot(logDir2)), '无配置时不应创建备份根');
  });

  it('滚动清理:超过 10 份时删最旧,且只删时间戳形态目录', () => {
    const logDir = mkLogDir({ 'preferences.json': '{}' });
    const root = getBackupRoot(logDir);
    mkdirSync(root, { recursive: true });
    for (let i = 1; i <= 12; i++) {
      mkdirSync(join(root, `202601${String(i).padStart(2, '0')}_000000`), { recursive: true });
    }
    // 干扰项:非时间戳形态目录绝不能被清理
    mkdirSync(join(root, 'keep-me'), { recursive: true });
    const before = readdirSync(root).filter((d) => /^\d{8}_\d{6}$/.test(d)).length;
    const r = backupConfigs(logDir, NOW);
    assert.equal(r.ok, true);
    const stamps = readdirSync(root).filter((d) => /^\d{8}_\d{6}$/.test(d));
    assert.equal(stamps.length, 10, `应收敛到 10 份(原 ${before} + 新 1 - prune ${r.pruned})`);
    assert.ok(stamps.includes('20260606_083000'), '最新一份必须保留');
    assert.ok(existsSync(join(root, 'keep-me')), '非时间戳目录不许动');
  });

  it('logDir 不存在 → ok:true 空 copied(best-effort 不抛)', () => {
    const r = backupConfigs(join(tmpdir(), 'ccv-cfgbak-definitely-missing-xyz'), NOW);
    assert.equal(r.ok, true);
    assert.deepEqual(r.copied, []);
  });
});
