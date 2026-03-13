import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Get git diffs for a list of files.
 * @param {string} cwd - working directory (git repo root)
 * @param {string[]} files - relative file paths
 * @returns {Promise<Array>} diffs array
 */
export async function getGitDiffs(cwd, files) {
  const diffs = [];

  for (const file of files) {
    // 安全检查：防止路径穿越
    if (file.includes('..') || file.startsWith('/')) continue;

    try {
      const { stdout: statusOutput } = await execFileAsync('git', ['status', '--porcelain', '--', file], { cwd, encoding: 'utf-8', timeout: 3000 });
      if (!statusOutput.trim()) continue;

      const status = statusOutput.substring(0, 2).trim();
      const is_new = status === 'A' || status === '??';
      const is_deleted = status === 'D';

      // 检查是否为二进制文件（已删除文件跳过）
      let is_binary = false;
      if (!is_deleted) {
        try {
          const { stdout: diffCheck } = await execFileAsync('git', ['diff', '--numstat', 'HEAD', '--', file], { cwd, encoding: 'utf-8', timeout: 3000 });
          if (diffCheck.includes('-\t-\t')) {
            is_binary = true;
          }
        } catch {}
      }

      let old_content = '';
      let new_content = '';

      if (!is_binary) {
        // 获取旧内容（HEAD 版本）
        if (!is_new) {
          try {
            const { stdout } = await execFileAsync('git', ['show', `HEAD:${file}`], { cwd, encoding: 'utf-8', timeout: 5000, maxBuffer: 5 * 1024 * 1024 });
            old_content = stdout;
          } catch {
            old_content = '';
          }
        }

        // 获取新内容（工作区版本）
        if (!is_deleted) {
          try {
            const filePath = join(cwd, file);
            if (existsSync(filePath)) {
              const stat = statSync(filePath);
              if (stat.size > 5 * 1024 * 1024) {
                // 文件过大
                diffs.push({ file, status, is_large: true, size: stat.size });
                continue;
              }
              new_content = readFileSync(filePath, 'utf-8');
            }
          } catch {
            new_content = '';
          }
        }
      }

      diffs.push({
        file,
        status,
        old_content,
        new_content,
        is_binary,
        is_new,
        is_deleted
      });
    } catch (err) {
      // 跳过无法处理的文件
      continue;
    }
  }

  return diffs;
}
