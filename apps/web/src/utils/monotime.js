/**
 * 单调毫秒时钟：performance.now 优先（单调、亚毫秒），无则回退 Date.now
 * （node:test / 老环境）。promptDetect 与 terminalWriteQueue 共用，
 * 单一实现避免拷贝漂移。
 */
export const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
