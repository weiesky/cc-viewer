/**
 * 注册 vite-loader.mjs 的 module hooks。
 * 测试文件先 `import './_shims/register.mjs'`，再用【动态 import】加载目标模块。
 */
import { register } from 'node:module';

register('./vite-loader.mjs', import.meta.url);
