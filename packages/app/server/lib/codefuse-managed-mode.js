import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function isCodeFuseManagedEnvironment({
  env = process.env,
  home = homedir(),
  platform = process.platform,
} = {}) {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  if (!configDir) return false;

  const actual = resolve(configDir);
  const expected = resolve(home, '.codefuse', 'engine', 'cc');

  return platform === 'win32'
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected;
}
