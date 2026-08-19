# EndConversation

Ends the current conversation and prevents any further messages from being sent.

## When to Use

- Only for sustained user abuse, or when the user explicitly requests a demonstration of this tool.

This is a last-resort action: the tool's own rules require warning the user first and confirming before use, and it must never be used in self-harm or harm-related situations.

## Activation

- Requires Claude Code 2.1.213+ and a model from the Opus 4.8 / Sonnet 5 / Fable 5 or later family.
- Interactive terminal sessions only — never in `--bare` mode, and never available to subagents.
- Not available on Amazon Bedrock, Claude Platform on AWS, Vertex AI, Microsoft Foundry, or cloud gateways.
- Requires a server-side feature flag — most sessions do not offer this tool.

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
