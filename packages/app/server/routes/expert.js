// Expert settings routes — 读/写「当前工作区」的系统文本 sentinel 文件
// (CC_SYSTEM.md / CC_APPEND_SYSTEM.md)，对应偏好设置 → 专家设置 → 系统文本修改。
// 这两个文件由 pty-manager._spawnClaudeImpl 在启动 claude 时自动注入为
// --system-prompt-file / --append-system-prompt-file（见 server/lib/system-prompt-files.js）。
// 另有「按模型定制」条目(/api/expert/model-prompts)：工作区 <ws>/system_prompt/ 与
// 全局 <LOG_DIR>/system_prompt/ 两套目录，见 server/lib/model-system-prompts.js。
// 鉴权沿用 dispatch 之前的全局鉴权（与 files-fs 写操作一致，不额外 gate isLocal）。
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  readWorkspaceSystemText, writeWorkspaceSystemText,
  isNonEmptyFile, SYSTEM_PROMPT_FILE, APPEND_SYSTEM_PROMPT_FILE, DISABLE_AUTO_SYSTEM_PROMPT_ENV,
} from '../lib/system-prompt-files.js';
import {
  MODEL_PROMPT_DIR, normalizeModelName, listModelPrompts,
  writeModelPrompt, deleteModelPrompt, matchModelPrompt,
} from '../lib/model-system-prompts.js';
import { resolveSpawnModel } from '../lib/spawn-model-resolver.js';
import { listSystemPromptPresets, groupPresetsByCategory, getSystemPromptVariablesDoc } from '../lib/system-prompt-presets.js';
import { LOG_DIR } from '../../findcc.js';

// 当前工作区目录全部由服务端解析（绝不接收客户端路径 → 无遍历面）：
//   运行中/最近一次 claude 的 cwd > CCV_PROJECT_DIR > （仅非工作区模式才回退 process.cwd()）
// 工作区模式下若无活动会话则返回 null —— 避免误写服务器自身目录。
async function resolveDir(deps) {
  let cwd = null;
  try {
    const { getCurrentWorkspace } = await import('../pty-manager.js');
    cwd = getCurrentWorkspace()?.cwd || null;
  } catch { /* pty-manager 不可用时走回退链 */ }
  if (cwd) return cwd;
  if (process.env.CCV_PROJECT_DIR) return process.env.CCV_PROJECT_DIR;
  return deps.isWorkspaceMode ? null : process.cwd();
}

function sendJson(res, code, obj) {
  if (res.headersSent) return;
  try {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  } catch { /* socket 已关闭：忽略 */ }
}

// Single source for "is a custom system prompt configured to inject" — mirrors the
// spawn-time injection semantics of buildSystemPromptFileArgs: the env kill switch wins;
// a matched model entry supersedes the Default sentinels for activation purposes.
// Fidelity note: spawn-only gates this helper cannot see (insideLogDir skip, manual
// --system-prompt-file flags, one-shot skip tokens) may rarely make "active" a false
// positive — acceptable for a UI hint.
function computeSystemPromptStatus(dir) {
  if (process.env[DISABLE_AUTO_SYSTEM_PROMPT_ENV] === '1') {
    return { active: false, modelId: null, matched: null, defaultActive: false };
  }
  const defaultActive = !!dir && (
    isNonEmptyFile(join(dir, SYSTEM_PROMPT_FILE)) || isNonEmptyFile(join(dir, APPEND_SYSTEM_PROMPT_FILE))
  );
  const modelId = resolveSpawnModel(dir, process.env);
  const match = modelId
    ? matchModelPrompt(modelId, [
        { dir: dir ? join(dir, MODEL_PROMPT_DIR) : null, scope: 'workspace' },
        { dir: join(LOG_DIR, MODEL_PROMPT_DIR), scope: 'global' },
      ])
    : null;
  const matched = match ? { scope: match.scope, name: match.name, mode: match.mode } : null;
  return { active: !!matched || defaultActive, modelId, matched, defaultActive };
}

async function getSystemText(req, res, parsedUrl, isLocal, deps) {
  try {
    const dir = await resolveDir(deps);
    const { mode, text } = readWorkspaceSystemText(dir);
    sendJson(res, 200, { dir: dir || null, active: !!dir, mode, text });
  } catch (e) {
    // 原始 fs 错误只落服务端日志，对外返回通用错误码(不外泄绝对路径/系统细节)。
    console.error('[CC Viewer] expert system-text GET failed:', e.message);
    sendJson(res, 500, { error: 'read_failed' });
  }
}

function postSystemText(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  let truncated = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > deps.MAX_POST_BODY) { truncated = true; req.destroy(); }
  });
  req.on('end', async () => {
    if (truncated) return; // 超限已 destroy，socket 关闭，勿再解析/回包(对齐 events.js turnEndNotify)
    try {
      const { mode, text } = JSON.parse(body || '{}');
      const dir = await resolveDir(deps);
      if (!dir) { sendJson(res, 400, { error: 'no_active_workspace' }); return; }
      const result = writeWorkspaceSystemText(
        dir,
        mode === 'override' ? 'override' : 'append',
        typeof text === 'string' ? text : '',
      );
      sendJson(res, 200, { ok: true, dir, ...result });
    } catch (e) {
      // 坏 JSON / 写入失败等：原始错误只落服务端日志，对外返回通用错误码。
      console.error('[CC Viewer] expert system-text POST failed:', e.message);
      sendJson(res, 500, { error: 'write_failed' });
    }
  });
}

// 列出某目录全部模型条目并内联文本(条目数很小，一次返回免去 N 次跟进请求)。
// 直接读 listModelPrompts 给出的生效文件，避免 readModelPrompt 每条目重扫目录(N+1)。
function collectModelEntries(dir) {
  if (!dir) return [];
  return listModelPrompts(dir)
    .map((e) => {
      try {
        return { name: e.name, mode: e.mode, text: readFileSync(join(dir, e.fileName), 'utf-8') };
      } catch {
        return null; // 列表后被并发删除等：跳过该条目
      }
    })
    .filter(Boolean);
}

async function getModelPrompts(req, res, parsedUrl, isLocal, deps) {
  try {
    const dir = await resolveDir(deps);
    const globalDir = join(LOG_DIR, MODEL_PROMPT_DIR);
    const status = computeSystemPromptStatus(dir);
    sendJson(res, 200, {
      workspaceDir: dir || null,
      workspaceActive: !!dir,
      globalDir,
      workspace: dir ? collectModelEntries(join(dir, MODEL_PROMPT_DIR)) : [],
      global: collectModelEntries(globalDir),
      // 当前生效配置解析出的模型 id 及其命中的条目(未命中为 null)——弹窗据此把默认页签
      // 指向命中条目；matched.name 为规范化大写名，与页签 key 的构成一致。
      modelId: status.modelId,
      matched: status.matched,
    });
  } catch (e) {
    console.error('[CC Viewer] expert model-prompts GET failed:', e.message);
    sendJson(res, 500, { error: 'read_failed' });
  }
}

// 轻量状态查询(不内联提示词文本)：头部工具栏据此决定是否自动露出「系统提示词修改」入口。
async function getSystemPromptStatus(req, res, parsedUrl, isLocal, deps) {
  try {
    const dir = await resolveDir(deps);
    sendJson(res, 200, computeSystemPromptStatus(dir));
  } catch (e) {
    console.error('[CC Viewer] expert system-prompt-status GET failed:', e.message);
    sendJson(res, 500, { error: 'read_failed' });
  }
}

function postModelPrompts(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  let truncated = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > deps.MAX_POST_BODY) { truncated = true; req.destroy(); }
  });
  req.on('end', async () => {
    if (truncated) return; // 超限已 destroy，socket 关闭，勿再解析/回包(对齐 postSystemText)
    try {
      const { scope, name, mode, text } = JSON.parse(body || '{}');
      if (scope !== 'workspace' && scope !== 'global') {
        sendJson(res, 400, { error: 'bad_scope' });
        return;
      }
      const canonical = normalizeModelName(name);
      if (!canonical) { sendJson(res, 400, { error: 'bad_model_name' }); return; }
      let targetDir;
      if (scope === 'global') {
        targetDir = join(LOG_DIR, MODEL_PROMPT_DIR);
      } else {
        const dir = await resolveDir(deps);
        if (!dir) { sendJson(res, 400, { error: 'no_active_workspace' }); return; }
        targetDir = join(dir, MODEL_PROMPT_DIR);
      }
      const raw = typeof text === 'string' ? text : '';
      if (raw.trim().length === 0) {
        // 空文本 = 删除条目(对齐 system-text 的「存空即禁用」约定；此时 mode 可缺省)。
        deleteModelPrompt(targetDir, canonical);
        sendJson(res, 200, { ok: true, name: canonical, scope, cleared: true });
        return;
      }
      const result = writeModelPrompt(targetDir, canonical, mode === 'override' ? 'override' : 'append', raw);
      sendJson(res, 200, { ok: true, scope, ...result });
    } catch (e) {
      console.error('[CC Viewer] expert model-prompts POST failed:', e.message);
      sendJson(res, 500, { error: 'write_failed' });
    }
  });
}

// 内置系统提示词预设（server/system-prompt-templates/presets/*）：只读，返回可直接回填编辑器的原始模板文本
// （占位符保持字面量，不做变量替换），供「+ 添加模型」时按名称匹配/下拉选择预填。
function getSystemPromptPresets(req, res, parsedUrl, isLocal, deps) {
  try {
    // Optional UI-language hint for the variables doc. parsedUrl may be null in
    // direct handler invocations (tests); the value is whitelisted downstream.
    const lang = parsedUrl?.searchParams?.get('lang') || undefined;
    const presets = listSystemPromptPresets();
    sendJson(res, 200, {
      presets,
      categories: groupPresetsByCategory(presets),
      variablesDoc: getSystemPromptVariablesDoc(lang),
    });
  } catch (e) {
    console.error('[CC Viewer] expert system-prompt-presets GET failed:', e.message);
    sendJson(res, 500, { error: 'read_failed' });
  }
}

export const expertRoutes = [
  { method: 'GET', match: 'exact', path: '/api/expert/system-text', handler: getSystemText },
  { method: 'POST', match: 'exact', path: '/api/expert/system-text', handler: postSystemText },
  { method: 'GET', match: 'exact', path: '/api/expert/model-prompts', handler: getModelPrompts },
  { method: 'POST', match: 'exact', path: '/api/expert/model-prompts', handler: postModelPrompts },
  { method: 'GET', match: 'exact', path: '/api/expert/system-prompt-presets', handler: getSystemPromptPresets },
  { method: 'GET', match: 'exact', path: '/api/expert/system-prompt-status', handler: getSystemPromptStatus },
];
