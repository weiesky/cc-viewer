# EndConversation

Ends the current conversation and prevents any further messages from being sent.

## When to Use

- Only for sustained user abuse, or when the user explicitly requests a demonstration of this tool.

This is a last-resort action: the tool's own rules require warning the user first and confirming before use, and it must never be used in self-harm or harm-related situations.

## Parameters

This tool takes no parameters.

## Examples

### Example 1: End the conversation

```
EndConversation()
```

The flow is two-step: the first call returns a reflection message; a second call immediately after actually ends the conversation (`ended: true`).

## Notes

- Heavily gated: requires a supported model, the CLI entrypoint, and a server-side feature flag — most sessions do not offer this tool.
- Once ended, no further messages can be sent in the conversation.
