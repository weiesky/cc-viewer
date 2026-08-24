import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateAgentId, isValidTextField, isNonEmptyString, listUltraAgents } from '../packages/app/server/lib/ultra-agents-api.js';
import { ultraAgentsRoutes } from '../packages/app/server/routes/ultra-agents.js';
import { ULTRAPLAN_VARIANTS } from '../apps/web/src/utils/ultraplanTemplates.js';

describe('validateAgentId', () => {
  it('accepts safe ids', () => {
    assert.equal(validateAgentId('code-expert'), true);
    assert.equal(validateAgentId('a.b_c-1'), true);
    assert.equal(validateAgentId('Research2'), true);
  });

  it('rejects empty / non-string', () => {
    assert.equal(validateAgentId(''), false);
    assert.equal(validateAgentId(null), false);
    assert.equal(validateAgentId(undefined), false);
    assert.equal(validateAgentId(123), false);
  });

  it('rejects leading dot and traversal / separators / null byte', () => {
    assert.equal(validateAgentId('.hidden'), false);
    assert.equal(validateAgentId('..'), false);
    assert.equal(validateAgentId('a/b'), false);
    assert.equal(validateAgentId('a\\b'), false);
    assert.equal(validateAgentId('a\0b'), false);
  });

  it('rejects colon (not a plugin name) and spaces', () => {
    assert.equal(validateAgentId('plugin:foo'), false);
    assert.equal(validateAgentId('a b'), false);
  });

  it('rejects overly long ids', () => {
    assert.equal(validateAgentId('a'.repeat(201)), false);
    assert.equal(validateAgentId('a'.repeat(200)), true);
  });
});

describe('isValidTextField', () => {
  it('accepts non-empty strings', () => {
    assert.equal(isValidTextField('hello'), true);
    assert.equal(isValidTextField('   x   '), true);
  });

  it('rejects blank / non-string scalars', () => {
    assert.equal(isValidTextField(''), false);
    assert.equal(isValidTextField('   '), false);
    assert.equal(isValidTextField(42), false);
    assert.equal(isValidTextField(true), false);
    assert.equal(isValidTextField(null), false);
    assert.equal(isValidTextField(undefined), false);
  });

  it('accepts localized object with at least one non-empty string value', () => {
    assert.equal(isValidTextField({ en: 'x' }), true);
    assert.equal(isValidTextField({ en: '', zh: 'y' }), true);
  });

  it('rejects empty object / all-empty-string object / array', () => {
    assert.equal(isValidTextField({}), false);
    assert.equal(isValidTextField({ en: '', zh: '   ' }), false);
    assert.equal(isValidTextField([]), false);
    assert.equal(isValidTextField(['x']), false);
  });
});

describe('isNonEmptyString (content 专用)', () => {
  it('accepts trim 后非空字符串', () => {
    assert.equal(isNonEmptyString('x'), true);
    assert.equal(isNonEmptyString('  y  '), true);
  });
  it('rejects 空串 / 纯空白 / 对象 / 数组 / 标量 / null', () => {
    assert.equal(isNonEmptyString(''), false);
    assert.equal(isNonEmptyString('   '), false);
    assert.equal(isNonEmptyString({ en: 'x' }), false); // 本地化对象对 content 非法
    assert.equal(isNonEmptyString(['x']), false);
    assert.equal(isNonEmptyString(42), false);
    assert.equal(isNonEmptyString(null), false);
    assert.equal(isNonEmptyString(undefined), false);
  });
});

describe('listUltraAgents', () => {
  let dir;
  const writeAgent = (name, obj) => writeFileSync(join(dir, name), JSON.stringify(obj));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ccv-ua-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when dir does not exist', () => {
    assert.deepEqual(listUltraAgents({ dir: join(dir, 'nope') }), []);
  });

  it('reads valid agents with id/title/description/content', () => {
    writeAgent('a.json', { id: 'a', title: 'A', description: 'da', content: 'ca' });
    const out = listUltraAgents({ dir });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { id: 'a', title: 'A', description: 'da', content: 'ca' });
  });

  it('passes a localized title/description object through unchanged (content stays a string)', () => {
    const title = { zh: '代码', en: 'Code' };
    const description = { zh: '描述', en: 'Desc' };
    writeAgent('a.json', { id: 'a', title, description, content: 'C body' });
    const out = listUltraAgents({ dir });
    assert.deepEqual(out[0].title, title);
    assert.deepEqual(out[0].description, description);
    assert.equal(out[0].content, 'C body'); // content 单语言字符串,原样返回
  });

  it('rejects a non-string content (content is single-language only)', () => {
    // 旧行为会把本地化对象 content 透传,前端渲染成 [object Object];现严格按字符串校验。
    writeAgent('a.json', { id: 'a', title: 'A', content: { zh: 'x', en: 'y' } });
    assert.equal(listUltraAgents({ dir }).length, 0);
  });

  it('description defaults to "" when missing or invalid', () => {
    writeAgent('a.json', { id: 'a', title: 'A', content: 'C' });
    writeAgent('b.json', { id: 'b', title: 'B', content: 'C', description: {} });
    const out = listUltraAgents({ dir });
    assert.equal(out.find(x => x.id === 'a').description, '');
    assert.equal(out.find(x => x.id === 'b').description, '');
  });

  it('skips non-.json files', () => {
    writeAgent('a.json', { id: 'a', title: 'A', content: 'C' });
    writeFileSync(join(dir, 'readme.txt'), 'not json');
    writeFileSync(join(dir, 'b.JSON5'), '{}');
    const out = listUltraAgents({ dir });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'a');
  });

  it('skips malformed JSON', () => {
    writeFileSync(join(dir, 'bad.json'), '{ not valid json ');
    writeAgent('a.json', { id: 'a', title: 'A', content: 'C' });
    const out = listUltraAgents({ dir });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'a');
  });

  it('skips non-object JSON (array / scalar)', () => {
    writeFileSync(join(dir, 'arr.json'), '[1,2,3]');
    writeFileSync(join(dir, 'num.json'), '42');
    const out = listUltraAgents({ dir });
    assert.equal(out.length, 0);
  });

  it('skips entries with invalid id or missing title/content', () => {
    writeAgent('noid.json', { title: 'A', content: 'C' });
    writeAgent('badid.json', { id: 'a b', title: 'A', content: 'C' });
    writeAgent('notitle.json', { id: 'x', content: 'C' });
    writeAgent('nocontent.json', { id: 'y', title: 'A' });
    assert.equal(listUltraAgents({ dir }).length, 0);
  });

  it('skips invalid field types (array / number / empty / all-empty object)', () => {
    writeAgent('t1.json', { id: 't1', title: ['A'], content: 'C' });
    writeAgent('t2.json', { id: 't2', title: 'A', content: 42 });
    writeAgent('t3.json', { id: 't3', title: {}, content: 'C' });
    writeAgent('t4.json', { id: 't4', title: { en: '' }, content: 'C' });
    assert.equal(listUltraAgents({ dir }).length, 0);
  });

  it('dedups by id (first by filename order wins)', () => {
    writeAgent('a-first.json', { id: 'dup', title: 'First', content: 'C1' });
    writeAgent('b-second.json', { id: 'dup', title: 'Second', content: 'C2' });
    const out = listUltraAgents({ dir });
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'First');
  });

  it('skips files larger than 256KB', () => {
    writeAgent('big.json', { id: 'big', title: 'A', content: 'x'.repeat(300 * 1024) });
    writeAgent('ok.json', { id: 'ok', title: 'A', content: 'C' });
    const out = listUltraAgents({ dir });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'ok');
  });

  it('caps the number of returned agents at 100', () => {
    for (let i = 0; i < 105; i++) {
      writeAgent(`a${String(i).padStart(3, '0')}.json`, { id: `id${i}`, title: 'A', content: 'C' });
    }
    assert.equal(listUltraAgents({ dir }).length, 100);
  });

  it('ignores subdirectories', () => {
    mkdirSync(join(dir, 'sub.json'));
    writeAgent('a.json', { id: 'a', title: 'A', content: 'C' });
    const out = listUltraAgents({ dir });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'a');
  });
});

describe('built-in presets match ultraplanTemplates.js', () => {
  // 钉死：随包 code-expert / research-expert 的 content 必须逐字节等于 ULTRAPLAN_VARIANTS，
  // 防止 demo 的 content 再次被改写成与源模板不一致的「YY 版」。
  // （test-analysis-expert 为独立撰写的预设，无模板源，不在此约束内。）
  // content 是单语言字符串；title 为 JSON 内联本地化对象({lang: str})。
  it('code-expert / research-expert ship content verbatim from the templates', () => {
    const agents = listUltraAgents(); // 默认读包内置 ULTRA_AGENTS_DIR
    const code = agents.find(a => a.id === 'code-expert');
    const research = agents.find(a => a.id === 'research-expert');
    assert.ok(code, 'code-expert 预设应存在');
    assert.ok(research, 'research-expert 预设应存在');
    // content：单语言字符串，逐字节 === 源模板。
    assert.equal(typeof code.content, 'string');
    assert.equal(code.content, ULTRAPLAN_VARIANTS.codeExpert);
    assert.equal(research.content, ULTRAPLAN_VARIANTS.researchExpert);
    // title：JSON 协议层内联本地化对象。
    assert.equal(code.title.zh, '代码专家');
    assert.equal(code.title.en, 'Code Expert');
    assert.equal(research.title.zh, '调研专家');
    assert.equal(research.title.en, 'Research Expert');
  });
});

describe('GET /api/ultra-agents route', () => {
  // 假 res：捕获 writeHead 状态码与 end 写出的 body,无需起 http server。
  const fakeRes = () => {
    const res = { statusCode: null, body: '', headers: null };
    res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; };
    res.end = (chunk) => { res.body = chunk || ''; };
    return res;
  };
  const handler = ultraAgentsRoutes[0].handler;

  it('registers GET /api/ultra-agents as an exact route', () => {
    assert.equal(ultraAgentsRoutes.length, 1);
    assert.equal(ultraAgentsRoutes[0].method, 'GET');
    assert.equal(ultraAgentsRoutes[0].match, 'exact');
    assert.equal(ultraAgentsRoutes[0].path, '/api/ultra-agents');
  });

  it('responds 200 with { ok: true, agents: [...] } reading the package dir', async () => {
    const res = fakeRes();
    await handler({}, res);
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.ok, true);
    assert.ok(Array.isArray(data.agents));
    // 包内置 demo(代码专家/调研专家)应被读到。
    assert.ok(data.agents.some(a => a.id === 'code-expert'));
    assert.ok(data.agents.some(a => a.id === 'research-expert'));
  });

  it('responds 500 internal_error when writing the success response throws (ultra-agents.js:11-15)', async () => {
    // 让首个 writeHead 抛错（模拟序列化/写出阶段异常），进入 catch → 500 internal_error。
    // catch 内再次 writeHead/end 用第二次调用，故第一次抛、之后正常。
    let calls = 0;
    const res = {
      statusCode: null, body: '',
      writeHead(code) {
        calls++;
        if (calls === 1) throw new Error('write boom'); // try 内首个 writeHead 抛错
        this.statusCode = code;
      },
      end(chunk) { this.body = chunk || ''; },
    };
    await handler({}, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(JSON.parse(res.body), { error: 'internal_error' });
  });
});
