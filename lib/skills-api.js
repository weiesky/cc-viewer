// Skill 动态装卸 API —— 扫描并移动 `.claude/skills/` 和 `.claude/skills-skip/` 之间的 skill 文件夹。
// 纯 Node 实现，无 React / 浏览器 依赖，方便 test/skills-api.test.js 直接 import。

import { existsSync, readdirSync, readFileSync, lstatSync, mkdirSync, renameSync, cpSync, rmSync, realpathSync } from 'node:fs';
import { join, basename, sep, normalize, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

// 10 个 builtin skill（Claude Code 硬编码、本地无文件、不可单独禁用）
// 注意：skill-creator 不在此列——它是 plugin 不是 builtin
const BUILTIN_NAMES = [
  'update-config', 'keybindings-help', 'simplify', 'fewer-permission-prompts',
  'loop', 'schedule', 'claude-api', 'init', 'review', 'security-review',
];

// 严格安全正则：字母数字 . _ - 冒号（plugin:name 形式）
const SAFE_NAME = /^[A-Za-z0-9._:\-]+$/;

export function validateSkillName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.length > 200) return false;
  if (name.startsWith('.')) return false; // 防 .git / .ssh 等 dot 目录
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
  if (!SAFE_NAME.test(name)) return false;
  return true;
}

// 解析 SKILL.md frontmatter 的 description。支持 3 种 YAML 形式：
//   1) description: plain text            ← 单行
//   2) description: "quoted text"         ← 带引号
//   3) description: |                     ← block scalar（保留换行）
//      multi\n line\n content
//   4) description: >                     ← folded scalar（换行折成空格）
// 失败返 null，UI 兜底"无描述"。
function parseSkillMdFrontmatter(skillDir) {
  const mdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(mdPath)) return null;
  try {
    const text = readFileSync(mdPath, 'utf8');
    const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
    if (!m) return null;
    const lines = m[1].split('\n');
    let descIdx = -1, firstVal = '';
    for (let i = 0; i < lines.length; i++) {
      const lm = /^description\s*:\s*(.*)$/.exec(lines[i]);
      if (lm) { descIdx = i; firstVal = lm[1].trim(); break; }
    }
    if (descIdx < 0) return null;

    // block scalar: | / |- / > / >-
    if (/^[|>][-+]?$/.test(firstVal)) {
      const fold = firstVal.startsWith('>');
      const collected = [];
      for (let i = descIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        // 块结束：非空且不以空白字符开头（视为下一个顶级 key）
        if (line !== '' && !/^\s/.test(line)) break;
        collected.push(line.replace(/^\s+/, ''));
      }
      while (collected.length && collected[collected.length - 1] === '') collected.pop();
      return fold ? collected.join(' ') : collected.join('\n');
    }
    // 单行 scalar（去首尾引号）
    return firstVal.replace(/^["']|["']$/g, '');
  } catch { return null; }
}

function scanDir(baseDir, enabled, source) {
  const result = [];
  if (!existsSync(baseDir)) return result;
  try {
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!validateSkillName(entry.name)) continue;
      const dir = join(baseDir, entry.name);
      result.push({
        name: entry.name,
        source,
        enabled,
        path: dir,
        description: parseSkillMdFrontmatter(dir),
      });
    }
  } catch { /* 读目录失败不致命，跳过 */ }
  return result;
}

// 读取 ~/.claude/settings.json 中 `enabledPlugins: {"name@marketplace": true}` 的 key，
// 再到 ~/.claude/plugins/installed_plugins.json 查每个 key 对应的 installPath。
// 返回 [{ pluginKey, installPath }]，只包含**当前启用、且 installPath 真在 ~/.claude/plugins/ 下**的插件。
// installPath 边界校验：即便 installed_plugins.json 被篡改指向系统目录（如 /etc/skills），
// 也因不在 plugins 基目录之下而被剔除，防止 scanPluginSkills 读到敏感文件造成信息泄漏。
// 任一文件缺失 / 无效 JSON 返回空数组（视为没有启用的插件）。
export function readEnabledPluginInstalls({ homeDir = homedir() } = {}) {
  const settingsPath = join(homeDir, '.claude', 'settings.json');
  const pluginsBase = join(homeDir, '.claude', 'plugins');
  const installedPath = join(pluginsBase, 'installed_plugins.json');
  let settings = {};
  let installed = {};
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { return []; }
  try { installed = JSON.parse(readFileSync(installedPath, 'utf8')); } catch { return []; }
  const enabledMap = (settings && typeof settings.enabledPlugins === 'object') ? settings.enabledPlugins : {};
  const pluginsMap = (installed && typeof installed.plugins === 'object') ? installed.plugins : {};
  const result = [];
  const pluginsBasePrefix = pluginsBase + sep;
  for (const [pluginKey, enabled] of Object.entries(enabledMap)) {
    if (enabled !== true) continue;
    const installs = pluginsMap[pluginKey];
    if (!Array.isArray(installs)) continue;
    for (const inst of installs) {
      if (!inst || typeof inst.installPath !== 'string' || !inst.installPath) continue;
      // installPath 必须在 ~/.claude/plugins/ 下（先 normalize 消除 ../ 再做前缀判定，
      // 拒绝绝对路径注入或 ../ 绕过）。不做 realpathSync，因为：
      // (a) 这里只是 gatekeeping，不需要解析 symlink 真身；
      // (b) 不存在的路径 realpathSync 会抛，反而让判定语义复杂。
      const normalized = normalize(inst.installPath);
      if (!isAbsolute(normalized)) continue;
      if (normalized !== pluginsBase && !normalized.startsWith(pluginsBasePrefix)) continue;
      result.push({ pluginKey, installPath: normalized });
    }
  }
  return result;
}

// 精确扫描：只进入当前启用的插件 installPath 下的 `skills/` 子目录，
// 避免把 marketplaces/ 下未安装的模板、或 cache/ 里的历史副本当成启用 skill 误报。
function scanPluginSkills({ homeDir }) {
  const found = [];
  for (const { pluginKey, installPath } of readEnabledPluginInstalls({ homeDir })) {
    const skillsDir = join(installPath, 'skills');
    if (!existsSync(skillsDir)) continue;
    try {
      for (const s of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!s.isDirectory() || !validateSkillName(s.name)) continue;
        const skillPath = join(skillsDir, s.name);
        if (!existsSync(join(skillPath, 'SKILL.md'))) continue;
        found.push({
          name: s.name,
          source: 'plugin',
          enabled: true,
          path: skillPath,
          description: parseSkillMdFrontmatter(skillPath),
          pluginName: pluginKey, // e.g. "skill-creator@claude-plugins-official"
        });
      }
    } catch { /* skip */ }
  }
  return found;
}

export function listSkills({ projectDir = process.cwd(), homeDir = homedir() } = {}) {
  const out = [];
  // user
  out.push(...scanDir(join(homeDir, '.claude', 'skills'), true, 'user'));
  out.push(...scanDir(join(homeDir, '.claude', 'skills-skip'), false, 'user'));
  // project
  out.push(...scanDir(join(projectDir, '.claude', 'skills'), true, 'project'));
  out.push(...scanDir(join(projectDir, '.claude', 'skills-skip'), false, 'project'));
  // plugin（按 settings.json + installed_plugins.json 精确筛选）
  out.push(...scanPluginSkills({ homeDir }));
  // builtin（无 path，为让 UI 展示）
  for (const name of BUILTIN_NAMES) {
    out.push({ name, source: 'builtin', enabled: true, path: null, description: null });
  }
  return out;
}

// 原子性 move：skill 在 skills/ 与 skills-skip/ 之间搬。
// source 必须是 'user' 或 'project'；plugin / builtin 不可 move（上层拒绝）。
// enable=true 表示把 skills-skip/<name> 搬回 skills/<name>；enable=false 反之。
export function moveSkill({ source, name, enable, projectDir = process.cwd(), homeDir = homedir() }) {
  if (!validateSkillName(name)) {
    const err = new Error('invalid_skill_name');
    err.code = 'INVALID_NAME';
    throw err;
  }
  if (source !== 'user' && source !== 'project') {
    const err = new Error('invalid_source');
    err.code = 'INVALID_SOURCE';
    throw err;
  }

  const base = source === 'user'
    ? join(homeDir, '.claude')
    : join(projectDir, '.claude');
  const enabledDir = join(base, 'skills');
  const skipDir = join(base, 'skills-skip');
  const from = enable ? join(skipDir, name) : join(enabledDir, name);
  const to = enable ? join(enabledDir, name) : join(skipDir, name);

  if (!existsSync(from)) {
    const err = new Error('source_not_found');
    err.code = 'SOURCE_MISSING';
    throw err;
  }
  if (existsSync(to)) {
    const err = new Error('destination_exists');
    err.code = 'DEST_CONFLICT';
    throw err;
  }

  // 拒 symlink：from 本身不能是符号链接，防 .claude 被指向系统目录的攻击
  try {
    if (lstatSync(from).isSymbolicLink()) {
      const err = new Error('symlink_rejected');
      err.code = 'SYMLINK';
      throw err;
    }
  } catch (e) {
    if (e.code === 'SYMLINK') throw e;
    // 其它 lstat 错误（如权限）让下面的 rename 暴露出来
  }

  // 确保 skills / skills-skip 存在（首次禁用时 skills-skip 可能没建）
  mkdirSync(enable ? enabledDir : skipDir, { recursive: true });

  // 路径真实性校验：源目录父级必须在 base 之内，防 .. 绕过
  try {
    const realBase = realpathSync(base);
    const realFromParent = realpathSync(enable ? skipDir : enabledDir);
    if (realFromParent !== realBase && !realFromParent.startsWith(realBase + sep)) {
      const err = new Error('path_escape');
      err.code = 'PATH_ESCAPE';
      throw err;
    }
  } catch (e) {
    if (e.code === 'PATH_ESCAPE') throw e;
    // 其它 realpath 错误（如父目录不存在）放过——rename 会抛更精确的错
  }

  try {
    renameSync(from, to);
  } catch (e) {
    if (e.code === 'EXDEV') {
      // 跨设备兜底：cp -r + rm -rf（server.js:1337 已有相似模式）
      cpSync(from, to, { recursive: true });
      rmSync(from, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
}
