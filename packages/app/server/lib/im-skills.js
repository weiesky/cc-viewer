// IM worker 的内置默认技能注入 —— 每次 worker 启动把随包发布的「manage-ccv-projects」技能
// 受管同步到 IM_<id>/.claude/skills/（或用户已停用时同步到 skills-skip/）。
// 对比 server/lib/im-append-system.js（人格预置）：那边是 wx「永不覆盖」尊重用户编辑；本模块是「受管同步」包内为准、覆盖内容。
//
// 受管语义（本轮决策）：
//  - 内容以包内最新版为准：每次启动覆盖 SKILL.md + scripts/ccv-projects.mjs（随升级更新；用户手改会被覆盖）。
//  - 尊重「停用」：若该技能已被用户挪到 skills-skip/，只在那儿同步内容，不挪回 skills/（不强行重新启用）。
//  - 删除后会再生成：skills/ 与 skills-skip/ 都没有时重新种入 skills/（内置默认件语义）。
//  - 语言：按 LOG_DIR/preferences.json 的 lang 选 server/imSkills/<lang>/，目录缺失则回退 zh。
//
// 写入走 temp + renameSyncWithRetry（与 im-lock / file-api / saveWorkspaces 一致），Windows 上避免半写/占用。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { IM_SKILLS_DIR } from '../_paths.js';
import { imDir } from './im-lock.js';
import { renameSyncWithRetry } from './file-api.js';
import { resolvePrefLang } from './im-lang.js';

export const BUILTIN_SKILL_NAME = 'manage-ccv-projects';
const DEFAULT_LANG = 'zh';

/** 读用户 UI 语言（LOG_DIR/preferences.json 的 lang）；读不到 / 无字段一律回退 zh。委托共享解析器。 */
export function resolveSkillLang() {
  return resolvePrefLang(DEFAULT_LANG);
}

// 内容一致则跳过；不一致则原子覆盖写。返回是否实际写入。
function syncFile(srcPath, destPath) {
  const data = readFileSync(srcPath);
  try {
    if (readFileSync(destPath).equals(data)) return false; // 已是最新，免写、免动 mtime
  } catch { /* dest 不存在或读失败 → 继续写 */ }
  mkdirSync(dirname(destPath), { recursive: true });
  const tmp = `${destPath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, data);
  renameSyncWithRetry(tmp, destPath);
  return true;
}

/**
 * 受管同步内置默认技能到某个 IM worker 工作目录。
 * @param {string} id 平台 id（dingtalk/feishu/wecom/discord）
 * @param {string} [dir] IM 工作目录（默认 imDir(id)；测试可覆盖）
 * @param {object} [opts] 注入点（主要给单测用）
 * @param {string} [opts.lang] 强制语言；否则读 preferences.json 的 lang，目录缺失回退 zh
 * @param {string} [opts.sourceRoot] 源根目录（默认 IM_SKILLS_DIR）
 * @returns {{ skill: string, targetDir: string|null, changed: boolean, reason?: string }}
 *   changed=是否实际写盘；reason='source-missing' 仅当包内源缺失（安全跳过、不抛错）。
 *   失败不致命：调用方 cli.js runImMode 已 try/catch 仅告警，worker 仍正常启动。
 */
export function ensureImBuiltinSkills(id, dir = imDir(id), opts = {}) {
  const sourceRoot = opts.sourceRoot || IM_SKILLS_DIR;
  const wantLang = opts.lang || resolveSkillLang();
  // 语言目录存在 = 该语言已提供母本（每语言目录下仅 <skill>/SKILL.md，故以"该目录是否存在"作为语言受支持判据）；缺失则安全回退 zh。
  const lang = existsSync(join(sourceRoot, wantLang, BUILTIN_SKILL_NAME)) ? wantLang : DEFAULT_LANG;

  const srcSkillMd = join(sourceRoot, lang, BUILTIN_SKILL_NAME, 'SKILL.md');
  const srcScript = join(sourceRoot, 'scripts', 'ccv-projects.mjs');
  if (!existsSync(srcSkillMd)) {
    return { skill: BUILTIN_SKILL_NAME, targetDir: null, changed: false, reason: 'source-missing' };
  }

  const enabledDir = join(dir, '.claude', 'skills', BUILTIN_SKILL_NAME);
  const disabledDir = join(dir, '.claude', 'skills-skip', BUILTIN_SKILL_NAME);
  // 尊重「停用」：已在 skills-skip/ 就只同步那儿；否则默认装到（启用的）skills/。
  const targetDir = existsSync(disabledDir) ? disabledDir : enabledDir;

  let changed = false;
  if (syncFile(srcSkillMd, join(targetDir, 'SKILL.md'))) changed = true;
  if (existsSync(srcScript) && syncFile(srcScript, join(targetDir, 'scripts', 'ccv-projects.mjs'))) changed = true;

  return { skill: BUILTIN_SKILL_NAME, targetDir, changed };
}
