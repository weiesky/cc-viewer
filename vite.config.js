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

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig(() => {
  const port = getBackendPort();
  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      outDir: 'dist',
      // xterm.js 6.0.0 的 InputHandler.requestMode 被 identifier mangler 误处理
      // 导致生产构建抛 ReferenceError（issue #5800）。Vite 默认的 esbuild minify
      // 无法细粒度关闭 identifier mangling（顶层 esbuild 选项只作用于 transform
      // 阶段，不传给 minify），切到 terser + mangle:false 才能真正绕过。体积
      // 比 esbuild 默认大 15-25% gzip，等 xterm 6.1 稳定版修复后可切回 esbuild。
      minify: 'terser',
      terserOptions: {
        mangle: false,
        compress: true,
      },
      rollupOptions: {
        output: {
          // 拆分 vendor chunk，避免 antd/highlight/virtuoso/xterm/codemirror 等被合并
          // 到一个 3MB+ 的单块里（会拖慢 V8 parse、放大 GC 压力、破坏缓存粒度）。
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
            // MDXEditor 仅在打开 .md 文件且 GUI 模式时通过 React.lazy 加载，
            // 单独成 chunk 避免拖累首屏 + 与 vendor-codemirror 区分。
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
