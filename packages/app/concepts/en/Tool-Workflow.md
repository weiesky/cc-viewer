# Workflow

Runs a script that orchestrates many subagents deterministically — fan-out, pipelines, loops, and verification — for work that is too broad, too uncertain, or too large for a single context.

## When to Use

- Decompose a large task and cover it in parallel across many agents
- Cross-check findings with independent or adversarial verification before committing to them
- Take on scale one context can't hold: migrations, audits, broad multi-file sweeps

## How It Works

- Runs in the background; you are notified when it finishes. Watch live progress with `/workflows`.
- The script coordinates agents with `agent()`, `parallel()`, `pipeline()`, and `phase()`.
- `pipeline()` streams each item through stages with no barrier (default); `parallel()` is a barrier that waits for all results.
- With a schema, each `agent()` returns validated structured data instead of free text.

## Notes

- Only runs when the user explicitly opts into multi-agent orchestration; it can spawn many agents and consume significant tokens.
- Concurrency is capped per workflow; excess agents queue and run as slots free up.
- For a single subagent, use the `Agent` tool instead — reserve Workflow for real fan-out.

## Related Concepts

- Builds on the `Agent` tool, running many agents under deterministic control flow.
