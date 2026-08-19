// 随包发布的 ultraplan「预设专家」加载器 —— 扫 `ultraAgents/*.json`，校验后返回给前端。
// 纯 Node 实现，无 React / 浏览器依赖，方便 test/ultra-agents-api.test.js 直接 import。
//
// 安全模型：只读 cc-viewer 包自带的 ULTRA_AGENTS_DIR，文件名由 readdirSync 枚举（不接受
// 请求参数 / 项目目录），故无路径穿越面。文件随包发布属可信内容，但仍做防御性体量限制
// （单文件 ≤256KB、有效专家 ≤100）以免被异常大文件 / 海量文件拖垮端点。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ULTRA_AGENTS_DIR } from '../_paths.js';

// 单文件体量上限：预设专家正文再长也远小于 256KB，超出视为异常文件，跳过。
const MAX_FILE_BYTES = 256 * 1024;
// 有效专家数量上限：防止目录被塞入海量文件导致响应体过大 / 事件循环阻塞。
const MAX_AGENTS = 100;
// agent id 安全字符集：字母数字 . _ -（不含冒号，agent id 不是 plugin 名）。
// id 仅作去重键与前端 key，不参与拼路径，但仍约束格式以保持数据干净。
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

export function validateAgentId(id) {
  if (typeof id !== 'string' || !id) return false;
  if (id.length > 200) return false;
  if (id.startsWith('.')) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) return false;
  return SAFE_ID.test(id);
}

// 文本字段校验：支持「纯字符串」或「{lang: str} 本地化对象」两种合法形态。
//   · 字符串 → trim 后非空即可；
//   · 普通对象（非数组）→ 至少一个值是非空字符串；
//   · 其它（数组 / 数字 / 布尔 / null / 空对象 / 全空串对象）→ 非法。
// title / description 在 JSON 协议层内联本地化(可为对象)，前端按当前语言解析；content 为单语言字符串。
export function isValidTextField(v) {
  if (typeof v === 'string') return v.trim().length > 0;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.values(v).some(x => typeof x === 'string' && x.trim().length > 0);
  }
  return false;
}

// content 专用校验：content 是单语言字符串(不内联本地化,见 README / resolveLocalized 注释)，
// 必须为 trim 后非空的字符串。对象/数组/标量一律非法——否则对象会被前端当字符串渲染成
// `[object Object]`(预览框 / 存入编辑器)。与 isValidTextField 分开,正是为了不放行本地化对象。
export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// 扫描 dir 下所有 *.json，解析 + 校验 + 去重，返回 [{ id, title, description, content }]。
// title/description 原样返回（可能是 {lang: str} 本地化对象），由前端 resolveLocalized 按当前语言解析；
// content 为单语言字符串、原样返回。
// 其它字段（如 version）一律忽略：version 为前向兼容标记、当前不读不校验，
// 未知 key 不报错也不透传，保证前向兼容。
// 任一文件损坏 / 不合法只 console.warn 跳过，绝不抛错中断整体加载。
export function listUltraAgents({ dir = ULTRA_AGENTS_DIR } = {}) {
  if (!existsSync(dir)) return [];
  const out = [];
  const seen = new Set();
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn('[ultra-agents] 读取目录失败，返回空列表:', err?.message);
    return [];
  }
  // 文件名排序，保证「先到先得」去重与跨平台输出顺序稳定。
  const files = entries
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map(e => e.name)
    .sort();

  for (const name of files) {
    if (out.length >= MAX_AGENTS) {
      console.warn(`[ultra-agents] 预设专家数超过上限 ${MAX_AGENTS}，其余忽略`);
      break;
    }
    const filePath = join(dir, name);
    try {
      if (statSync(filePath).size > MAX_FILE_BYTES) {
        console.warn(`[ultra-agents] 文件过大已跳过: ${name}`);
        continue;
      }
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn(`[ultra-agents] 非对象 JSON 已跳过: ${name}`);
        continue;
      }
      if (!validateAgentId(parsed.id)) {
        console.warn(`[ultra-agents] id 非法已跳过: ${name}`);
        continue;
      }
      // title 可内联本地化(字符串或对象)；content 必须是单语言字符串。
      if (!isValidTextField(parsed.title) || !isNonEmptyString(parsed.content)) {
        console.warn(`[ultra-agents] title/content 缺失或非法已跳过: ${name}`);
        continue;
      }
      if (seen.has(parsed.id)) {
        console.warn(`[ultra-agents] id 重复已跳过(先到先得): ${parsed.id} (${name})`);
        continue;
      }
      seen.add(parsed.id);
      out.push({
        id: parsed.id,
        title: parsed.title,
        // description 可选；非法 / 缺失时给空串，前端 resolveLocalized 容错。
        description: isValidTextField(parsed.description) ? parsed.description : '',
        content: parsed.content,
      });
    } catch (err) {
      console.warn(`[ultra-agents] 解析失败已跳过: ${name} (${err?.message})`);
    }
  }
  return out;
}
