/**
 * Unit tests for src/utils/commandValidator.js
 *
 * 覆盖 isMutatingCommand 的判定边界。该正则被 ChatView 的文件浏览器/Git 面板
 * 自动刷新机制依赖（Bash 路径），新增 rmdir / unlink / find -delete 后必须保证：
 * - 真实的删除/创建/修改命令仍然命中
 * - 同名子串（如 `find . -name x` 不带 -delete）不误命中
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMutatingCommand, isImageFile } from '../src/utils/commandValidator.js';

describe('isMutatingCommand — delete family', () => {
  it('matches rm and rm -rf', () => {
    assert.equal(isMutatingCommand('rm file.txt'), true);
    assert.equal(isMutatingCommand('rm -rf node_modules'), true);
    assert.equal(isMutatingCommand('rm -f /tmp/lock'), true);
  });

  it('matches rmdir (newly added)', () => {
    assert.equal(isMutatingCommand('rmdir empty_dir'), true);
    assert.equal(isMutatingCommand('rmdir -p a/b/c'), true);
  });

  it('matches unlink (newly added)', () => {
    assert.equal(isMutatingCommand('unlink some.txt'), true);
  });

  it('matches find ... -delete (newly added)', () => {
    assert.equal(isMutatingCommand('find . -name "*.log" -delete'), true);
    assert.equal(isMutatingCommand('find /tmp -mtime +7 -delete'), true);
  });

  it('does NOT match find without -delete', () => {
    assert.equal(isMutatingCommand('find . -name "*.log"'), false);
    assert.equal(isMutatingCommand('find . -type f'), false);
  });

  it('does NOT match -delete in unrelated context (no find on left side of pipe)', () => {
    // 管道左侧 find 没 -delete，右侧出现 -delete 字面量也不该跨管道命中
    assert.equal(isMutatingCommand('grep find . | echo "-delete"'), false);
  });
});

describe('isMutatingCommand — create / move / metadata', () => {
  it('matches mkdir / mv / cp / touch / ln', () => {
    assert.equal(isMutatingCommand('mkdir new_dir'), true);
    assert.equal(isMutatingCommand('mv a.txt b.txt'), true);
    assert.equal(isMutatingCommand('cp src dst'), true);
    assert.equal(isMutatingCommand('touch new.txt'), true);
    assert.equal(isMutatingCommand('ln -s target link'), true);
  });

  it('matches chmod / chown', () => {
    assert.equal(isMutatingCommand('chmod 755 file'), true);
    assert.equal(isMutatingCommand('chown user:group file'), true);
  });
});

describe('isMutatingCommand — git mutating subset', () => {
  it('matches git checkout / reset / stash / merge / rebase / cherry-pick / restore / clean / rm', () => {
    assert.equal(isMutatingCommand('git checkout main'), true);
    assert.equal(isMutatingCommand('git reset --hard HEAD'), true);
    assert.equal(isMutatingCommand('git stash pop'), true);
    assert.equal(isMutatingCommand('git merge feature'), true);
    assert.equal(isMutatingCommand('git rebase main'), true);
    assert.equal(isMutatingCommand('git cherry-pick abc123'), true);
    assert.equal(isMutatingCommand('git restore .'), true);
    assert.equal(isMutatingCommand('git clean -fd'), true);
    assert.equal(isMutatingCommand('git rm tracked.txt'), true);
  });

  it('does NOT match read-only git commands', () => {
    assert.equal(isMutatingCommand('git status'), false);
    assert.equal(isMutatingCommand('git log --oneline'), false);
    assert.equal(isMutatingCommand('git diff'), false);
    assert.equal(isMutatingCommand('git branch -a'), false);
    assert.equal(isMutatingCommand('git show HEAD'), false);
  });
});

describe('isMutatingCommand — package managers / archives / network', () => {
  it('matches npm / yarn / pnpm install or remove', () => {
    assert.equal(isMutatingCommand('npm install lodash'), true);
    assert.equal(isMutatingCommand('npm uninstall lodash'), true);
    assert.equal(isMutatingCommand('npm ci'), true);
    assert.equal(isMutatingCommand('yarn add react'), true);
    assert.equal(isMutatingCommand('yarn remove react'), true);
    assert.equal(isMutatingCommand('pnpm add zod'), true);
    assert.equal(isMutatingCommand('pnpm install'), true);
  });

  it('matches pip install / tar / unzip / curl -o / wget', () => {
    assert.equal(isMutatingCommand('pip install requests'), true);
    assert.equal(isMutatingCommand('tar -xzf bundle.tgz'), true);
    assert.equal(isMutatingCommand('unzip archive.zip'), true);
    assert.equal(isMutatingCommand('curl -o local.bin https://example.com/x'), true);
    assert.equal(isMutatingCommand('wget https://example.com/file'), true);
  });
});

describe('isMutatingCommand — redirection writes', () => {
  it('matches > and >> for stdout writes', () => {
    assert.equal(isMutatingCommand('echo hi > out.txt'), true);
    assert.equal(isMutatingCommand('echo hi >> out.txt'), true);
  });

  it('does NOT match stdout-only commands without redirect', () => {
    assert.equal(isMutatingCommand('echo hello'), false);
    assert.equal(isMutatingCommand('cat file.txt'), false);
    assert.equal(isMutatingCommand('grep foo file'), false);
    assert.equal(isMutatingCommand('ls -la'), false);
  });
});

describe('isMutatingCommand — known trade-offs (over-match acceptable)', () => {
  // ⚠️ 维护者注意：以下用例是**设计取舍**，不是 bug。
  // \b 单词边界无法区分"作为命令"还是"作为参数/字面量"，所以包含 unlink/rm 等词的字符串
  // 会被识别为 mutating。文件浏览器额外刷新成本 <1ms（一次本地 fetch），宁可多刷不漏刷。
  // 删除以下用例前请：
  //   1) 确认正则改动未把"真实删除命令"也排除掉
  //   2) 阅读 src/utils/commandValidator.js MUTATING_CMD_RE JSDoc 中的 trade-off 说明
  //   3) 在 PR 描述里说明你修复的是哪种 false positive，以及覆盖率没回退
  it('over-matches when delete keywords appear as arguments (acceptable)', () => {
    // `echo unlink` 实际只是输出一个字符串，但 \bunlink\b 仍命中
    assert.equal(isMutatingCommand('echo unlink'), true);
  });

  it('handles empty input safely', () => {
    assert.equal(isMutatingCommand(''), false);
  });

  it('does not crash on unusual inputs', () => {
    // 仅断言不抛异常即可
    assert.doesNotThrow(() => isMutatingCommand('a'.repeat(1000)));
    assert.doesNotThrow(() => isMutatingCommand('find ' + 'x '.repeat(500) + '-delete'));
  });
});

describe('isImageFile', () => {
  it('detects common image extensions', () => {
    assert.equal(isImageFile('logo.png'), true);
    assert.equal(isImageFile('photo.jpg'), true);
    assert.equal(isImageFile('icon.svg'), true);
    assert.equal(isImageFile('animated.webp'), true);
  });

  it('rejects non-image files', () => {
    assert.equal(isImageFile('readme.md'), false);
    assert.equal(isImageFile('script.js'), false);
    assert.equal(isImageFile('archive.zip'), false);
  });

  it('handles uppercase and missing extensions', () => {
    assert.equal(isImageFile('LOGO.PNG'), true);
    assert.equal(isImageFile('Makefile'), false);
  });
});
