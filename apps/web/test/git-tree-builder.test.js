/**
 * src/utils/gitTreeBuilder.js 单元测试。
 *
 * 覆盖 buildGitTree：
 *   - 扁平变更列表 → 嵌套目录树
 *   - 尾斜杠的目录占位被跳过（旧 server 行为防御）
 *   - 空/缺失 file 字段被跳过
 *   - 前导斜杠 / 连续斜杠经 filter(Boolean) 归一
 *   - 同目录多文件、深层嵌套、根级文件
 *   - status / fullPath 原样透传
 *
 * 依赖链干净（无 Vite 语法），直接静态 import。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildGitTree } from '../src/utils/gitTreeBuilder.js';

describe('buildGitTree', () => {
  it('空数组返回空根节点', () => {
    const tree = buildGitTree([]);
    assert.deepEqual(tree, { dirs: {}, files: [] });
  });

  it('根级单文件进入 root.files，携带 name/status/fullPath', () => {
    const tree = buildGitTree([{ file: 'README.md', status: 'M' }]);
    assert.deepEqual(tree.dirs, {});
    assert.equal(tree.files.length, 1);
    assert.deepEqual(tree.files[0], {
      name: 'README.md',
      status: 'M',
      fullPath: 'README.md',
    });
  });

  it('嵌套路径建立目录链，文件落在最深层目录', () => {
    const tree = buildGitTree([{ file: 'src/utils/a.js', status: 'A' }]);
    assert.ok(tree.dirs.src);
    assert.ok(tree.dirs.src.dirs.utils);
    assert.equal(tree.dirs.src.files.length, 0);
    assert.equal(tree.dirs.src.dirs.utils.files.length, 1);
    assert.deepEqual(tree.dirs.src.dirs.utils.files[0], {
      name: 'a.js',
      status: 'A',
      fullPath: 'src/utils/a.js',
    });
  });

  it('同一目录下多文件复用同一目录节点', () => {
    const tree = buildGitTree([
      { file: 'src/a.js', status: 'M' },
      { file: 'src/b.js', status: 'A' },
    ]);
    assert.equal(Object.keys(tree.dirs).length, 1);
    const names = tree.dirs.src.files.map(f => f.name).sort();
    assert.deepEqual(names, ['a.js', 'b.js']);
  });

  it('多个顶层目录并存', () => {
    const tree = buildGitTree([
      { file: 'src/a.js', status: 'M' },
      { file: 'test/b.js', status: 'A' },
    ]);
    assert.deepEqual(Object.keys(tree.dirs).sort(), ['src', 'test']);
    assert.equal(tree.dirs.src.files[0].name, 'a.js');
    assert.equal(tree.dirs.test.files[0].name, 'b.js');
  });

  it('尾斜杠的目录占位被跳过（不入 tree）', () => {
    const tree = buildGitTree([
      { file: 'newdir/', status: '??' },
      { file: 'keep.js', status: 'M' },
    ]);
    assert.deepEqual(tree.dirs, {});
    assert.equal(tree.files.length, 1);
    assert.equal(tree.files[0].name, 'keep.js');
  });

  it('缺失 file 字段（空串/undefined）被跳过', () => {
    const tree = buildGitTree([
      { file: '', status: 'M' },
      { status: 'A' },
      { file: 'real.js', status: 'M' },
    ]);
    assert.equal(tree.files.length, 1);
    assert.equal(tree.files[0].name, 'real.js');
  });

  it('前导/连续斜杠被 filter(Boolean) 归一', () => {
    const tree = buildGitTree([{ file: '/src//deep/x.js', status: 'M' }]);
    assert.ok(tree.dirs.src);
    assert.ok(tree.dirs.src.dirs.deep);
    assert.equal(tree.dirs.src.dirs.deep.files[0].name, 'x.js');
    assert.equal(tree.dirs.src.dirs.deep.files[0].fullPath, '/src//deep/x.js');
  });

  it('仅斜杠（parts 全被过滤为空）被跳过', () => {
    const tree = buildGitTree([{ file: '///', status: 'M' }]);
    assert.deepEqual(tree, { dirs: {}, files: [] });
  });

  it('深层与浅层文件共存于同一子树', () => {
    const tree = buildGitTree([
      { file: 'src/index.js', status: 'M' },
      { file: 'src/utils/h.js', status: 'A' },
    ]);
    assert.equal(tree.dirs.src.files.length, 1);
    assert.equal(tree.dirs.src.files[0].name, 'index.js');
    assert.equal(tree.dirs.src.dirs.utils.files[0].name, 'h.js');
  });
});
