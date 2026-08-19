/**
 * 在隔离子进程中提取插件 name，避免不安全的插件代码影响主进程。
 * 用法: node server/lib/extract-plugin-name.mjs <file-path>
 * 输出: JSON { name: string } 到 stdout
 */
import { pathToFileURL } from 'node:url';
const filePath = process.argv[2];
if (!filePath) {
  process.stdout.write(JSON.stringify({ name: '' }));
  process.exit(0);
}
try {
  // Windows 下 `file://${C:\...}` 会产生 `file://C:\...`（无第三个 /、反斜杠未转），
  // pathToFileURL 正确产出 `file:///C:/...`（POSIX 产出 `file:///abs/...`，字符串不同但 ESM 行为等价）。
  const mod = await import(pathToFileURL(filePath).href);
  const plugin = mod.default || mod;
  process.stdout.write(JSON.stringify({ name: plugin.name || '' }));
} catch {
  process.stdout.write(JSON.stringify({ name: '' }));
}
process.exit(0);
