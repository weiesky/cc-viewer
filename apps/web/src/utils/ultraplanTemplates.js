// Ultraplan prompt templates — re-exported from @ccv/core so the web hosts and the
// scheduled-task executor (packages/app) share one source of truth. The original
// implementations lived here; they moved to packages/core/src/ultraplanTemplates.js.
export {
  ULTRAPLAN_VARIANTS,
  buildCustomTemplate,
  buildLocalUltraplan,
  assembleScheduledPrompt,
} from '@ccv/core/ultraplanTemplates';
