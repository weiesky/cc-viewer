import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { callClaude, judgeOutput, DEFAULT_MODEL, JUDGE_MODEL } from './judge.mjs';

const DEFAULT_OUTPUT_DIR = join(homedir(), '.claude', 'cc-viewer', 'eval-reports');

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

function generateRunId(variants) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}-${variants.join('-')}`;
}

export async function runEvaluation({
  samplesPath,
  skillDir,
  variants = ['v1', 'v2'],
  model = DEFAULT_MODEL,
  outputDir = DEFAULT_OUTPUT_DIR,
  proxyUrl = undefined,
  noJudge = false,
  dryRun = false,
  onProgress = null,
}) {
  const samples = JSON.parse(readFileSync(resolve(samplesPath), 'utf-8'));
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`invalid samples file: ${samplesPath}`);
  }

  const skills = dryRun ? {} : loadSkills(resolve(skillDir), variants);

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
    return {
      report: {
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
      },
      filePath: null,
    };
  }

  // Execute
  const results = {};
  let completed = 0;
  let totalCostUSD = 0;

  for (const task of tasks) {
    completed++;
    if (onProgress) {
      onProgress({ phase: 'start', completed, total: tasks.length, sample_id: task.sample_id, variant: task.variant });
    }

    const result = await callClaude({ model, system: task.system, prompt: task.prompt, proxyUrl });
    totalCostUSD += result.costUSD;

    let judge = null;
    if (result.ok && task.rubric && !noJudge) {
      judge = await judgeOutput({ output: result.output, rubric: task.rubric, prompt: task.prompt });
      if (judge.judgeCostUSD) totalCostUSD += judge.judgeCostUSD;
    }

    if (onProgress) {
      onProgress({
        phase: 'done', completed, total: tasks.length,
        sample_id: task.sample_id, variant: task.variant,
        durationMs: result.durationMs, inputTokens: result.inputTokens,
        outputTokens: result.outputTokens, costUSD: result.costUSD,
        score: judge?.score,
      });
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

  const runId = generateRunId(variants);
  const report = {
    id: runId,
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

  // Persist to outputDir
  if (outputDir) {
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    const filePath = join(outputDir, `${runId}.json`);
    writeFileSync(filePath, JSON.stringify(report, null, 2));
    return { report, filePath };
  }

  return { report, filePath: null };
}
