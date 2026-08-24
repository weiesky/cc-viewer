// 内置模型提示词层：让 packages/app/server/system-prompt-templates/presets/ 的 6 个预设
// 成为「默认生效」的模型 system prompt——spawn 时模型匹配且用户无对应文件（workspace >
// global 两级用户文件优先）时自动注入；用户可通过墓碑文件禁用某个内置条目。
//
// 数据源复用 system-prompt-presets.js 的 listSystemPromptPresets()（manifest 读取 +
// renderPresetTemplate 边界剥离都已在里面，且注释承诺不触发 createSystemPromptVariables/
// git 子进程）。本模块函数对非法入参会 throw（setBuiltinDisabled/materializeBuiltinPrompt），
// spawn 注入链路的安全由调用点整层 try-catch 保证（system-prompt-files.js 失败回落
// sentinel，注入链路永不 throw）。
//
// Built-in model prompt layer: the shipped presets act as default-effective model
// system prompts. User files (workspace > global) always win; a per-scope tombstone
// file disables individual built-in entries.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandModelIdVariants, normalizeModelName } from './model-system-prompts.js';
import { listSystemPromptPresets } from './system-prompt-presets.js';
import { renameSyncWithRetry } from './file-api.js';
import { reportSwallowed } from '@ccv/core/error-report';

// 墓碑文件名：放在对应 scope 的 modelPromptDir 里，内容是规范大写名的 JSON 数组。
// parseModelPromptFileName 对非 *_SYSTEM.md 文件名返回 null，天然不干扰条目列表。
// Tombstone file inside a scope's model-prompt dir: a JSON array of canonical names.
export const BUILTIN_DISABLED_FILE = '.builtin-disabled.json';

// 物化目录：preset 文本（边界已剥离、${...} 保持字面量，spawn 渲染管线再替换变量）
// 写成内容寻址的临时文件，供 --system-prompt-file 注入（文件对形式是快照钉扎的前提）。
// 惰性读取 env 覆盖（测试用）：node --test 多进程并行时共享目录会被彼此的 GC 竞态误删。
// Materialized temp dir for boundary-stripped preset texts (content-addressed).
const materializeDir = () => process.env.CCV_BUILTIN_PROMPT_MATERIALIZE_DIR || join(tmpdir(), 'cc-viewer-builtin-prompts');

/**
 * 列出全部内置模型条目。name = manifest match 的大写规范化（与用户条目同名体系，
 * 用户同名文件天然形成覆盖）；text = renderPresetTemplate 输出（无边界标记）。
 * List all built-in model entries derived from the preset manifest.
 *
 * @returns {Array<{ id: string, title: string, name: string, mode: 'override'|'append', matchLower: string, text: string }>}
 */
export function listBuiltinModelPrompts() {
  let presets;
  try {
    presets = listSystemPromptPresets();
  } catch {
    return []; // manifest 损坏等：内置层整体缺席，调用方回落 sentinel
  }
  const out = [];
  for (const p of presets) {
    const name = normalizeModelName(typeof p?.match === 'string' ? p.match : '');
    if (!name || typeof p.text !== 'string' || p.text.trim().length === 0) continue;
    out.push({
      id: p.id,
      title: p.title || p.id,
      name,
      mode: p.defaultMode === 'override' ? 'override' : 'append',
      matchLower: p.match.toLowerCase(),
      text: p.text,
    });
  }
  return out;
}

/**
 * 按 modelId 匹配内置条目：别名展开（expandModelIdVariants，先 lowercase）后任一变体
 * 包含 preset 的 match 即命中；多命中取 match 最长者、等长字典序（对齐 matchModelPrompt
 * 的消歧规则）。
 * Match a model id against built-in entries (alias-expanded substring, longest wins).
 *
 * @param {string|null} modelId
 * @returns {{ id: string, name: string, mode: 'override'|'append', text: string } | null}
 */
export function matchBuiltinModelPrompt(modelId) {
  const variants = expandModelIdVariants(modelId);
  if (!variants.length) return null;
  const hits = listBuiltinModelPrompts().filter((e) => variants.some((v) => v.includes(e.matchLower)));
  if (!hits.length) return null;
  hits.sort((a, b) => b.matchLower.length - a.matchLower.length || a.name.localeCompare(b.name));
  const e = hits[0];
  return { id: e.id, name: e.name, mode: e.mode, text: e.text };
}

/**
 * 读某 scope 目录的墓碑名单。目录/文件缺失 → []（良性静默）；文件存在但 JSON 损坏或
 * 形状非法 → console.warn + reportSwallowed 后仍宽容返回 []（fail-open 是刻意的：
 * 墓碑是辅助状态，宁可恢复注入也不因损坏阻断功能——但用户显式 opt-out 被静默逆转
 * 必须有诊断痕迹，三方审查一致要求）。
 * Read a scope dir's tombstone list. Missing dir/file → []; corrupt file → warn +
 * reportSwallowed, still [] (deliberate fail-open, but never silently).
 *
 * @param {string|null|undefined} modelPromptDir
 * @returns {string[]} 规范大写名数组（已排序）
 */
export function readBuiltinDisabled(modelPromptDir) {
  if (!modelPromptDir) return [];
  const target = join(modelPromptDir, BUILTIN_DISABLED_FILE);
  if (!existsSync(target)) return [];
  try {
    const raw = readFileSync(target, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('tombstone file is not a JSON array');
    const names = parsed.map((n) => normalizeModelName(typeof n === 'string' ? n : '')).filter(Boolean);
    return [...new Set(names)].sort();
  } catch (err) {
    console.warn(`[CC Viewer] built-in prompt tombstone ${target} unreadable (${err.message}); treating as no disables`);
    reportSwallowed('builtin-model-prompts.readDisabled', err);
    return [];
  }
}

/**
 * 写墓碑：disabled=true 把 name 加入名单，false 移出。tmp+rename 原子写，数组去重排序。
 * Add/remove a name in a scope dir's tombstone list (atomic tmp+rename write).
 *
 * @param {string} modelPromptDir 目标 scope 的 modelPromptDir（自动 mkdir -p）
 * @param {string} name 条目名（经 normalizeModelName 规范化，非法 throw）
 * @param {boolean} disabled
 * @returns {{ name: string, disabled: boolean, list: string[] }}
 */
export function setBuiltinDisabled(modelPromptDir, name, disabled) {
  if (!modelPromptDir) throw new Error('no target directory');
  const canonical = normalizeModelName(name);
  if (!canonical) throw new Error('invalid model prompt name');
  const list = readBuiltinDisabled(modelPromptDir);
  const next = disabled ? [...new Set([...list, canonical])].sort() : list.filter((n) => n !== canonical);
  mkdirSync(modelPromptDir, { recursive: true });
  const target = join(modelPromptDir, BUILTIN_DISABLED_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  renameSyncWithRetry(tmp, target); // Windows 杀软/索引瞬时 EPERM 重试（与仓库写路径一致）
  return { name: canonical, disabled: !!disabled, list: next };
}

/**
 * 多 scope 合成判断：任一目录的墓碑名单含 name 即视为禁用（workspace 墓碑禁本工作区、
 * global 墓碑全局禁用；对单次启动而言两者都是「该禁」）。
 * Combine tombstones across scopes: disabled when ANY dir's list contains the name.
 *
 * @param {string} name 规范大写名
 * @param {...(string|null|undefined)} modelPromptDirs
 * @returns {boolean}
 */
export function isBuiltinDisabled(name, ...modelPromptDirs) {
  const canonical = normalizeModelName(name);
  if (!canonical) return false;
  return modelPromptDirs.some((dir) => readBuiltinDisabled(dir).includes(canonical));
}

/**
 * 把内置条目文本物化为内容寻址的临时文件（不存在才写，避并发截断；顺手清同 id
 * 旧 hash 文件）。返回文件路径。
 * Materialize a built-in entry's text into a content-addressed temp file.
 *
 * @param {string} id preset id（文件名安全字符校验）
 * @param {string} text renderPresetTemplate 输出（边界已剥离、${...} 字面量保留）
 * @returns {string} 物化文件绝对路径
 */
export function materializeBuiltinPrompt(id, text) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('invalid preset id');
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error('empty preset text');
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 8);
  const fileName = `${id}-${hash}.md`;
  const dir = materializeDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 }); // 仅属主可读写：Linux 多用户 /tmp 下防跨用户预植
  const target = join(dir, fileName);
  // write-if-absent 必须回读校验内容 hash：可预测路径 + 预置恶意文件（hash 可算，
  // preset 文本随包公开）会把注入内容掉包——不一致则覆盖。写入用 tmp+rename 原子落盘，
  // 进程在写中途崩溃留下截断文件时 write-if-absent 永不愈合。
  const writeAtomic = () => {
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, text, 'utf-8');
    renameSyncWithRetry(tmp, target);
  };
  if (!existsSync(target)) {
    writeAtomic();
  } else {
    try {
      const existing = readFileSync(target, 'utf-8');
      if (createHash('sha256').update(existing).digest('hex').slice(0, 8) !== hash) writeAtomic();
    } catch {
      writeAtomic(); // 读失败（截断/权限）→ 覆盖重写
    }
  }
  // best-effort GC：同 id 的旧 hash 文件（版本升级后残留）。精确匹配 8 位 hex hash 防
  // id 前缀误删（如未来 kimi-k3-turbo）；只清 mtime 足够旧的文件，避免跨版本并发
  // （新旧实例同跑）时删掉旧实例正要读的文件。失败无碍。
  try {
    const idRe = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[0-9a-f]{8}\\.md$`);
    for (const f of readdirSync(dir)) {
      if (!idRe.test(f) || f === fileName) continue;
      const p = join(dir, f);
      try {
        if (Date.now() - statSync(p).mtimeMs > 10 * 60_000) rmSync(p, { force: true });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return target;
}
