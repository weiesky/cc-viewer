import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_MODEL = 'sonnet';
export const JUDGE_MODEL = 'haiku';

export async function callClaude({ model, system, prompt }) {
  // Use 'ccv' if available (routes through cc-viewer), fallback to 'claude'
  const bin = process.env.CCV_EVAL_BIN || 'ccv';
  const args = bin === 'ccv'
    ? ['run', '--', 'claude', '-p', prompt, '--output-format', 'json', '--model', model]
    : ['-p', prompt, '--output-format', 'json', '--model', model];
  if (system) args.push('--system-prompt', system);

  const start = Date.now();
  try {
    const { stdout } = await execFileAsync(bin, args, {
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

export async function judgeOutput({ output, rubric, prompt }) {
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
