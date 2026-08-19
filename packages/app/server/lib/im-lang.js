// IM worker 的语言解析 —— 读用户在 UI 选择的语言（持久化在 LOG_DIR/preferences.json 的 lang 字段）。
// 供 IM 内置技能注入（im-skills.js）与人格预置（im-append-system.js）共用，避免各自重复读 preferences。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from '../../findcc.js';

/** 读 preferences.lang；读不到 / 无字段 / 解析失败一律回退 def（默认 zh）。 */
export function resolvePrefLang(def = 'zh') {
  try {
    const prefs = JSON.parse(readFileSync(join(LOG_DIR, 'preferences.json'), 'utf-8'));
    const lang = typeof prefs.lang === 'string' ? prefs.lang.trim() : '';
    return lang || def;
  } catch {
    return def;
  }
}
