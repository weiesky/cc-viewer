/**
 * Node ESM loader hook：把裸 `antd` import 替换成一个最小 `message` stub，
 * 让 node:test 能加载前端模块（如 skillModalController.js）而无需拉起真实 antd（依赖 DOM/React）。
 *
 * 用法（测试文件里，需在动态 import 目标模块之前 register）：
 *   import { register } from 'node:module';
 *   register('./_shims/vite-loader.mjs', import.meta.url); // 处理无扩展名 / 资源 import
 *   register('./_shims/antd-stub.mjs', import.meta.url);   // 处理 'antd'
 *   const mod = await import('../src/utils/skillModalController.js');
 *
 * stub 的 message 方法是 no-op；测试断言状态变化而非 toast 文案。其它 specifier 透传给链上 nextResolve。
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'antd') {
    const src =
      'export const message = { error: () => {}, success: () => {}, warning: () => {}, info: () => {} };\n' +
      'export default { message };';
    return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
