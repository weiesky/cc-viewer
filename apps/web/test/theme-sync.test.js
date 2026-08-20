/**
 * 主题配色三处维护的同步守卫(静态源码断言,不依赖 Electron)。
 *
 * win32 自定义标题栏的配色分散在三处,任一处单独改动都会造成可见色差:
 * - electron/main.js THEME_COLORS:winBg(启动首帧窗口底色)/ barBg+sym(原生窗控 overlay);
 * - electron/tab-bar.html CSS 变量 --bg/--text(tab bar 即标题栏,必须与 overlay 同色);
 * - src/global.css --bg-base(内容区底色,必须与 winBg 同色,否则启动闪色块)。
 * 本测试把三处解析出来逐项对比,漏同步时直接红。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAIN_SRC = readFileSync(join(ROOT, 'apps', 'electron', 'electron', 'main.js'), 'utf-8');
const TABBAR_SRC = readFileSync(join(ROOT, 'apps', 'electron', 'electron', 'tab-bar.html'), 'utf-8');
const GLOBAL_CSS = readFileSync(join(ROOT, 'apps', 'web', 'src', 'global.css'), 'utf-8');

const norm = (c) => String(c).trim().toLowerCase();

// main.js: THEME_COLORS = { dark: { winBg: '...', barBg: '...', sym: '...' }, light: {...} }
function themeColorsOf(theme) {
  const m = MAIN_SRC.match(new RegExp(
    `${theme}:\\s*\\{\\s*winBg:\\s*'([^']+)',\\s*barBg:\\s*'([^']+)',\\s*sym:\\s*'([^']+)'`,
  ));
  assert.ok(m, `THEME_COLORS.${theme} not found in electron/main.js (regex out of sync with source?)`);
  return { winBg: norm(m[1]), barBg: norm(m[2]), sym: norm(m[3]) };
}

// tab-bar.html: :root { --bg: ...; --text: ...; } 与 [data-theme="light"] { ... } 两个块
function tabBarVarsOf(theme) {
  const blockStart = theme === 'light' ? TABBAR_SRC.indexOf('[data-theme="light"]') : TABBAR_SRC.indexOf(':root');
  assert.ok(blockStart >= 0, `tab-bar.html ${theme} block not found`);
  const block = TABBAR_SRC.slice(blockStart, TABBAR_SRC.indexOf('}', blockStart));
  const bg = block.match(/--bg:\s*([^;]+);/);
  const text = block.match(/--text:\s*([^;]+);/);
  assert.ok(bg && text, `--bg/--text not found in tab-bar.html ${theme} block`);
  return { bg: norm(bg[1]), text: norm(text[1]) };
}

// global.css: --bg-base 按出现顺序 = [dark(:root 块), light([data-theme="light"] 块)]
function globalBgBaseOf(theme) {
  const all = [...GLOBAL_CSS.matchAll(/--bg-base:\s*([^;]+);/g)].map((m) => norm(m[1]));
  assert.ok(all.length >= 2, 'expected --bg-base in both dark and light blocks of global.css');
  return theme === 'light' ? all[1] : all[0];
}

for (const theme of ['dark', 'light']) {
  describe(`theme sync — ${theme}`, () => {
    const tc = themeColorsOf(theme);
    it('THEME_COLORS.barBg matches tab-bar.html --bg (native overlay vs tab bar background)', () => {
      assert.equal(tc.barBg, tabBarVarsOf(theme).bg);
    });
    it('THEME_COLORS.sym matches tab-bar.html --text (overlay symbol vs tab bar foreground)', () => {
      assert.equal(tc.sym, tabBarVarsOf(theme).text);
    });
    it('THEME_COLORS.winBg matches global.css --bg-base (first-frame window vs content background)', () => {
      assert.equal(tc.winBg, globalBgBaseOf(theme));
    });
  });
}
