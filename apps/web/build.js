#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 执行 vite build，输出到 dist/
// Invoke vite's bin through node without a shell: works under both npm- and
// pnpm-installed node_modules, and is immune to shell-quoting/path-separator
// issues on Windows.
console.log('🔨 正在执行 Vite 构建...');
execFileSync(process.execPath, [join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: __dirname, stdio: 'inherit' });

console.log('✅ Build 完成，输出目录: dist/');
console.log('   - dist/index.html');
console.log('   - dist/assets/');
