// Branch coverage for server/workspace-registry.js
//
// 目标分支：
//  - loadWorkspaces: 有效 JSON 但 workspaces 字段非数组 → 走 `: []` 假支 (line 18)
//  - saveWorkspaces: mkdirSync/写入失败 → catch (lines 33-37) + 内层 unlinkSync catch (line 36)
//  - registerWorkspace: pathEq 的 win32 真支 (line 54) + 复用已存在 existing 真支
//  - removeWorkspace: 删除不存在 id → filtered.length===list.length → 返回 false → `if (result)` 假支 (line 88)
//  - getWorkspaces: 两个 workspace 触发 sort 比较器 (line 109) + readdir 失败 catch (line 106) + stat 失败 catch (line 103)
//
// 隔离：本文件用 setLogDir() 把 LOG_DIR 指到 home 下的私有临时目录（setLogDir 仅允许 home / /tmp）。
// node:test 多进程模式下模块级 LOG_DIR 是本文件进程私有的；after() 仍恢复原值并清理目录。
//
// src/utils 的 Vite 风格 import 兼容（本目标虽不直接依赖，但遵守 harness 约定先注册 shim）。
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const findcc = await import('../findcc.js');
const reg = await import('../server/workspace-registry.js');

// 私有 LOG_DIR（必须在 home 下，否则 setLogDir 拒绝）
const PRIVATE_DIR = mkdtempSync(join(homedir(), '.ccv-branch-wsreg-'));
const ORIG_LOG_DIR = findcc.LOG_DIR;

function workspacesFile() { return join(findcc.LOG_DIR, 'workspaces.json'); }

before(() => {
  findcc.setLogDir(PRIVATE_DIR);
  // 确认 live binding 已切换；setLogDir 静默拒绝时会等于旧值
  assert.equal(findcc.LOG_DIR, PRIVATE_DIR, 'setLogDir 应已切换到私有目录');
});

after(() => {
  findcc.setLogDir(ORIG_LOG_DIR);
  try { rmSync(PRIVATE_DIR, { recursive: true, force: true }); } catch { }
});

describe('loadWorkspaces 分支', () => {
  it('有效 JSON 但 workspaces 非数组时返回空数组（: [] 假支）', () => {
    mkdirSync(findcc.LOG_DIR, { recursive: true });
    writeFileSync(workspacesFile(), JSON.stringify({ workspaces: { not: 'array' } }));
    assert.deepStrictEqual(reg.loadWorkspaces(), []);
    // 完全缺失 workspaces 字段也走假支
    writeFileSync(workspacesFile(), JSON.stringify({ other: 1 }));
    assert.deepStrictEqual(reg.loadWorkspaces(), []);
    try { unlinkSync(workspacesFile()); } catch { }
  });
});

describe('saveWorkspaces 失败 catch 分支', () => {
  let prevLog;
  let filePath;
  before(() => {
    // 把 LOG_DIR 指向一个【文件】路径：mkdirSync(recursive) 对已存在文件抛 EEXIST → catch
    prevLog = findcc.LOG_DIR;
    filePath = join(PRIVATE_DIR, 'log-dir-is-a-file');
    writeFileSync(filePath, 'x');
    findcc.setLogDir(filePath);
    assert.equal(findcc.LOG_DIR, filePath);
  });
  after(() => {
    findcc.setLogDir(prevLog);
  });

  it('LOG_DIR 为文件时 saveWorkspaces 吞掉错误并尝试清理 tmp（外层 catch + 内层 unlinkSync catch）', () => {
    const origErr = console.error;
    const calls = [];
    console.error = (...a) => { calls.push(a); };
    try {
      // 不应抛出；catch 内 console.error + 内层 unlinkSync(对不存在/ENOTDIR 路径) catch 都被吞
      assert.doesNotThrow(() => reg.saveWorkspaces([{ id: 'x', path: '/p' }]));
    } finally {
      console.error = origErr;
    }
    assert.equal(calls.length, 1, '应记录一次失败日志');
    assert.match(String(calls[0][0]), /Failed to save workspaces/);
  });
});

describe('registerWorkspace existing 复用 + win32 pathEq 真支', () => {
  it('win32 平台下用小写比较命中已存在条目（pathEq 真支 + existing 真支）', async () => {
    mkdirSync(findcc.LOG_DIR, { recursive: true });
    try { unlinkSync(workspacesFile()); } catch { }

    const desc = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const first = await reg.registerWorkspace(join(PRIVATE_DIR, 'WinProj'));
      assert.ok(first.id);
      // 再次注册大小写不同的同路径：win32 下 toLowerCase 比较应命中 existing
      const second = await reg.registerWorkspace(join(PRIVATE_DIR, 'winproj'));
      assert.equal(second.id, first.id, 'win32 下大小写不同视为同一 workspace');
      const list = reg.loadWorkspaces();
      assert.equal(list.length, 1, '不应出现重复条目');
    } finally {
      Object.defineProperty(process, 'platform', desc);
    }
    try { unlinkSync(workspacesFile()); } catch { }
  });
});

describe('removeWorkspace 返回 false 分支（if(result) 假支）', () => {
  it('删除不存在的 id 返回 false 且不触发 policy 失效', async () => {
    mkdirSync(findcc.LOG_DIR, { recursive: true });
    // 预置一个条目，使 list 非空但 filtered.length === list.length
    await reg.registerWorkspace(join(PRIVATE_DIR, 'keep-me'));
    const r = await reg.removeWorkspace('id-that-does-not-exist');
    assert.equal(r, false);
    // 条目应仍在
    const list = reg.loadWorkspaces();
    assert.ok(list.some((w) => w.path.endsWith('keep-me')));
    try { unlinkSync(workspacesFile()); } catch { }
  });
});

describe('getWorkspaces 排序与统计分支', () => {
  it('多个 workspace 触发 sort 比较器，并对缺失/异常日志目录走 catch', async () => {
    mkdirSync(findcc.LOG_DIR, { recursive: true });
    try { unlinkSync(workspacesFile()); } catch { }

    const a = await reg.registerWorkspace(join(PRIVATE_DIR, 'proj-a'));
    await new Promise((res) => setTimeout(res, 5));
    const b = await reg.registerWorkspace(join(PRIVATE_DIR, 'proj-b'));

    // proj-a 的日志目录：放一个 .jsonl（覆盖 logCount++ + stat 成功）+ 一个非 jsonl
    const aLogDir = join(findcc.LOG_DIR, a.projectName);
    mkdirSync(aLogDir, { recursive: true });
    writeFileSync(join(aLogDir, `${a.projectName}_x.jsonl`), '{"k":1}\n');
    writeFileSync(join(aLogDir, 'note.txt'), 'x');
    // proj-b 不建日志目录 → readdir 抛错 → 外层 catch（line 106）

    const list = await reg.getWorkspaces();
    assert.equal(list.length, 2);
    // b 更晚注册，lastUsed 更新 → 排在前面（sort 比较器返回正/负）
    assert.equal(list[0].projectName, b.projectName, 'lastUsed 较新的应排前');
    assert.equal(list[1].projectName, a.projectName);
    // 统计字段存在
    assert.equal(list[1].logCount, 1);
    assert.ok(list[1].totalSize > 0);
    assert.equal(list[0].logCount, 0, '无日志目录时 logCount 为 0');

    try { unlinkSync(workspacesFile()); } catch { }
  });

  it('getWorkspaces 对存在的目录但 stat 失败的 .jsonl 仍计数（内层 stat catch line 103）', async () => {
    mkdirSync(findcc.LOG_DIR, { recursive: true });
    try { unlinkSync(workspacesFile()); } catch { }

    const w = await reg.registerWorkspace(join(PRIVATE_DIR, 'proj-stat'));
    const wLogDir = join(findcc.LOG_DIR, w.projectName);
    mkdirSync(wLogDir, { recursive: true });
    // 创建一个 .jsonl 然后删除，模拟 readdir 与 stat 之间文件消失。
    // 更稳妥：直接放一个名字以 .jsonl 结尾但其实是悬空 symlink，stat 抛 ENOENT。
    const ghost = join(wLogDir, `${w.projectName}_ghost.jsonl`);
    // 用真实文件先建立，readdir 能看到它；随后在 stat 前删除不可控，
    // 故改用悬空符号链接：readdir 列出名字，stat（follow）抛 ENOENT → 内层 catch。
    const fs = await import('node:fs');
    try {
      fs.symlinkSync(join(wLogDir, 'nonexistent-target'), ghost);
    } catch {
      // 某些平台/权限不允许 symlink，则退而求其次放普通文件（不触发该内层 catch，但不影响测试通过）
      writeFileSync(ghost, '{"k":1}\n');
    }

    const list = await reg.getWorkspaces();
    const found = list.find((x) => x.projectName === w.projectName);
    assert.ok(found);
    // ghost 以 .jsonl 结尾 → logCount 计数（无论 stat 是否成功）
    assert.ok(found.logCount >= 1, 'ghost .jsonl 应被计入 logCount');

    try { unlinkSync(workspacesFile()); } catch { }
  });
});
