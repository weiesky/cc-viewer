# TeamDelete

## Definition

Removes a team and its associated task directories when multi-agent collaboration work is complete. This is the cleanup counterpart to TeamCreate.

## Behavior

- Removes the team directory: `~/.claude/teams/{team-name}/`
- Removes the task directory: `~/.claude/tasks/{team-name}/`
- Clears team context from the current session

**Important**: TeamDelete will fail if the team still has active members. Teammates must be gracefully shut down first via SendMessage shutdown requests.

## Typical Usage

TeamDelete is called at the end of a team workflow:

1. All tasks are completed
2. Teammates are shut down via `SendMessage` with `shutdown_request`
3. **TeamDelete** removes team and task directories

## Related Tools

| Tool | Purpose |
|------|---------|
| `TeamCreate` | Create a new team and its task list |
| `SendMessage` | Communicate with teammates / send shutdown requests |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Manage the shared task list |
| `Agent` | Spawn teammates that join the team |
