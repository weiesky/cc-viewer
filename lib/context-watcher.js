import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const CONTEXT_WINDOW_FILE = join(homedir(), '.claude', 'context-window.json');
export const CLAUDE_SETTINGS_FILE = join(homedir(), '.claude', 'settings.json');

// Startup cache: read once, never re-read unless model changes
let _startupModelBase = null;   // e.g. 'opus-4-6'
let _startupContextSize = null; // e.g. 1000000

/**
 * Read context-window.json once at startup and cache model→size mapping.
 * Extracts model base name (e.g. 'opus-4-6') and context size from model.id (e.g. 'claude-opus-4-6[1m]').
 * @returns {{ modelId: string|null, contextSize: number }}
 */
export function readModelContextSize() {
  try {
    if (!existsSync(CONTEXT_WINDOW_FILE)) return { modelId: null, contextSize: 200000 };
    const raw = readFileSync(CONTEXT_WINDOW_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const modelId = data?.model?.id || null;
    let contextSize = 200000;
    if (modelId) {
      const lower = modelId.toLowerCase();
      const sizeMatch = lower.match(/\[(\d+)([km])\]/);
      if (sizeMatch) {
        const num = parseInt(sizeMatch[1], 10);
        contextSize = sizeMatch[2] === 'm' ? num * 1000000 : num * 1000;
      } else if (/opus/i.test(lower)) {
        // Opus models default to 1M context
        contextSize = 1000000;
      }
      // Cache the base name → size mapping
      const base = lower.replace(/^claude-/i, '').replace(/\[.*\]/, '').trim();
      _startupModelBase = base;
      _startupContextSize = contextSize;
    }
    return { modelId, contextSize };
  } catch {
    return { modelId: null, contextSize: 200000 };
  }
}

/**
 * Get context size for a given API model name (e.g. 'claude-opus-4-6-20250514').
 * Uses startup cache to avoid re-reading the file.
 * @param {string} apiModelName - model name from req.body.model
 * @returns {number} context window size in tokens
 */
export function getContextSizeForModel(apiModelName) {
  if (!apiModelName) return _startupContextSize || 200000;
  const lower = apiModelName.toLowerCase();
  // Extract base: 'claude-opus-4-6-20250514' → 'opus-4-6'
  const base = lower.replace(/^claude-/i, '').replace(/-\d{8}$/, '').trim();
  // Match against startup cache
  if (_startupModelBase && base === _startupModelBase) {
    return _startupContextSize;
  }
  // Opus always has 1M context; other unknown models default to 200K
  if (/opus/i.test(lower)) return 1000000;
  return 200000;
}

/**
 * Build a context_window SSE event payload from API usage data.
 * @param {object} usage - API response usage object
 * @param {number} contextSize - total context window size in tokens
 * @returns {object|null} context_window event data, or null if usage missing
 */
export function buildContextWindowEvent(usage, contextSize) {
  if (!usage) return null;
  const inputTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  const outputTokens = usage.output_tokens || 0;
  const totalTokens = inputTokens + outputTokens;
  const usedPct = Math.round((totalTokens / contextSize) * 100);
  return {
    total_input_tokens: inputTokens,
    total_output_tokens: outputTokens,
    context_window_size: contextSize,
    current_usage: usage,
    used_percentage: usedPct,
    remaining_percentage: 100 - usedPct,
  };
}
