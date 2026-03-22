#!/usr/bin/env node

import { resolve } from 'node:path';
import { runEvaluation } from './lib/eval-runner.mjs';

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

const args = parseArgs(process.argv.slice(2));

const config = {
  samplesPath: resolve(args.samples || 'eval-samples.zh.json'),
  skillDir: resolve(args['skill-dir'] || 'skills'),
  variants: (args.variants || 'v1,v2').split(',').map((v) => v.trim()).filter(Boolean),
  model: args.model || 'sonnet',
  outputDir: args['output-dir'] ? resolve(args['output-dir']) : undefined,
  noJudge: args['no-judge'] === 'true',
  dryRun: args['dry-run'] === 'true',
  onProgress({ phase, completed, total, sample_id, variant, durationMs, inputTokens, outputTokens, costUSD, score }) {
    if (phase === 'start') {
      process.stderr.write(`[${completed}/${total}] ${sample_id}/${variant} ...`);
    } else {
      const costInfo = costUSD > 0 ? ` $${costUSD.toFixed(4)}` : '';
      const scoreInfo = typeof score === 'number' ? ` score=${score}` : '';
      process.stderr.write(` ${durationMs}ms ${inputTokens}+${outputTokens}tok${costInfo}${scoreInfo}\n`);
    }
  },
};

try {
  const { report, filePath } = await runEvaluation(config);

  if (config.dryRun) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
    if (filePath) {
      process.stderr.write(`\nReport saved to: ${filePath}\n`);
      process.stderr.write(`View at: http://127.0.0.1:7799/run/${report.id}\n`);
    }
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
