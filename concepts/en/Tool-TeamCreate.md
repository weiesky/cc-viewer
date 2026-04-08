# TeamCreate

## Definition

Creates a new team to coordinate multiple agents working on a project. Teams enable parallel task execution through a shared task list and inter-agent messaging.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `team_name` | string | Yes | Name for the new team |
| `description` | string | No | Team description/purpose |
| `agent_type` | string | No | Type/role of the team lead |

## What It Creates

- **Team config file**: `~/.claude/teams/{team-name}/config.json` — stores member list and metadata
- **Task list directory**: `~/.claude/tasks/{team-name}/` — shared task list for all teammates

Teams have a 1:1 correspondence with task lists.

## Team Workflow

1. **TeamCreate** — create the team and its task list
2. **TaskCreate** — define tasks for the team
3. **Agent** (with `team_name` + `name`) — spawn teammates that join the team
4. **TaskUpdate** — assign tasks to teammates via `owner`
5. Teammates work on tasks, communicate via **SendMessage**
6. **Shutdown** teammates when done, then **TeamDelete** to clean up

## Related Tools

| Tool | Purpose |
|------|---------|
| `TeamDelete` | Remove team and task directories |
| `SendMessage` | Inter-agent communication within the team |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Manage the shared task list |
| `Agent` | Spawn teammates that join the team |
