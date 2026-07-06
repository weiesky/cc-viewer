/**
 * 在隔离子进程中提取插件 name，避免不安全的插件代码影响主进程。
 * 用法: node lib/extract-plugin-name.mjs <file-path>
 * 输出: JSON { name: string } 到 stdout
 */
const filePath = process.argv[2];
if (!filePath) {
  process.stdout.write(JSON.stringify({ name: '' }));
  process.exit(0);
}
try {
  const mod = await import(`file://${filePath}`);
  const plugin = mod.default || mod;
  process.stdout.write(JSON.stringify({ name: plugin.name || '' }));
} catch {
  process.stdout.write(JSON.stringify({ name: '' }));
}
process.exit(0);
