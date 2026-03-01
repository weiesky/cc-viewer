# getDiagnostics (mcp__ide__getDiagnostics)

## Definition

Gets language diagnostics from VS Code, including syntax errors, type errors, lint warnings, and more.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uri` | string | No | File URI. If not provided, gets diagnostics for all files |

## Use Cases

**Good for:**
- Checking code for syntax, type, lint, and other semantic issues
- Verifying whether new errors were introduced after editing code
- Replacing Bash commands for checking code quality

**Not good for:**
- Running tests — use Bash instead
- Checking runtime errors — use Bash to execute the code instead

## Notes

- This is an MCP (Model Context Protocol) tool provided by IDE integration
- Only available in VS Code / IDE environments
- Prefer this tool over Bash commands for checking code issues

## Significance in cc-viewer

getDiagnostics is an MCP tool that appears in the `tools` array of request logs under the name `mcp__ide__getDiagnostics`. Its invocations and returns follow the standard `tool_use` / `tool_result` pattern. Adding or removing MCP tools causes changes to the tools array, which may trigger cache rebuilds.

## Original Text

<textarea readonly>Get language diagnostics from VS Code</textarea>
