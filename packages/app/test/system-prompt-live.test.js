/**
 * system-prompt-live 单测 — 选择 / 固化缓存 / 幂等应用。
 *
 * 数据安全惯例（仓库强制）：静态 ESM import 会被提升，所以先锁死 CCV_LOG_DIR /
 * CLAUDE_CONFIG_DIR 到 mkdtemp，再 dynamic import 被测模块 —— 绝不让测试触碰真实
 * ~/.claude/cc-viewer。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-live-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;

let mod;

before(async () => {
  mod = await import('../server/lib/system-prompt-live.js');
});

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const SID = '11111111-2222-3333-4444-555555555555';
const SID2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PROJ = 'myproject';

describe('live 启用门', () => {
  it('无启动判定 → 不启用', () => {
    mod._resetLiveForTests();
    assert.equal(mod.liveSystemPromptEnabled({}), false);
  });

  it('启动注入存在且未 suppressed → 启用', () => {
    mod._resetLiveForTests();
    mod.setLaunchSystemPromptInfo({
      workspaceDir: '/w', resolvedModelId: 'm1',
      entries: [{ flag: '--append-system-prompt-file', content: 'X' }],
    });
    assert.equal(mod.liveSystemPromptEnabled({}), true);
  });

  it('allowLive:false（IM worker）→ 不启用', () => {
    mod._resetLiveForTests();
    mod.setLaunchSystemPromptInfo({ workspaceDir: '/w', entries: [{ flag: '--append-system-prompt-file', content: 'X' }], allowLive: false });
    assert.equal(mod.liveSystemPromptEnabled({}), false, 'IM worker persona 不被覆盖');
  });

  it('suppressed / 手动 system / env 开关 → 不启用；空 entries 仍启用（强行覆盖）', () => {
    mod._resetLiveForTests();
    mod.setLaunchSystemPromptInfo({ workspaceDir: '/w', entries: [{ flag: '--system-prompt-file', content: 'X' }], suppressed: 'manual-flag' });
    assert.equal(mod.liveSystemPromptEnabled({}), false, 'suppressed 不启用');
    mod.setLaunchSystemPromptInfo({ workspaceDir: '/w', entries: [], manualSystemPrompt: true });
    assert.equal(mod.liveSystemPromptEnabled({}), false, '手动 --system-prompt 不启用');
    mod.setLaunchSystemPromptInfo({ workspaceDir: '/w', entries: [] });
    assert.equal(mod.liveSystemPromptEnabled({}), true, '启动未注入但无手动 → 强行覆盖启用');
    mod.setLaunchSystemPromptInfo({ workspaceDir: '', entries: [] });
    assert.equal(mod.liveSystemPromptEnabled({}), false, '无 workspaceDir 不启用');
    mod.setLaunchSystemPromptInfo({ workspaceDir: '/w', entries: [{ flag: '--system-prompt-file', content: 'X' }] });
    assert.equal(mod.liveSystemPromptEnabled({ CCV_DISABLE_LIVE_SYSTEM_PROMPT: '1' }), false);
    assert.equal(mod.liveSystemPromptEnabled({ CCV_DISABLE_AUTO_SYSTEM_PROMPT: '1' }), false);
  });
});

describe('固化缓存 get/put', () => {
  it('put 后 get 命中（内存），换「进程」后磁盘恢复', () => {
    mod._resetLiveForTests();
    const entry = { override: 'OVR', append: 'APP' };
    assert.equal(mod.putLiveEntry(PROJ, SID, 'model-a', entry, { logDir: tmpDir }), true);
    assert.deepEqual(mod.getLiveEntry(PROJ, SID, 'model-a', { logDir: tmpDir }), entry);
    // 模拟进程重启：清内存，从磁盘读
    mod._resetLiveForTests(); // 清内存 + launchInfo（_reset 不动磁盘）
    assert.deepEqual(mod.getLiveEntry(PROJ, SID, 'model-a', { logDir: tmpDir }), entry, '磁盘恢复');
  });

  it('同 session 两个模型的条目合并到同一磁盘记录（不互相覆盖）', () => {
    mod._resetLiveForTests();
    mod.putLiveEntry(PROJ, SID, 'model-a', { override: 'A', append: null }, { logDir: tmpDir });
    mod.putLiveEntry(PROJ, SID, 'model-b', { override: null, append: 'B' }, { logDir: tmpDir });
    // 冷内存重读磁盘：两个模型都必须还在
    mod._resetLiveForTests();
    assert.deepEqual(mod.getLiveEntry(PROJ, SID, 'model-a', { logDir: tmpDir }), { override: 'A', append: null });
    assert.deepEqual(mod.getLiveEntry(PROJ, SID, 'model-b', { logDir: tmpDir }), { override: null, append: 'B' });
  });

  it('键分量非法 → 跳过（不缓存不改写）', () => {
    mod._resetLiveForTests();
    assert.equal(mod.getLiveEntry('', SID, 'm', { logDir: tmpDir }), null);
    assert.equal(mod.getLiveEntry(PROJ, 'not-a-uuid', 'm', { logDir: tmpDir }), null);
    assert.equal(mod.getLiveEntry(PROJ, SID, '', { logDir: tmpDir }), null);
    assert.equal(mod.putLiveEntry(PROJ, 'bad', 'm', { override: 'x' }, { logDir: tmpDir }), false);
  });

  it('不同 model 各自固化，互不覆盖', () => {
    mod._resetLiveForTests();
    mod.putLiveEntry(PROJ, SID2, 'model-a', { override: 'A', append: null }, { logDir: tmpDir });
    mod.putLiveEntry(PROJ, SID2, 'model-b', { override: null, append: 'B' }, { logDir: tmpDir });
    assert.deepEqual(mod.getLiveEntry(PROJ, SID2, 'model-a', { logDir: tmpDir }), { override: 'A', append: null });
    assert.deepEqual(mod.getLiveEntry(PROJ, SID2, 'model-b', { logDir: tmpDir }), { override: null, append: 'B' });
  });
});

describe('selectEntriesForModel', () => {
  it('workspace 模型条目命中 → 取代 sentinel', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ccv-live-ws-'));
    mkdirSync(join(ws, 'system_prompt'), { recursive: true });
    writeFileSync(join(ws, 'system_prompt', 'OPUS_SYSTEM.md'), 'OPUS OVERRIDE');
    writeFileSync(join(ws, 'CC_SYSTEM.md'), 'SENTINEL');
    const out = mod.selectEntriesForModel('claude-opus-4-8', { workspaceDir: ws });
    assert.deepEqual(out, { override: 'OPUS OVERRIDE', append: null });
    rmSync(ws, { recursive: true, force: true });
  });

  it('sentinel 双文件并存 → override+append 同时返回', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ccv-live-ws-'));
    writeFileSync(join(ws, 'CC_SYSTEM.md'), 'OVR SENTINEL');
    writeFileSync(join(ws, 'CC_APPEND_SYSTEM.md'), 'APP SENTINEL');
    // 无模型条目、无 builtin 命中（用一个绝不可能命中 preset 的模型名）
    const out = mod.selectEntriesForModel('no-such-model-zzz', { workspaceDir: ws });
    assert.deepEqual(out, { override: 'OVR SENTINEL', append: 'APP SENTINEL' });
    rmSync(ws, { recursive: true, force: true });
  });

  it('${...} 模板经 variablesFactory 渲染；未知变量 keep', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ccv-live-ws-'));
    writeFileSync(join(ws, 'CC_APPEND_SYSTEM.md'), 'model=${model.name} unknown=${no.such.var}');
    // 模型名需避开 builtin preset 匹配（k3 会命中 K3 别名 preset）
    const out = mod.selectEntriesForModel('no-such-model-zzz', {
      workspaceDir: ws,
      variablesFactory: (overrides) => ({ model: overrides.model }),
    });
    assert.equal(out.append, 'model=no-such-model-zzz unknown=${no.such.var}');
    rmSync(ws, { recursive: true, force: true });
  });

  it('无任何配置 → null', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ccv-live-ws-'));
    assert.equal(mod.selectEntriesForModel('no-such-model-zzz', { workspaceDir: ws }), null);
    rmSync(ws, { recursive: true, force: true });
  });

  it('入参非法 → null（total）', () => {
    assert.equal(mod.selectEntriesForModel('', { workspaceDir: '/w' }), null);
    assert.equal(mod.selectEntriesForModel('m', {}), null);
    assert.equal(mod.selectEntriesForModel(null, { workspaceDir: '/w' }), null);
  });

  it('快照渲染（重构：git 变量启动缓存复用）：不传 factory 用启动快照,无现场收集', () => {
    mod._resetLiveForTests();
    const ws = mkdtempSync(join(tmpdir(), 'ccv-live-ws-'));
    writeFileSync(join(ws, 'CC_APPEND_SYSTEM.md'), 'b=${git.branch} m=${model.name} d=${time.date} u=${no.such}');
    // 发布启动快照: git.branch 冻结为 frozen-branch, timezone UTC, model.name 为启动模型
    mod.setLaunchSystemPromptInfo({
      workspaceDir: ws, resolvedModelId: 'startup-model', entries: [],
      variableSnapshot: {
        environment: { cwd: ws }, git: { isRepository: 'true', root: ws, branch: 'frozen-branch', mainBranch: 'main', userName: '', recentCommits: '' },
        os: {}, runtime: {}, permissions: {}, sandbox: {}, terminal: {}, filesystem: {}, memory: {}, scratchpad: {},
        time: { timezone: 'UTC' }, model: { name: 'startup-model', knowledgeCutoff: '' },
      },
    });
    // 不传 variablesFactory(生产路径)→ 用启动快照渲染,git.branch 用快照值(冻结),model.name 用当前 modelId
    const out = mod.selectEntriesForModel('no-such-model-zzz', { workspaceDir: ws });
    assert.ok(out.append.includes('b=frozen-branch'), 'git.branch 用启动快照值(冻结,不现场跑 git)');
    assert.ok(out.append.includes('m=no-such-model-zzz'), 'model.name 用当前请求模型(实时)');
    assert.ok(!out.append.includes('startup-model'), 'model.name 不用启动模型(实时覆盖)');
    assert.ok(out.append.includes('u=${no.such}'), '未知变量 keep');
    rmSync(ws, { recursive: true, force: true });
  });

  it('time.date 实时(重构): 快照里的旧日期被实时覆盖', () => {
    mod._resetLiveForTests();
    const ws = mkdtempSync(join(tmpdir(), 'ccv-live-ws-'));
    writeFileSync(join(ws, 'CC_APPEND_SYSTEM.md'), 'd=${time.date} tz=${time.timezone}');
    mod.setLaunchSystemPromptInfo({
      workspaceDir: ws, resolvedModelId: 'm', entries: [],
      variableSnapshot: {
        environment: {}, git: { isRepository: 'false', root: '', branch: '', mainBranch: '', userName: '', recentCommits: '' },
        os: {}, runtime: {}, permissions: {}, sandbox: {}, terminal: {}, filesystem: {}, memory: {}, scratchpad: {},
        time: { timezone: 'UTC' }, model: { name: 'm', knowledgeCutoff: '' },
      },
    });
    const out = mod.selectEntriesForModel('no-such-model-zzz', { workspaceDir: ws });
    const today = new Date().toISOString().slice(0, 10); // UTC date
    assert.ok(out.append.includes(`d=${today}`), `time.date 实时(应为今天 UTC ${today},非启动冻结)`);
    assert.ok(out.append.includes('tz=UTC'), 'time.timezone 用快照值');
    rmSync(ws, { recursive: true, force: true });
  });

  it('无快照(null)→ ${git.*} 渲染为空串骨架,不是 keep 字面量(重构 P1-2)', () => {
    mod._resetLiveForTests();
    // 发布 launchInfo 但 variableSnapshot 为 null(启动无注入/无 ${...}/pinned 场景)
    mod.setLaunchSystemPromptInfo({ workspaceDir: '/w', resolvedModelId: 'm', entries: [], variableSnapshot: null });
    const ws = mkdtempSync(join(tmpdir(), 'ccv-live-ws-'));
    writeFileSync(join(ws, 'CC_APPEND_SYSTEM.md'), 'b=${git.branch} r=${git.isRepository} m=${model.name}');
    const out = mod.selectEntriesForModel('no-such-model-zzz', { workspaceDir: ws });
    assert.ok(!out.append.includes('${git.branch}'), '${git.branch} 不是 keep 字面量(空串骨架)');
    assert.ok(out.append.includes('b='), 'git.branch 渲染为空串');
    assert.ok(out.append.includes('r=false'), 'git.isRepository 渲染为 false(空串骨架)');
    assert.ok(out.append.includes('m=no-such-model-zzz'), 'model.name 仍实时渲染');
    rmSync(ws, { recursive: true, force: true });
  });

  it('单槽语义(重构): 后一次 launch 的快照覆盖前一次', () => {
    mod._resetLiveForTests();
    mod.setLaunchSystemPromptInfo({
      workspaceDir: '/w1', resolvedModelId: 'm', entries: [],
      variableSnapshot: { environment: {}, git: { isRepository: 'true', root: '', branch: 'branch-ws1', mainBranch: '', userName: '', recentCommits: '' }, os: {}, runtime: {}, permissions: {}, sandbox: {}, terminal: {}, filesystem: {}, memory: {}, scratchpad: {}, time: { timezone: 'UTC' }, model: { name: 'm', knowledgeCutoff: '' } },
    });
    // 第二次 launch 覆盖
    mod.setLaunchSystemPromptInfo({
      workspaceDir: '/w2', resolvedModelId: 'm', entries: [],
      variableSnapshot: { environment: {}, git: { isRepository: 'true', root: '', branch: 'branch-ws2', mainBranch: '', userName: '', recentCommits: '' }, os: {}, runtime: {}, permissions: {}, sandbox: {}, terminal: {}, filesystem: {}, memory: {}, scratchpad: {}, time: { timezone: 'UTC' }, model: { name: 'm', knowledgeCutoff: '' } },
    });
    const snap = mod.getLaunchSystemPromptInfo().variableSnapshot;
    assert.equal(snap.git.branch, 'branch-ws2', '单槽: 后一次 launch 的快照覆盖前一次');
  });

  it('_resetLiveForTests 清空启动快照(重构)', () => {
    mod._resetLiveForTests();
    mod.setLaunchSystemPromptInfo({
      workspaceDir: '/w', resolvedModelId: 'm', entries: [],
      variableSnapshot: { environment: {}, git: { isRepository: 'true', root: '', branch: 'b', mainBranch: '', userName: '', recentCommits: '' }, os: {}, runtime: {}, permissions: {}, sandbox: {}, terminal: {}, filesystem: {}, memory: {}, scratchpad: {}, time: { timezone: 'UTC' }, model: { name: 'm', knowledgeCutoff: '' } },
    });
    assert.ok(mod.getLaunchSystemPromptInfo().variableSnapshot, '发布后有快照');
    mod._resetLiveForTests();
    assert.equal(mod.getLaunchSystemPromptInfo(), null, '_resetLiveForTests 清空 launchInfo(含快照)');
  });
});

describe('deriveBaseBlocks / applyLiveSystem 幂等', () => {
  const billing = { type: 'text', text: 'x-anthropic-billing-header: cc_version=1' };
  const mainBlock = { type: 'text', text: 'You are Claude Code, official CLI.', cache_control: { type: 'ephemeral' } };

  it('剥离尾 block 注入文本（\\n 拼接形态），保留 block 其余字段', () => {
    const blocks = [billing, { ...mainBlock, text: 'You are Claude Code, official CLI.\nINJECTED' }];
    const base = mod.deriveBaseBlocks(blocks, ['INJECTED']);
    assert.deepEqual(base, [billing, mainBlock], 'cache_control 保留、文本剥回 base');
  });

  it('整个尾 block 即注入文本 → 移除该 block', () => {
    const blocks = [billing, { type: 'text', text: 'INJECTED', cache_control: { type: 'ephemeral' } }];
    const base = mod.deriveBaseBlocks(blocks, ['INJECTED']);
    assert.deepEqual(base, [billing]);
  });

  it('数组形态应用：billing block 保留，注入并入尾 block 且 cache_control 保留', () => {
    const out = mod.applyLiveSystem([billing, mainBlock], { override: null, append: 'APPEND-TEXT' }, []);
    assert.ok(Array.isArray(out));
    assert.deepEqual(out[0], billing, 'billing header 原样保留');
    assert.equal(out[1].text, 'You are Claude Code, official CLI.\nAPPEND-TEXT');
    assert.deepEqual(out[1].cache_control, { type: 'ephemeral' }, 'cache_control 不丢');
  });

  it('幂等：apply(apply(x)) === apply(x)（append 不重复）', () => {
    const entry = { override: null, append: 'APPEND-TEXT' };
    const known = ['APPEND-TEXT'];
    const once = mod.applyLiveSystem([billing, mainBlock], entry, known);
    const twice = mod.applyLiveSystem(once, entry, known);
    assert.equal(twice, null, '第二次应用无变化（null）');
    const text = once[1].text;
    assert.equal(text.split('APPEND-TEXT').length - 1, 1, 'append 文本只出现一次');
  });

  it('幂等（切换路径，known 各只一份）：override+append 并存数组形态 apply(apply(x)) === apply(x)', () => {
    // override 路径：整段替换（官方 persona 移除），override+append 合并进带断点的新尾块。
    // 幂等：二次 apply 时输入已是目标形态 → null（不依赖尾部不动点剥离）。
    const OVR = 'SWITCH-OVERRIDE-TEXT-LONGER-THAN-APPEND';
    const APP = 'SW-APP';
    const known = [OVR, APP];
    const entry = { override: OVR, append: APP };
    const once = mod.applyLiveSystem([billing, mainBlock], entry, known);
    const twice = mod.applyLiveSystem(once, entry, known);
    assert.equal(twice, null, '切换路径 override+append 也必须幂等');
    assert.equal(once[0].text, billing.text, 'billing 前缀块保留');
    assert.equal(once[1].text, OVR + '\n' + APP, 'override+append 合并进新尾块');
    assert.ok(!JSON.stringify(once).includes('You are Claude Code'), '官方 persona 被移除');
  });

  it('override+append 并存，且 override 已含 append 时不重复拼接', () => {
    // 字符串形态 override 是整段替换（无 BASE 保留），append 并入 override 文本
    const withAppend = mod.applyLiveSystem('BASE', { override: 'OVR', append: 'APP' }, []);
    assert.equal(withAppend, 'OVR\nAPP');
    const contained = mod.applyLiveSystem('BASE', { override: 'OVR APP', append: 'APP' }, []);
    assert.equal(contained, 'OVR APP', 'override 已含 append → 不重复');
  });

  it('字符串形态应用与幂等', () => {
    const entry = { override: null, append: 'APP' };
    const once = mod.applyLiveSystem('BASE', entry, ['APP']);
    assert.equal(once, 'BASE\nAPP');
    assert.equal(mod.applyLiveSystem(once, entry, ['APP']), null, '幂等');
  });

  it('override+append 并存 → 整段替换合并注入，apply 幂等不累积', () => {
    // override 路径整段替换：override+'\n'+append 合并进带断点的新尾块，官方 persona 移除。
    // 二次/三次 apply 幂等（已是目标形态 → null），不逐轮累积。
    const OVR = 'LONG-OVERRIDE-TEXT-THAT-IS-LONGER';
    const APP = 'SHORT-APP';
    const known = [OVR, APP];
    const entry = { override: OVR, append: APP };
    const once = mod.applyLiveSystem([billing, mainBlock], entry, known);
    const twice = mod.applyLiveSystem(once, entry, known);
    assert.equal(twice, null, 'override+append 并存也必须幂等');
    assert.equal(once[1].text, OVR + '\n' + APP, 'override+append 合并，各只一份');
    assert.equal(once[1].cache_control?.type, 'ephemeral', '断点在新尾块');
    // 第三次同样幂等
    const third = mod.applyLiveSystem(once, entry, known);
    assert.equal(third, null);
  });

  it('模型切换后旧注入被剥离、新注入并入（无残留）', () => {
    const known = ['APP-M1', 'APP-M2'];
    const m1 = mod.applyLiveSystem([billing, mainBlock], { override: null, append: 'APP-M1' }, known);
    const m2 = mod.applyLiveSystem(m1, { override: null, append: 'APP-M2' }, known);
    const text = m2[1].text;
    assert.ok(!text.includes('APP-M1'), '旧模型注入被剥离');
    assert.ok(text.includes('APP-M2'));
    assert.ok(text.startsWith('You are Claude Code'));
  });

  it('端到端剥离：经真实 knownInjectedTexts（put 两个模型后切换不累积）', () => {
    // 回归 P0：knownInjectedTexts 必须能读到 putLiveEntry 写入的缓存条目，
    // 否则旧模型文本剥不掉、每次切换 system 单调增长。
    mod._resetLiveForTests();
    mod.setLaunchSystemPromptInfo({
      workspaceDir: '/w',
      entries: [{ flag: '--append-system-prompt-file', content: 'LAUNCH-T0' }],
    });
    mod.putLiveEntry(PROJ, SID, 'm1', { override: null, append: 'T1' }, { logDir: tmpDir });
    mod.putLiveEntry(PROJ, SID, 'm2', { override: null, append: 'T2' }, { logDir: tmpDir });

    const sys0 = [{ type: 'text', text: 'BASE' }];
    const after1 = mod.applyLiveSystem(sys0, { override: null, append: 'T1' }, mod.knownInjectedTexts(PROJ, SID, { logDir: tmpDir }));
    assert.equal(after1[0].text, 'BASE\nT1');
    const after2 = mod.applyLiveSystem(after1, { override: null, append: 'T2' }, mod.knownInjectedTexts(PROJ, SID, { logDir: tmpDir }));
    assert.equal(after2[0].text, 'BASE\nT2', '旧模型注入被剥离，不累积');
    const after3 = mod.applyLiveSystem(after2, { override: null, append: 'T1' }, mod.knownInjectedTexts(PROJ, SID, { logDir: tmpDir }));
    assert.equal(after3[0].text, 'BASE\nT1', '切回 m1 还原');
  });

  it('override 整段替换：官方 persona 移除、billing 保留、断点在 override 块、幂等', () => {
    // 新语义：override 不再从尾部剥离，而是保留「CLI 自有块」（billing 前缀块 + CLI 官方
    // 身份行块）后整段替换其余。旧 override 注入块（无论位置）都被替换，不重复不残留。
    // 注：fixture 的 mainBlock 文案（"You are Claude Code, official CLI."）非标准身份行
    // （真实身份行是 "...Anthropic's official CLI for Claude."），故被当 persona 移除。
    const OVR = 'MODEL-OVERRIDE';
    // 首次：非标准 persona base → 整段替换（仅剩 billing + override）
    const first = mod.applyLiveSystem([billing, mainBlock], { override: OVR, append: null }, [OVR]);
    assert.equal(first.length, 2, 'billing + override 两块');
    assert.ok(first[0].text.startsWith('x-anthropic-billing-header'), 'billing 前缀块保留');
    assert.equal(first[1].text, OVR, 'override 文本在新尾块');
    assert.equal(first[1].cache_control?.type, 'ephemeral', '断点转移到 override 块');
    assert.ok(!JSON.stringify(first).includes('You are Claude Code'), '非标准 persona 被移除');
    // 二次（已是目标形态）→ 幂等 null
    const second = mod.applyLiveSystem(first, { override: OVR, append: null }, [OVR]);
    assert.equal(second, null, '已是目标形态 → no-op（幂等）');
    // 切换 override：旧 override 被新 override 整段替换（无残留）
    const switched = mod.applyLiveSystem(first, { override: 'NEW-OVR', append: null }, [OVR, 'NEW-OVR']);
    assert.equal(switched[1].text, 'NEW-OVR', '旧 override 被替换');
    assert.ok(!JSON.stringify(switched).includes(OVR), '旧 override 无残留');
  });

  it('override 整段替换保留 CLI 官方身份行（D1：真实 3 块 wire 首请求形态一致）', () => {
    // 真实 wire 是 3 块 [billing, identity, persona]；override 替换 persona 但保留
    // billing 与 CLI 身份行 → 与启动形态一致，override 会话首请求零改写、KV-cache 复用。
    const identity = { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude.", cache_control: { type: 'ephemeral' } };
    const persona = { type: 'text', text: 'You are k3, interactive coding agent.', cache_control: { type: 'ephemeral' } };
    const out = mod.applyLiveSystem([billing, identity, persona], { override: 'You are DeepSeek.', append: null }, ['You are k3, interactive coding agent.', 'You are DeepSeek.']);
    assert.equal(out.length, 3, 'billing + identity + override 三块');
    assert.ok(out[0].text.startsWith('x-anthropic-billing-header'), 'billing 保留');
    assert.equal(out[1].text, identity.text, 'CLI 官方身份行保留');
    assert.equal(out[2].text, 'You are DeepSeek.', '新 override 注入尾块');
    assert.ok(!JSON.stringify(out).includes('k3'), '旧 persona 被移除');
    // 断点继承：persona 块的 ephemeral 断点转移到 override 块
    assert.equal(out[2].cache_control?.type, 'ephemeral', '断点在 override 块');
    // 二次 apply 幂等
    assert.equal(mod.applyLiveSystem(out, { override: 'You are DeepSeek.', append: null }, ['You are DeepSeek.']), null, '幂等');
  });

  it('override 身份行识别：整块精确匹配，追加内容/SDK/subagent 片段不误留', () => {
    const CLI_ID = "You are Claude Code, Anthropic's official CLI for Claude.";
    const SDK_ID = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
    // SDK 身份行整块 → 保留（真实 wire 形态）
    const sdkOut = mod.applyLiveSystem(
      [billing, { type: 'text', text: SDK_ID, cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'custom persona' }],
      { override: 'OVR', append: null }, ['OVR', 'custom persona']);
    assert.ok(JSON.stringify(sdkOut).includes(SDK_ID), 'SDK 身份行整块保留');
    assert.ok(!JSON.stringify(sdkOut).includes('custom persona'), '自定义 persona 被替换');
    // 「身份行 + 追加内容」整块不等 → 整块被替换（追加的 persona 不得借 startsWith 逃逸）
    const appendedOut = mod.applyLiveSystem(
      [billing, { type: 'text', text: CLI_ID + ' EXTRA-PERSONA' }],
      { override: 'OVR', append: null }, ['OVR']);
    assert.ok(!JSON.stringify(appendedOut).includes('EXTRA-PERSONA'), '身份行+追加整块被替换，追加内容不误留');
    // subagent persona（含身份行片段但整块不等）→ 被替换（不误认为身份行保留）
    const subagentOut = mod.applyLiveSystem(
      [billing, { type: 'text', text: "You are a file search specialist for Claude Code, Anthropic's official CLI for Claude. Given a…" }],
      { override: 'OVR', append: null }, ['OVR']);
    assert.ok(!JSON.stringify(subagentOut).includes('file search specialist'), 'subagent persona 被替换，不误留');
  });

  it('append 不并入 CLI 身份块（review 二轮 P1-2）：override→append→override 身份块存活', () => {
    const CLI_ID = "You are Claude Code, Anthropic's official CLI for Claude.";
    const wire = [
      billing,
      { type: 'text', text: CLI_ID, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'You are k3, agent.', cache_control: { type: 'ephemeral' } },
    ];
    // 切 append：persona 被 deriveBaseBlocks 剥离、identity 成尾块，append 绝不并入身份块
    const appended = mod.applyLiveSystem(wire, { override: null, append: 'Always Chinese.' }, ['You are k3, agent.', 'Always Chinese.']);
    assert.ok(appended.some(b => b.text === CLI_ID), 'append 后身份块整块存活（未被并入污染）');
    assert.equal(appended[appended.length - 1].text, 'Always Chinese.', 'append 落到新尾块');
    // 切回 override：身份块必须保留（=== 精确匹配仍命中），不被当 persona 丢弃
    const backOvr = mod.applyLiveSystem(appended, { override: 'NEW-OVR', append: null }, ['NEW-OVR', 'Always Chinese.']);
    assert.ok(JSON.stringify(backOvr).includes(CLI_ID), '切回 override 后身份块仍保留（不永久丢失）');
  });

  it('override 文本撞保留判据不累积（review 二轮 P1-3）：apply(apply(x)) === null', () => {
    const CLI_ID = "You are Claude Code, Anthropic's official CLI for Claude.";
    // 触发族1：override 文本恰为官方身份常量
    let cur = [billing, { type: 'text', text: CLI_ID, cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'old' }];
    let once = mod.applyLiveSystem(cur, { override: CLI_ID, append: null }, [CLI_ID]);
    assert.equal(mod.applyLiveSystem(once, { override: CLI_ID, append: null }, [CLI_ID]), null, 'override==身份常量：二次幂等不累积');
    // 触发族2：override 文本以 billing 前缀开头
    const ovrB = 'x-anthropic-billing-header: INJECTED-OVERRIDE';
    cur = [billing, { type: 'text', text: 'persona', cache_control: { type: 'ephemeral' } }];
    once = mod.applyLiveSystem(cur, { override: ovrB, append: null }, [ovrB]);
    assert.equal(mod.applyLiveSystem(once, { override: ovrB, append: null }, [ovrB]), null, 'override 以 billing 前缀开头：二次幂等不累积');
  });

  it('字符串形态 override 保留 billing 行与 CLI 身份行（review 二轮 P2-A：与数组形态 D1 一致）', () => {
    const CLI_ID = "You are Claude Code, Anthropic's official CLI for Claude.";
    const strSys = 'x-anthropic-billing-header: abc\n' + CLI_ID + '\ncustom persona';
    const out = mod.applyLiveSystem(strSys, { override: 'OVR', append: null }, ['OVR']);
    assert.ok(out.startsWith('x-anthropic-billing-header: abc'), '字符串形态 billing 行保留');
    assert.ok(out.includes(CLI_ID), '字符串形态身份行保留（不再丢失）');
    assert.ok(!out.includes('custom persona'), 'persona 被替换');
    // 无保留行的纯 persona 字符串 → 整段替换
    assert.equal(mod.applyLiveSystem('just a persona', { override: 'OVR', append: null }, ['OVR']), 'OVR', '纯 persona 字符串整段替换');
  });

  it('无变化 → null；坏输入 → null（total）', () => {
    assert.equal(mod.applyLiveSystem('x', { override: null, append: null }), null);
    assert.equal(mod.applyLiveSystem('x', null), null);
    assert.equal(mod.applyLiveSystem(42, { override: 'o' }), null);
    assert.equal(mod.applyLiveSystem('x', { override: '', append: '' }), null);
  });
});

describe('knownInjectedTexts', () => {
  it('launch entries + 缓存条目合并', () => {
    mod._resetLiveForTests();
    mod.setLaunchSystemPromptInfo({
      workspaceDir: '/w',
      entries: [{ flag: '--append-system-prompt-file', content: 'LAUNCH-APP' }],
    });
    mod.putLiveEntry(PROJ, SID, 'model-a', { override: 'CACHED-OVR', append: null }, { logDir: tmpDir });
    const texts = mod.knownInjectedTexts(PROJ, SID, { logDir: tmpDir });
    assert.ok(texts.includes('LAUNCH-APP'));
    assert.ok(texts.includes('CACHED-OVR'));
  });
});
