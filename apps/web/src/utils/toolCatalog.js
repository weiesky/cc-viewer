/**
 * Single source of truth for the built-in tool catalog.
 *
 * `TOOL_CATALOG` is an ordered, function-grouped list of every built-in tool
 * that ships a concept doc at `concepts/<lang>/Tool-<name>.md`. It drives:
 *   - the "all tools" catalog modal (src/components/common/ToolsHelp.jsx)
 *   - the Tool-* whitelist in ConceptHelp (src/components/common/ConceptHelp.jsx)
 *
 * Keep this in sync with the shipped Tool-*.md docs — the guard test
 * `apps/web/test/tool-catalog-concepts.test.js` fails if any catalog tool lacks a doc
 * in any language directory.
 *
 * Category `key` maps to i18n `ui.toolCatalog.cat.<key>` in src/i18n.js.
 */
export const TOOL_CATALOG = [
  { key: 'agent',    tools: ['Agent', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'TaskOutput', 'TaskStop', 'ListAgents'] },
  { key: 'team',     tools: ['SendMessage', 'Workflow', 'Monitor', 'SendFile', 'SendUserFile', 'SendUserMessage', 'EndConversation'] },
  { key: 'file',     tools: ['Read', 'Edit', 'Write', 'NotebookEdit'] },
  { key: 'search',   tools: ['Glob', 'Grep', 'ToolSearch'] },
  { key: 'terminal', tools: ['Bash', 'REPL'] },
  { key: 'web',      tools: ['WebFetch', 'WebSearch', 'Artifact', 'DesignSync'] },
  { key: 'planning', tools: ['EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion', 'Skill', 'ReportFindings', 'TodoWrite', 'SendFeedback', 'Projects', 'ProposeGoal'] },
  { key: 'worktree', tools: ['EnterWorktree', 'ExitWorktree'] },
  { key: 'schedule', tools: ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'PushNotification', 'RemoteTrigger', 'ReadNotifications'] },
  { key: 'ide',      tools: ['LSP'] },
  { key: 'mcp',      tools: ['ReadMcpResource', 'ReadMcpResourceDir', 'ListMcpResources', 'SearchMcpRegistry', 'SuggestConnectors', 'ListConnectors', 'SuggestPluginInstall', 'SuggestSkills', 'ListPlugins', 'ListSkills'] },
];

// Flat list of all tool names (57) — order follows TOOL_CATALOG.
export const ALL_TOOL_NAMES = TOOL_CATALOG.flatMap((c) => c.tools);
