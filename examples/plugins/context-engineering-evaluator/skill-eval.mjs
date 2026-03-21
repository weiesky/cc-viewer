#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_MODEL = 'sonnet';
const JUDGE_MODEL = 'haiku';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (!cur.startsWith('--')) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

function loadSkills(skillDir, variants) {
  const skills = {};
  const files = readdirSync(skillDir).filter((f) => extname(f) === '.md');
  for (const file of files) {
    const name = basename(file, '.md');
    if (variants.includes(name)) {
      skills[name] = readFileSync(join(skillDir, file), 'utf-8').trim();
    }
  }
  for (const v of variants) {
    if (!skills[v]) throw new Error(`skill file not found: ${join(skillDir, v + '.md')}`);
  }
  return skills;
}

async function callClaude({ model, system, prompt }) {
  const args = ['-p', prompt, '--output-format', 'json', '--model', model];
  if (system) args.push('--system-prompt', system);

  const start = Date.now();
  try {
    const { stdout } = await execFileAsync('claude', args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
    const durationMs = Date.now() - start;
    const data = JSON.parse(stdout);
    const usage = data.usage || {};
    return {
      ok: !data.is_error,
      durationMs: data.duration_ms || durationMs,
      durationApiMs: data.duration_api_ms || 0,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      costUSD: data.total_cost_usd || 0,
      output: data.result || '',
      stopReason: data.stop_reason || 'unknown',
      numTurns: data.num_turns || 1,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    // Try to parse JSON from stdout even on error
    let parsed = null;
    try { parsed = JSON.parse(err.stdout || ''); } catch {}
    return {
      ok: false,
      error: parsed?.result || err.message || 'unknown error',
      durationMs,
      durationApiMs: 0,
      inputTokens: parsed?.usage?.input_tokens || 0,
      outputTokens: parsed?.usage?.output_tokens || 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUSD: parsed?.total_cost_usd || 0,
      output: null,
      stopReason: 'error',
      numTurns: 0,
    };
  }
}

async function judgeOutput({ output, rubric, prompt }) {
  const judgePrompt = [
    '请对以下 AI 输出进行质量评分。',
    '',
    '## 原始任务',
    prompt,
    '',
    '## 评分标准',
    rubric,
    '',
    '## AI 输出',
    output,
    '',
    '请返回 JSON（不要包含 markdown 代码块标记）：',
    '{"score": <1-5的整数>, "reason": "<简短理由>"}',
    '',
    '评分标准：1=完全不达标, 2=部分涉及, 3=基本达标, 4=较好, 5=优秀',
  ].join('\n');

  const result = await callClaude({
    model: JUDGE_MODEL,
    system: '你是一个严格的 AI 输出质量评审员。只返回 JSON，不要其他内容。',
    prompt: judgePrompt,
  });

  if (!result.ok) return { score: 0, reason: `judge error: ${result.error}` };

  try {
    const text = result.output.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { score: 0, reason: 'judge returned non-JSON' };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: Number(parsed.score) || 0,
      reason: String(parsed.reason || ''),
      judgeCostUSD: result.costUSD,
    };
  } catch {
    return { score: 0, reason: 'failed to parse judge response' };
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const samplesPath = resolve(args.samples || 'eval-samples.zh.json');
  const skillDir = resolve(args['skill-dir'] || 'skills');
  const variants = (args.variants || 'v1,v2').split(',').map((v) => v.trim()).filter(Boolean);
  const model = args.model || DEFAULT_MODEL;
  const outputPath = args.output ? resolve(args.output) : null;
  const dryRun = args['dry-run'] === 'true';
  const noJudge = args['no-judge'] === 'true';

  const samples = JSON.parse(readFileSync(samplesPath, 'utf-8'));
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`invalid samples file: ${samplesPath}`);
  }

  const skills = dryRun ? {} : loadSkills(skillDir, variants);

  // Build tasks: interleaved scheduling (s1-v1, s1-v2, s2-v1, s2-v2, ...)
  const tasks = [];
  for (const sample of samples) {
    for (const variant of variants) {
      const userPrompt = sample.context
        ? `${sample.prompt}\n\n\`\`\`\n${sample.context}\n\`\`\``
        : sample.prompt;
      tasks.push({
        sample_id: sample.sample_id,
        variant,
        prompt: userPrompt,
        rubric: sample.rubric || null,
        system: skills[variant] || null,
      });
    }
  }

  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      model,
      variants,
      samplesPath,
      skillDir,
      totalTasks: tasks.length,
      tasks: tasks.map((t) => ({
        sample_id: t.sample_id,
        variant: t.variant,
        promptPreview: t.prompt.slice(0, 100),
        hasRubric: Boolean(t.rubric),
        hasSystem: Boolean(t.system),
      })),
    }, null, 2));
    return;
  }

  // Execute
  const results = {};
  let completed = 0;
  let totalCostUSD = 0;

  for (const task of tasks) {
    completed++;
    const progress = `[${completed}/${tasks.length}]`;
    process.stderr.write(`${progress} ${task.sample_id}/${task.variant} ...`);

    const result = await callClaude({
      model,
      system: task.system,
      prompt: task.prompt,
    });

    totalCostUSD += result.costUSD;

    let judge = null;
    if (result.ok && task.rubric && !noJudge) {
      judge = await judgeOutput({
        output: result.output,
        rubric: task.rubric,
        prompt: task.prompt,
      });
      if (judge.judgeCostUSD) totalCostUSD += judge.judgeCostUSD;
    }

    if (!results[task.sample_id]) results[task.sample_id] = {};
    results[task.sample_id][task.variant] = {
      ok: result.ok,
      durationMs: result.durationMs,
      durationApiMs: result.durationApiMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.inputTokens + result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheCreationTokens: result.cacheCreationTokens,
      costUSD: result.costUSD,
      numTurns: result.numTurns,
      ...(result.error && { error: result.error }),
      ...(judge && { score: judge.score, reason: judge.reason }),
      outputPreview: result.output ? result.output.slice(0, 200) : null,
    };

    const scoreInfo = judge ? ` score=${judge.score}` : '';
    const costInfo = result.costUSD > 0 ? ` $${result.costUSD.toFixed(4)}` : '';
    process.stderr.write(` ${result.durationMs}ms ${result.inputTokens}+${result.outputTokens}tok${costInfo}${scoreInfo}\n`);
  }

  // Build summary
  const summary = {};
  for (const variant of variants) {
    const entries = Object.values(results).map((r) => r[variant]).filter(Boolean);
    const ok = entries.filter((e) => e.ok);
    const scores = entries.filter((e) => typeof e.score === 'number' && e.score > 0).map((e) => e.score);
    summary[variant] = {
      totalSamples: entries.length,
      successCount: ok.length,
      errorCount: entries.length - ok.length,
      avgDurationMs: ok.length > 0 ? Math.round(ok.reduce((s, e) => s + e.durationMs, 0) / ok.length) : 0,
      avgInputTokens: ok.length > 0 ? Math.round(ok.reduce((s, e) => s + e.inputTokens, 0) / ok.length) : 0,
      avgOutputTokens: ok.length > 0 ? Math.round(ok.reduce((s, e) => s + e.outputTokens, 0) / ok.length) : 0,
      avgTotalTokens: ok.length > 0 ? Math.round(ok.reduce((s, e) => s + e.totalTokens, 0) / ok.length) : 0,
      totalCostUSD: ok.reduce((s, e) => s + (e.costUSD || 0), 0),
      ...(scores.length > 0 && {
        avgScore: Number((scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2)),
        minScore: Math.min(...scores),
        maxScore: Math.max(...scores),
      }),
    };
  }

  const report = {
    meta: {
      variants,
      model,
      judgeModel: noJudge ? null : JUDGE_MODEL,
      sampleCount: samples.length,
      taskCount: tasks.length,
      totalCostUSD: Number(totalCostUSD.toFixed(6)),
      timestamp: new Date().toISOString(),
    },
    summary,
    results: Object.entries(results).map(([sample_id, variantData]) => ({
      sample_id,
      variants: variantData,
    })),
  };

  const json = JSON.stringify(report, null, 2);
  if (outputPath) {
    writeFileSync(outputPath, json);
    process.stderr.write(`\nReport written to: ${outputPath}\n`);
  }
  console.log(json);
}

await run();
