# SubAgent: Search

## Definition

Search is a sub-agent type spawned by Claude Code's main agent to perform codebase searches. It executes targeted file and content searches using tools like Glob, Grep, and Read, then returns the results to the parent agent.

## Behavior

- Spawned automatically when the main agent needs to search or explore the codebase
- Runs in an isolated context with read-only access
- Uses Glob for file pattern matching, Grep for content search, and Read for file inspection
- Returns search results to the parent agent for further processing

## When It Appears

Search sub-agents typically appear when:

1. The main agent needs to find specific files, functions, or code patterns
2. A broad codebase exploration is requested by the user
3. The agent is investigating dependencies, references, or usage patterns
