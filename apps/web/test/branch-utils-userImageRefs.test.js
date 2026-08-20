// 分支覆盖补充：src/utils/userImageRefs.js
// 现有 test/user-image-refs.test.js 覆盖了主路径;本文件专攻未覆盖的短路分支:
//   - if (!text || typeof text !== 'string') 两条短路臂
//   - (m[1]||m[2]||m[3]||m[4]||'') 四个捕获组分支
//   - if (!path || !IMAGE_EXTS.test(path)) 两条短路臂(尤其 !path = trim 后为空)
//   - [Image …] 占位写法的可选段(#N / source / 仅冒号)
// src/utils 是 Vite 风格模块,顶部静态 import shim,目标用动态 import 加载。
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let findUserImageRefs;

before(async () => {
  ({ findUserImageRefs } = await import('../src/utils/userImageRefs.js'));
});

describe('findUserImageRefs 分支补充', () => {
  // ── if (!text || typeof text !== 'string') ──
  it('!text 为真臂:空串 / null / undefined / 0 / false 都返回 []', () => {
    assert.deepEqual(findUserImageRefs(''), []);
    assert.deepEqual(findUserImageRefs(null), []);
    assert.deepEqual(findUserImageRefs(undefined), []);
    assert.deepEqual(findUserImageRefs(0), []);
    assert.deepEqual(findUserImageRefs(false), []);
  });

  it('!text 为假但 typeof !== string 臂:真值非字符串(数字/对象/数组)返回 []', () => {
    assert.deepEqual(findUserImageRefs(42), []);
    assert.deepEqual(findUserImageRefs({ toString: () => '/tmp/cc-viewer-uploads/x.png' }), []);
    assert.deepEqual(findUserImageRefs(['/tmp/cc-viewer-uploads/x.png']), []);
    assert.deepEqual(findUserImageRefs(true), []); // 真值非字符串
  });

  it('两条短路臂都为假:正常字符串进入扫描', () => {
    const refs = findUserImageRefs('/tmp/cc-viewer-uploads/ok.png');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/ok.png');
  });

  // ── if (!path || !IMAGE_EXTS.test(path)) ──
  // !path 为真臂:[Image: …] 捕获到的内容 trim 后为空。
  it('!path 为真臂:[Image:    ] 仅含空白,trim 后为空 → 跳过(不入 refs)', () => {
    assert.deepEqual(findUserImageRefs('[Image:    ]'), []);
  });

  it('!path 为假但 !IMAGE_EXTS 为真臂:[Image] 内是非图片扩展名 → 跳过', () => {
    assert.deepEqual(findUserImageRefs('[Image: source: /tmp/cc-viewer-uploads/notes.txt]'), []);
    // 引号包裹的非图片扩展名(走 m[2]/m[3] 分支后被扩展名过滤)
    assert.deepEqual(findUserImageRefs('"/tmp/cc-viewer-uploads/data.json"'), []);
    assert.deepEqual(findUserImageRefs("'/tmp/cc-viewer-uploads/data.json'"), []);
  });

  it('两条短路臂都为假:非空且是图片扩展名 → 入 refs', () => {
    const refs = findUserImageRefs('[Image: source: /tmp/cc-viewer-uploads/good.png]');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/good.png');
  });

  // ── (m[1] || m[2] || m[3] || m[4] || '') 四个捕获组分支 ──
  it('m[1] 分支:[Image …] 形式取 group1', () => {
    const refs = findUserImageRefs('[Image: source: /tmp/cc-viewer-uploads/g1.png]');
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/g1.png');
  });

  it('m[2] 分支(m[1] 为 undefined → 走双引号 group2)', () => {
    const refs = findUserImageRefs('"/tmp/cc-viewer-uploads/g2.png"');
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/g2.png');
    assert.equal(refs[0].raw, '"/tmp/cc-viewer-uploads/g2.png"');
  });

  it('m[3] 分支(m[1]/m[2] 为 undefined → 走单引号 group3)', () => {
    const refs = findUserImageRefs("'/tmp/cc-viewer-uploads/g3.png'");
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/g3.png');
    assert.equal(refs[0].raw, "'/tmp/cc-viewer-uploads/g3.png'");
  });

  it('m[4] 分支(前三组 undefined → 走裸路径 group4)', () => {
    const refs = findUserImageRefs('prefix/tmp/cc-viewer-uploads/g4.png');
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/g4.png');
    assert.equal(refs[0].raw, '/tmp/cc-viewer-uploads/g4.png');
  });

  // ── [Image …] 占位写法的可选段:#N / source / 仅冒号 ──
  it('[Image] 可选段组合:含 #N + source', () => {
    const refs = findUserImageRefs('[Image #3: source: /tmp/cc-viewer-uploads/n3.png]');
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/n3.png');
  });

  it('[Image] 可选段组合:无 #N、无 source,仅冒号', () => {
    const refs = findUserImageRefs('[Image: /tmp/cc-viewer-uploads/plain.png]');
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/plain.png');
  });

  it('[Image] 可选段组合:含 #N 但无 source', () => {
    const refs = findUserImageRefs('[Image #7: /tmp/cc-viewer-uploads/n7.png]');
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/n7.png');
  });

  // ── while 循环:文本无任何命中 → 循环零次正常退出 ──
  it('扫描循环零命中:纯文本返回 []', () => {
    assert.deepEqual(findUserImageRefs('完全没有任何上传路径的普通中文消息'), []);
  });

  // ── 多命中:while 循环多轮迭代 ──
  it('多命中:循环走多轮,按出现顺序返回', () => {
    const text = 'a /tmp/cc-viewer-uploads/x.png b "/tmp/cc-viewer-uploads/y.gif" c';
    const refs = findUserImageRefs(text);
    assert.equal(refs.length, 2);
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/x.png');
    assert.equal(refs[1].path, '/tmp/cc-viewer-uploads/y.gif');
  });
});
