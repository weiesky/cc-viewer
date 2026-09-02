/**
 * Tool display policy shared by the chat bubble renderers.
 *
 * FULL_DISPLAY_TOOLS are the tools that render their full call card even in
 * simplified (pill) mode — file mutations the user wants to see, interactive
 * cards (plan approval / questionnaire), agent spawns, teammate messages and
 * the live Workflow panel. Everything else collapses to a hoverable pill.
 *
 * The minimal-chat post-pass (toolRunMerge.js) reuses the same set as its
 * "this turn must stay its own bubble" rule, so the two stay in lock-step.
 */
export const FULL_DISPLAY_TOOLS = new Set([
  'Edit',
  'Write',
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
  'Agent',
  'TaskCreate',
  'SendMessage',
  'Workflow',
]);

export function isFullDisplayTool(name) {
  return FULL_DISPLAY_TOOLS.has(name);
}
