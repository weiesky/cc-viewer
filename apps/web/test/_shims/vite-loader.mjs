/**
 * Node ESM loader hooks，让 node:test 能直接 import 走 Vite 约定的前端模块：
 *  1. 资源 import（.svg / .png / .css，含 ?raw / ?url 查询后缀）→ 字符串 stub
 *     （stub 内容编码资源文件名，保证不同资源的 stub 可区分）
 *  2. 无扩展名相对 import（Vite 允许 `./contentFilter`）→ 自动补 `.js`
 *
 * 用法（测试文件里）：
 *   import './_shims/register.mjs';
 *   const mod = await import('../src/utils/helpers.js'); // 必须用动态 import
 *
 * 注意：目标模块必须用动态 import —— 静态 import 在 register() 生效前就会解析。
 * 本文件被 node --test 直接执行时是空测试（✔ 0 tests），无副作用。
 */
const ASSET_RE = /\.(svg|png|jpe?g|gif|webp|ico|css|woff2?|ttf|eot|mp3|wav|ogg)$/i;

export async function resolve(specifier, context, nextResolve) {
  const qIdx = specifier.indexOf('?');
  const bare = qIdx === -1 ? specifier : specifier.slice(0, qIdx);

  if (ASSET_RE.test(bare)) {
    const name = bare.split('/').pop();
    const src = `export default ${JSON.stringify(`__ccv_asset_stub__:${name}`)};`;
    return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
  }

  // Vite 风格无扩展名相对路径：优先尝试补 .js，失败回落原样解析
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[^/.]+$/.test(bare)) {
    try {
      return await nextResolve(`${bare}.js`, context);
    } catch {
      // fall through
    }
  }

  return nextResolve(specifier, context);
}
