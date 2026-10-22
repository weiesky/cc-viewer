// Panel bundle builder: bundles src/Panel.jsx into panel/index.js as a single IIFE.
//
// The critical piece is the shared-deps shim: imports of react / react-dom / antd (and
// any deep import like antd/es/button) are rewritten to read from window.CCV.deps at
// runtime, so the panel never bundles a second copy of React (which would break hooks
// with "Invalid hook call") or antd (which would disconnect it from the host's theme).
//
// Do NOT use esbuild's `external` for these packages — in IIFE format externals compile
// to __require("react") which does not exist in the browser.
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const manifest = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf-8'));
if (!manifest.name) throw new Error('plugin.json must declare a name');

// Map any react/react-dom/antd specifier (exact or deep import) to a virtual module that
// re-exports window.CCV.deps.* in CJS form — esbuild compiles named imports from CJS into
// property accesses, which covers every export without an export-name allowlist.
function sharedDepsPlugin() {
  return {
    name: 'ccv-shared-deps',
    setup(b) {
      const MAP = [
        { re: /^react$/, key: 'React' },
        { re: /^react-dom$/, key: 'ReactDOM' },
        { re: /^react-dom\/client$/, key: 'ReactDOMClient' },
        { re: /^react\/jsx-runtime$/, key: 'ReactJsxRuntime' },
        { re: /^react\/jsx-dev-runtime$/, key: 'ReactJsxDevRuntime' },
        { re: /^antd($|\/)/, key: 'antd' },
      ];
      b.onResolve({ filter: /^(react|react-dom|antd)($|\/)/ }, (args) => {
        const hit = MAP.find(m => m.re.test(args.path));
        if (!hit) {
          return {
            errors: [{
              text: `unsupported shared import "${args.path}" — import { X } from 'antd' instead of deep antd paths, or bundle this dependency yourself`,
            }],
          };
        }
        return { path: `ccv-shared:${hit.key}`, namespace: 'ccv-shared' };
      });
      b.onLoad({ filter: /.*/, namespace: 'ccv-shared' }, (args) => {
        const key = args.path.slice('ccv-shared:'.length);
        return {
          contents: `module.exports = window.CCV.deps[${JSON.stringify(key)}];`,
          loader: 'js',
        };
      });
    },
  };
}

const options = {
  entryPoints: [join(here, 'src', 'Panel.jsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    __CCV_PANEL_NAME__: JSON.stringify(manifest.name),
  },
  outfile: join(here, 'panel', 'index.js'),
  plugins: [sharedDepsPlugin()],
  logLevel: 'info',
};

mkdirSync(join(here, 'panel'), { recursive: true });

if (watch) {
  const { context } = await import('esbuild');
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build-panel] watching…');
} else {
  await build(options);
  console.log(`[build-panel] wrote panel/index.js for "${manifest.name}"`);
}
