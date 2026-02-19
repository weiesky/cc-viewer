#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 执行 vite build，输出到 dist/
console.log('🔨 正在执行 Vite 构建...');
execSync('npx vite build', { cwd: __dirname, stdio: 'inherit' });

console.log('✅ Build 完成，输出目录: dist/');
console.log('   - dist/index.html');
console.log('   - dist/assets/');
