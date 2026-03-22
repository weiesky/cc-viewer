import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from '../findcc.js';

export const PLUGINS_DIR = join(LOG_DIR, 'plugins');
const PREFS_FILE = join(LOG_DIR, 'preferences.json');
const SHOULD_LOG = process.env.CCV_DEBUG_PLUGINS === '1';

// Hook 类型定义
const HOOK_TYPES = {
  httpsOptions: 'waterfall',
  localUrl: 'waterfall',
  serverStarted: 'parallel',
  serverStopping: 'parallel',
  onNewEntry: 'parallel',
};

let _plugins = [];

function listPluginEntries() {
  let entries;
  try {
    entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
        out.push({ id: entry.name, absPath: join(PLUGINS_DIR, entry.name) });
      }
      continue;
    }
    if (entry.isDirectory()) {
      const mjsId = `${entry.name}/index.mjs`;
      const jsId = `${entry.name}/index.js`;
      const mjsPath = join(PLUGINS_DIR, mjsId);
      const jsPath = join(PLUGINS_DIR, jsId);
      if (existsSync(mjsPath)) {
        out.push({ id: mjsId, absPath: mjsPath });
      } else if (existsSync(jsPath)) {
        out.push({ id: jsId, absPath: jsPath });
      }
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * 扫描 LOG_DIR/plugins/ 目录，动态 import 每个 .js/.mjs 文件
 */
export async function loadPlugins() {
  _plugins = [];

  if (!existsSync(PLUGINS_DIR)) return;

  // 读取 disabledPlugins 列表
  let disabledPlugins = [];
  try {
    if (existsSync(PREFS_FILE)) {
      const prefs = JSON.parse(readFileSync(PREFS_FILE, 'utf-8'));
      if (Array.isArray(prefs.disabledPlugins)) {
        disabledPlugins = prefs.disabledPlugins;
      }
    }
  } catch { }

  const files = listPluginEntries();
  for (const file of files) {
    try {
      const mod = await import(`file://${file.absPath}`);
      const plugin = mod.default || mod;
      const name = plugin.name || file.id;

      if (disabledPlugins.includes(name)) {
        if (SHOULD_LOG) console.error(`[CC Viewer] Plugin "${name}" is disabled, skipping.`);
        continue;
      }

      if (plugin.hooks && typeof plugin.hooks === 'object') {
        _plugins.push({ name, hooks: plugin.hooks, file: file.id });
        if (SHOULD_LOG) console.error(`[CC Viewer] Plugin loaded: ${name} (${file.id})`);
      }
    } catch (err) {
      if (SHOULD_LOG) console.error(`[CC Viewer] Failed to load plugin "${file.id}":`, err.message);
    }
  }
}

/**
 * waterfall hook：串行管道执行，前一个的返回值传给下一个
 */
export async function runWaterfallHook(name, initialValue) {
  let value = initialValue;
  for (const plugin of _plugins) {
    const hookFn = plugin.hooks[name];
    if (typeof hookFn !== 'function') continue;
    try {
      const result = await hookFn(value);
      if (result != null && typeof result === 'object') {
        value = { ...value, ...result };
      }
    } catch (err) {
      if (SHOULD_LOG) console.error(`[CC Viewer] Plugin "${plugin.name}" hook "${name}" error:`, err.message);
    }
  }
  return value;
}

/**
 * parallel hook：并行通知执行，返回值忽略
 */
export async function runParallelHook(name, context = {}) {
  const tasks = [];
  for (const plugin of _plugins) {
    const hookFn = plugin.hooks[name];
    if (typeof hookFn !== 'function') continue;
    tasks.push(
      Promise.resolve()
        .then(() => hookFn(context))
        .catch(err => {
          if (SHOULD_LOG) console.error(`[CC Viewer] Plugin "${plugin.name}" hook "${name}" error:`, err.message);
        })
    );
  }
  await Promise.all(tasks);
}

/**
 * 返回所有插件文件信息（含已禁用的），供 /api/plugins 使用
 */
export function getPluginsInfo() {
  if (!existsSync(PLUGINS_DIR)) return [];

  let disabledPlugins = [];
  try {
    if (existsSync(PREFS_FILE)) {
      const prefs = JSON.parse(readFileSync(PREFS_FILE, 'utf-8'));
      if (Array.isArray(prefs.disabledPlugins)) {
        disabledPlugins = prefs.disabledPlugins;
      }
    }
  } catch { }

  const files = listPluginEntries();
  return files.map(file => {
    const loaded = _plugins.find(p => p.file === file.id);
    let name = file.id;

    // 如果插件已加载，使用加载时的 name
    if (loaded) {
      name = loaded.name;
    } else {
      // 如果插件未加载（可能被禁用），尝试读取文件获取真实的 name
      try {
        const content = readFileSync(file.absPath, 'utf-8');
        // 简单匹配 name: 'xxx' 或 name: "xxx"
        const match = content.match(/name\s*:\s*['"]([^'"]+)['"]/);
        if (match) {
          name = match[1];
        }
      } catch {
        // 读取失败，使用文件名
      }
    }

    const hooks = loaded ? Object.keys(loaded.hooks) : [];
    const enabled = !disabledPlugins.includes(name);
    return { name, file: file.id, hooks, enabled };
  });
}
