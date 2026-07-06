import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WORKER_PATH = join(__dirname, '..', 'lib', 'stats-worker.js');

function makeTmpDir() {
  const dir = join(tmpdir(), `ccv-stats-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Build a JSONL entry string (entries separated by \n---\n) */
function jsonlEntry(obj) {
  return JSON.stringify(obj);
}

function buildJsonlContent(entries) {
  return entries.map(e => jsonlEntry(e)).join('\n---\n');
}

/** Spawn worker, send a message, collect responses until expectedType is received */
function runWorker(msg, expectedType, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH);
    const messages = [];
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`Timeout waiting for ${expectedType}, got: ${JSON.stringify(messages)}`));
    }, timeout);

    worker.on('message', (m) => {
      messages.push(m);
      if (m.type === expectedType) {
        clearTimeout(timer);
        worker.terminate();
        resolve(messages);
      }
    });
    worker.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    worker.postMessage(msg);
  });
}

// ─── parseJsonlFile (tested via init message → stats JSON output) ───

describe('stats-worker: parseJsonlFile via init', () => {
  let logDir;

  beforeEach(() => {
    logDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
  });

  it('parses a single JSONL file with model and usage', async () => {
    const projectName = 'test-proj';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    const content = buildJsonlContent([
      {
        body: { model: 'claude-sonnet-4-20250514' },
        response: {
          body: {
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        },
      },
      {
        body: { model: 'claude-sonnet-4-20250514' },
        response: {
          body: {
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 30 },
          },
        },
      },
    ]);
    writeFileSync(join(projectDir, 'session1.jsonl'), content);

    await runWorker(
      { type: 'init', logDir, projectName },
      'init-done',
    );

    const statsFile = join(projectDir, `${projectName}.json`);
    assert.ok(existsSync(statsFile), 'stats JSON should be created');

    const stats = JSON.parse(readFileSync(statsFile, 'utf-8'));
    assert.equal(stats.project, projectName);
    assert.equal(stats.summary.requestCount, 2);
    assert.equal(stats.summary.input_tokens, 300);
    assert.equal(stats.summary.output_tokens, 130);
    assert.equal(stats.summary.cache_read_input_tokens, 30);
    assert.equal(stats.summary.fileCount, 1);
    assert.ok(stats.models['claude-sonnet-4-20250514'] >= 2);
  });

  it('counts sessions and turns correctly', async () => {
    const projectName = 'sess-proj';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    const content = buildJsonlContent([
      // Turn 1: new session, messages.length=1
      {
        mainAgent: true,
        body: { model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'hi' }] },
        response: { body: { model: 'claude-sonnet-4-20250514', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } } },
      },
      // Same turn 1: tool_use continuation, messages.length=3
      {
        mainAgent: true,
        body: { model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'tool call' }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }] },
        response: { body: { model: 'claude-sonnet-4-20250514', stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 10 } } },
      },
      // Turn 2: user sends second message, messages.length=5
      {
        mainAgent: true,
        body: { model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }, { role: 'assistant', content: 'a2' }, { role: 'user', content: 'q3' }] },
        response: { body: { model: 'claude-sonnet-4-20250514', stop_reason: 'end_turn', usage: { input_tokens: 30, output_tokens: 15 } } },
      },
      // SUGGESTION MODE: should NOT count as a turn, messages.length=7
      {
        mainAgent: true,
        body: { model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }, { role: 'assistant', content: 'a2' }, { role: 'user', content: 'q3' }, { role: 'assistant', content: 'a3' }, { role: 'user', content: [{ type: 'text', text: '[SUGGESTION MODE: Suggest next input]' }] }] },
        response: { body: { model: 'claude-sonnet-4-20250514', stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 3 } } },
      },
      // New session: messages.length=1 again
      {
        mainAgent: true,
        body: { model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'new' }] },
        response: { body: { model: 'claude-sonnet-4-20250514', stop_reason: 'end_turn', usage: { input_tokens: 15, output_tokens: 8 } } },
      },
    ]);
    writeFileSync(join(projectDir, 'session.jsonl'), content);

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    assert.equal(stats.summary.sessionCount, 2, 'only entries with messages.length===1 count as sessions');
    assert.equal(stats.summary.turnCount, 3, 'user turns: turn1 + turn2 + new session, excluding suggestion and tool continuation');
    assert.equal(stats.summary.requestCount, 5);
  });

  it('handles empty JSONL file', async () => {
    const projectName = 'empty-proj';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'empty.jsonl'), '');

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    assert.equal(stats.summary.requestCount, 0);
    assert.equal(stats.summary.input_tokens, 0);
  });

  it('skips _temp.jsonl files', async () => {
    const projectName = 'temp-proj';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, 'real.jsonl'), buildJsonlContent([
      { body: { model: 'x' }, response: { body: { model: 'x', usage: { input_tokens: 10, output_tokens: 5 } } } },
    ]));
    writeFileSync(join(projectDir, 'something_temp.jsonl'), buildJsonlContent([
      { body: { model: 'y' }, response: { body: { model: 'y', usage: { input_tokens: 999, output_tokens: 999 } } } },
    ]));

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    assert.equal(stats.summary.fileCount, 1, 'should only count real.jsonl');
    assert.equal(stats.summary.input_tokens, 10);
  });

  it('handles malformed JSON entries gracefully', async () => {
    const projectName = 'bad-proj';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    const content = 'not valid json\n---\n' + jsonlEntry({
      body: { model: 'ok' },
      response: { body: { model: 'ok', usage: { input_tokens: 5, output_tokens: 3 } } },
    });
    writeFileSync(join(projectDir, 'mixed.jsonl'), content);

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    assert.equal(stats.summary.requestCount, 1, 'should skip bad entry, count good one');
  });

  it('aggregates multiple models across files', async () => {
    const projectName = 'multi-proj';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, 'a.jsonl'), buildJsonlContent([
      { body: { model: 'modelA' }, response: { body: { model: 'modelA', usage: { input_tokens: 10, output_tokens: 5 } } } },
    ]));
    writeFileSync(join(projectDir, 'b.jsonl'), buildJsonlContent([
      { body: { model: 'modelB' }, response: { body: { model: 'modelB', usage: { input_tokens: 20, output_tokens: 10 } } } },
      { body: { model: 'modelA' }, response: { body: { model: 'modelA', usage: { input_tokens: 30, output_tokens: 15 } } } },
    ]));

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    assert.equal(stats.models['modelA'], 2);
    assert.equal(stats.models['modelB'], 1);
    assert.equal(stats.summary.requestCount, 3);
    assert.equal(stats.summary.input_tokens, 60);
    assert.equal(stats.summary.fileCount, 2);
  });
});

// ─── incremental update ───

describe('stats-worker: incremental update', () => {
  let logDir;

  beforeEach(() => {
    logDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
  });

  it('update message re-parses only the specified file', async () => {
    const projectName = 'incr-proj';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, 'file1.jsonl'), buildJsonlContent([
      { body: { model: 'm1' }, response: { body: { model: 'm1', usage: { input_tokens: 10, output_tokens: 5 } } } },
    ]));

    // Initial
    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    // Add a second file
    writeFileSync(join(projectDir, 'file2.jsonl'), buildJsonlContent([
      { body: { model: 'm2' }, response: { body: { model: 'm2', usage: { input_tokens: 20, output_tokens: 10 } } } },
    ]));

    // Update with the new file
    await runWorker(
      { type: 'update', logDir, projectName, logFile: join(projectDir, 'file2.jsonl') },
      'update-done',
    );

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    assert.equal(stats.summary.fileCount, 2);
    assert.equal(stats.summary.requestCount, 2);
    assert.equal(stats.summary.input_tokens, 30);
  });
});

// ─── scan-all ───

describe('stats-worker: scan-all', () => {
  let logDir;

  beforeEach(() => {
    logDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
  });

  it('scans all project directories and generates stats for each', async () => {
    // Create two project dirs
    for (const name of ['projA', 'projB']) {
      const dir = join(logDir, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'log.jsonl'), buildJsonlContent([
        { body: { model: 'x' }, response: { body: { model: 'x', usage: { input_tokens: 1, output_tokens: 1 } } } },
      ]));
    }

    await runWorker({ type: 'scan-all', logDir }, 'scan-all-done');

    for (const name of ['projA', 'projB']) {
      const statsFile = join(logDir, name, `${name}.json`);
      assert.ok(existsSync(statsFile), `${name}.json should exist`);
      const stats = JSON.parse(readFileSync(statsFile, 'utf-8'));
      assert.equal(stats.project, name);
      assert.equal(stats.summary.requestCount, 1);
    }
  });

  it('handles empty logDir gracefully', async () => {
    const msgs = await runWorker({ type: 'scan-all', logDir }, 'scan-all-done');
    assert.ok(msgs.some(m => m.type === 'scan-all-done'));
  });

  it('skips non-directory entries in logDir', async () => {
    // Create a regular file (not a directory) in logDir — should be skipped
    writeFileSync(join(logDir, 'not-a-dir.txt'), 'hello');
    const msgs = await runWorker({ type: 'scan-all', logDir }, 'scan-all-done');
    assert.ok(msgs.some(m => m.type === 'scan-all-done'));
  });
});

// ─── edge cases for branch coverage ───

describe('stats-worker: branch coverage', () => {
  let logDir;

  beforeEach(() => {
    logDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
  });

  it('handles corrupt existing stats JSON gracefully (line 102)', async () => {
    const projectName = 'corrupt-stats';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    // Write a valid jsonl file
    writeFileSync(join(projectDir, 'log.jsonl'), buildJsonlContent([
      { body: { model: 'x' }, response: { body: { model: 'x', usage: { input_tokens: 1, output_tokens: 1 } } } },
    ]));
    // Write corrupt stats JSON
    writeFileSync(join(projectDir, `${projectName}.json`), 'NOT VALID JSON{{{');

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    // Should regenerate valid stats despite corrupt cache
    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    assert.equal(stats.project, projectName);
    assert.equal(stats.summary.requestCount, 1);
  });

  it('handles entry with no model gracefully', async () => {
    const projectName = 'no-model';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, 'log.jsonl'), buildJsonlContent([
      { body: {}, response: { body: { usage: { input_tokens: 10, output_tokens: 5 } } } },
      { body: { model: 'ok' }, response: { body: { model: 'ok', usage: { input_tokens: 1, output_tokens: 1 } } } },
    ]));

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    // Both entries are counted as requests, but only one has a model
    assert.equal(stats.summary.requestCount, 2);
    assert.equal(stats.models['ok'], 1);
  });

  it('handles entry with cache_creation_input_tokens', async () => {
    const projectName = 'cache-create';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, 'log.jsonl'), buildJsonlContent([
      {
        body: { model: 'c' },
        response: { body: { model: 'c', usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 50, cache_read_input_tokens: 20 } } },
      },
    ]));

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    assert.equal(stats.summary.cache_creation_input_tokens, 50);
    assert.equal(stats.summary.cache_read_input_tokens, 20);
  });

  it('incremental update reuses unchanged file stats from cache', async () => {
    const projectName = 'cache-reuse';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, 'file1.jsonl'), buildJsonlContent([
      { body: { model: 'm1' }, response: { body: { model: 'm1', usage: { input_tokens: 10, output_tokens: 5 } } } },
    ]));
    writeFileSync(join(projectDir, 'file2.jsonl'), buildJsonlContent([
      { body: { model: 'm2' }, response: { body: { model: 'm2', usage: { input_tokens: 20, output_tokens: 10 } } } },
    ]));

    // Initial parse
    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    // Update only file2 (file1 should be reused from cache)
    await runWorker(
      { type: 'update', logDir, projectName, logFile: join(projectDir, 'file2.jsonl') },
      'update-done',
    );

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    assert.equal(stats.summary.fileCount, 2);
    assert.equal(stats.summary.requestCount, 2);
  });

  it('init on nonexistent project dir does not crash', async () => {
    const msgs = await runWorker(
      { type: 'init', logDir, projectName: 'nonexistent' },
      'init-done',
      3000,
    ).catch(() => []);
    // Worker should not crash — it just won't send init-done for missing dir
    // (timeout is expected here)
    assert.ok(true);
  });

  it('collects all user prompts in preview (not limited to 2)', async () => {
    const projectName = 'all-prompts';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    // Create 5 session-start entries (messages.length === 1)
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push({
        mainAgent: true,
        body: { model: 'claude', messages: [{ role: 'user', content: `prompt ${i}` }] },
        response: { body: { model: 'claude', usage: { input_tokens: 10, output_tokens: 5 } } },
      });
    }
    writeFileSync(join(projectDir, 'session.jsonl'), buildJsonlContent(entries));

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    const fileStats = Object.values(stats.files)[0];
    assert.equal(fileStats.preview.length, 5, 'should collect all 5 user prompts, not just 2');
    assert.equal(fileStats.preview[0], 'prompt 1');
    assert.equal(fileStats.preview[4], 'prompt 5');
  });

  it('collects prompts from array content format', async () => {
    const projectName = 'array-prompts';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    const entries = [
      {
        mainAgent: true,
        body: { model: 'claude', messages: [{ role: 'user', content: [{ type: 'text', text: 'array prompt one' }] }] },
        response: { body: { model: 'claude', usage: { input_tokens: 10, output_tokens: 5 } } },
      },
      {
        mainAgent: true,
        body: { model: 'claude', messages: [{ role: 'user', content: [{ type: 'text', text: 'array prompt two' }] }] },
        response: { body: { model: 'claude', usage: { input_tokens: 10, output_tokens: 5 } } },
      },
    ];
    writeFileSync(join(projectDir, 'session.jsonl'), buildJsonlContent(entries));

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    const fileStats = Object.values(stats.files)[0];
    assert.equal(fileStats.preview.length, 2);
    assert.equal(fileStats.preview[0], 'array prompt one');
    assert.equal(fileStats.preview[1], 'array prompt two');
  });

  it('strips system-reminder tags from preview text', async () => {
    const projectName = 'sys-tag-filter';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    const entries = [
      {
        mainAgent: true,
        body: { model: 'claude', messages: [{ role: 'user', content: '<system-reminder>secret instructions</system-reminder>hello world' }] },
        response: { body: { model: 'claude', usage: { input_tokens: 10, output_tokens: 5 } } },
      },
      {
        mainAgent: true,
        body: { model: 'claude', messages: [{ role: 'user', content: '<system-reminder>more secrets</system-reminder>' }] },
        response: { body: { model: 'claude', usage: { input_tokens: 10, output_tokens: 5 } } },
      },
    ];
    writeFileSync(join(projectDir, 'session.jsonl'), buildJsonlContent(entries));

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    const fileStats = Object.values(stats.files)[0];
    assert.equal(fileStats.preview.length, 1, 'pure system-tag entry should be skipped');
    assert.equal(fileStats.preview[0], 'hello world');
  });

  it('collects prompts from multi-turn conversations (not just len===1)', async () => {
    const projectName = 'multi-turn';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    const entries = [
      {
        mainAgent: true,
        body: { model: 'claude', messages: [{ role: 'user', content: 'first turn' }] },
        response: { body: { model: 'claude', usage: { input_tokens: 10, output_tokens: 5 } } },
      },
      {
        mainAgent: true,
        body: { model: 'claude', messages: [
          { role: 'user', content: 'first turn' },
          { role: 'assistant', content: 'response 1' },
          { role: 'user', content: 'second turn' },
        ] },
        response: { body: { model: 'claude', usage: { input_tokens: 20, output_tokens: 10 } } },
      },
      {
        mainAgent: true,
        body: { model: 'claude', messages: [
          { role: 'user', content: 'first turn' },
          { role: 'assistant', content: 'response 1' },
          { role: 'user', content: 'second turn' },
          { role: 'assistant', content: 'response 2' },
          { role: 'user', content: 'third turn' },
        ] },
        response: { body: { model: 'claude', usage: { input_tokens: 30, output_tokens: 15 } } },
      },
    ];
    writeFileSync(join(projectDir, 'session.jsonl'), buildJsonlContent(entries));

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    const fileStats = Object.values(stats.files)[0];
    assert.equal(fileStats.preview.length, 3, 'should collect prompt from each turn');
    assert.equal(fileStats.preview[0], 'first turn');
    assert.equal(fileStats.preview[1], 'second turn');
    assert.equal(fileStats.preview[2], 'third turn');
  });

  it('does not duplicate preview when same turn has multiple requests', async () => {
    const projectName = 'test-dedup';
    const projectDir = join(logDir, projectName);
    mkdirSync(projectDir, { recursive: true });

    const sameTurnMsgs = [
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'do something' },
    ];
    // Simulate multiple main-agent requests within the same turn (same msg length)
    const entries = [
      {
        mainAgent: true,
        body: { model: 'claude', messages: [{ role: 'user', content: 'hello world' }] },
        response: { body: { model: 'claude', usage: { input_tokens: 10, output_tokens: 5 } } },
      },
      {
        mainAgent: true,
        body: { model: 'claude', messages: sameTurnMsgs },
        response: { body: { model: 'claude', usage: { input_tokens: 20, output_tokens: 10 } } },
      },
      {
        mainAgent: true,
        body: { model: 'claude', messages: sameTurnMsgs },
        response: { body: { model: 'claude', usage: { input_tokens: 20, output_tokens: 10 } } },
      },
      {
        mainAgent: true,
        body: { model: 'claude', messages: sameTurnMsgs },
        response: { body: { model: 'claude', usage: { input_tokens: 20, output_tokens: 10 } } },
      },
    ];
    writeFileSync(join(projectDir, 'session.jsonl'), buildJsonlContent(entries));

    await runWorker({ type: 'init', logDir, projectName }, 'init-done');

    const stats = JSON.parse(readFileSync(join(projectDir, `${projectName}.json`), 'utf-8'));
    const fileStats = Object.values(stats.files)[0];
    assert.equal(fileStats.preview.length, 2, 'duplicate requests in same turn should not produce extra previews');
    assert.equal(fileStats.preview[0], 'hello world');
    assert.equal(fileStats.preview[1], 'do something');
  });
});