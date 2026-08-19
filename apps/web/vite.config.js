import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

function getBackendPort() {
  try {
    return parseInt(readFileSync('/tmp/cc-viewer-port', 'utf-8').trim(), 10);
  } catch {
    return 7008;
  }
}

// The published version lives in the aggregator package (packages/app) — @ccv/web
// itself is private and versioned 0.0.0. Single source of truth for __APP_VERSION__.
const pkg = JSON.parse(readFileSync(new URL('../../packages/app/package.json', import.meta.url), 'utf-8'));

export default defineConfig(() => {
  const port = getBackendPort();
  return {
    // CCV_BASE_PATH: deployment base path (determines dist asset reference style at build time).
    //   unset / '' → '' relative (default) — outputs ./assets/...; combined with runtime <base>
    //                  tag, a single dist supports both root deployment and reverse-proxy sub-path
    //                  deployment without source rebuild.
    //   '/prefix/' → build-time hardcoded prefix (assets pinned to this sub-path).
    //   '/' → absolute (escape hatch for the old default; set CCV_BASE_PATH=/ when absolute
    //         /assets/... references are needed).
    // Note: server/lib/base-path.js's normalizeBasePath is not reused here — build-time `base`
    // has different semantics from runtime (here '/' means absolute and unset/'' means relative;
    // at runtime both '/' and unset mean "no prefix").
    base: (() => {
      const v = process.env.CCV_BASE_PATH;
      if (v === undefined) return '';          // default: relative (use CCV_BASE_PATH=/ for absolute)
      if (v === '') return '';                 // relative paths, no trailing slash fixup
      return v.replace(/\/?$/, '/');           // ensure trailing slash
    })(),
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      outDir: 'dist',
      // Enable for local perf / debugging: CCV_SOURCEMAP=1 npm run build (or npm run build:sourcemap).
      // Disabled by default — size + security (don't ship .map with npm; package.json files already
      // includes `!dist/**/*.map` as a safety net). When .map files exist, Chrome DevTools auto-loads
      // them, making antd/cc-viewer stack frames readable (dk/ck → real names + source positions).
      sourcemap: process.env.CCV_SOURCEMAP === '1',
      // xterm.js 6.0.0's InputHandler.requestMode was mis-handled by the identifier mangler,
      // causing a ReferenceError in production builds (issue #5800). Vite's default esbuild
      // minify can't selectively disable identifier mangling (top-level esbuild options only
      // apply to the transform phase, not minify). Switching to terser + mangle:false is
      // the reliable workaround. Gzip size is 15-25% larger than esbuild default; revert to
      // esbuild once xterm 6.1 stable ships with a fix.
      minify: 'terser',
      terserOptions: {
        mangle: false,
        compress: true,
      },
      rollupOptions: {
        output: {
          // Split vendor chunks to avoid bundling antd/highlight/virtuoso/xterm/codemirror
          // into a single 3MB+ block (slows V8 parse, increases GC pressure, breaks cache granularity).
          manualChunks: {
            'vendor-react':      ['react', 'react-dom'],
            'vendor-antd':       ['antd'],
            'vendor-virtuoso':   ['react-virtuoso'],
            'vendor-highlight':  ['highlight.js'],
            'vendor-markdown':   ['marked', 'dompurify'],
            'vendor-qrcode':     ['qrcode.react'],
            'vendor-xterm': [
              '@xterm/xterm',
              '@xterm/addon-fit',
              '@xterm/addon-unicode11',
              '@xterm/addon-web-links',
              '@xterm/addon-webgl',
            ],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@replit/codemirror-minimap',
              '@codemirror/lang-javascript',
              '@codemirror/lang-python',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-go',
              '@codemirror/lang-rust',
              '@codemirror/lang-java',
              '@codemirror/lang-cpp',
              '@codemirror/lang-css',
              '@codemirror/lang-php',
              '@codemirror/lang-sql',
              '@codemirror/lang-xml',
              '@codemirror/lang-yaml',
            ],
            // MDXEditor is loaded via React.lazy only when opening .md files in GUI mode;
            // separate chunk to avoid blocking first-screen load and to distinguish from vendor-codemirror.
            'vendor-mdxeditor': ['@mdxeditor/editor'],
          },
        },
      },
    },
    server: {
      proxy: {
        '/events': `http://127.0.0.1:${port}`,
        '/api': `http://127.0.0.1:${port}`,
        '/ws/terminal': { target: `ws://127.0.0.1:${port}`, ws: true },
      },
    },
  };
});
