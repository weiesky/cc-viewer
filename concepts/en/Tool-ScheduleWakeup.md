# ScheduleWakeup

Schedule when to resume work in `/loop` dynamic mode. The tool lets Claude self-pace iterations of a task by sleeping for a chosen interval, then firing again with the same loop prompt.

## When to Use

- Self-pacing a `/loop` dynamic task where the iteration interval depends on work state rather than a fixed clock
- Waiting for a long build, deploy, or test run to finish before checking results
- Inserting idle ticks between iterations when there is no specific signal to watch right now
- Running an autonomous loop with no user prompt — pass the literal sentinel `<<autonomous-loop-dynamic>>` as `prompt`
- Polling a process that is about to change state soon (stay cache-warm with a short delay)

## Activation

- Not available on Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform, or Microsoft Foundry.
- Also off when feature-flag fetching is disabled (telemetry/traffic env vars).

## Parameters

- `delaySeconds` (number, required): Seconds from now to resume. The runtime clamps the value to `[60, 3600]`, so you do not need to clamp it yourself.
- `reason` (string, required): One short sentence explaining the chosen delay. Shown to the user and recorded in telemetry. Be specific — "checking long bun build" is more useful than "waiting."
- `prompt` (string, required): The `/loop` input to fire on wake-up. Pass the same string on every turn so the next firing repeats the task. For an autonomous loop with no user prompt, pass the literal sentinel `<<autonomous-loop-dynamic>>`.

## Examples

### Example 1: short delay to re-check a fast-changing signal (stay cache-warm)

A build was just started and typically finishes in two to three minutes.

```json
{
  "delaySeconds": 120,
  "reason": "checking bun build expected to finish in ~2 min",
  "prompt": "check build status and report any errors"
}
```

120 seconds keeps the conversation context in the Anthropic prompt cache (TTL 5 min), so the next wake-up is faster and cheaper.

### Example 2: long idle tick (accept cache miss, amortize over longer wait)

A database migration is running and typically takes 20–40 minutes.

```json
{
  "delaySeconds": 1200,
  "reason": "migration typically takes 20–40 min; checking back in 20 min",
  "prompt": "check migration status and continue if done"
}
```

The cache will be cold on wake-up, but the 20-minute wait more than amortizes the single cache miss. Polling every 5 minutes would pay the same miss cost 4× for no benefit.

## Notes

- **5-minute cache TTL**: The Anthropic prompt cache expires after 300 seconds. Delays under 300 s keep context warm; delays over 300 s incur a cache miss on the next wake-up.
- **Avoid exactly 300 s**: It is the worst of both worlds — you pay the cache miss without getting a meaningfully longer wait. Either drop to 270 s (stay in cache) or commit to 1200 s or more (one miss buys a much longer wait).
- **Default for idle ticks**: When there is no specific signal to watch, use **1200–1800 s** (20–30 min). This lets the loop check back periodically without burning cache 12× per hour for no reason.
- **Automatic clamping**: The runtime clamps `delaySeconds` to `[60, 3600]`. Values below 60 become 60; values above 3600 become 3600. You do not need to guard these bounds yourself.
- **Omit the call to end the loop**: Do not call ScheduleWakeup if you intend to stop iterating. Simply omitting the call ends the loop.
- **Pass the same `prompt` each turn**: The `prompt` field must carry the original `/loop` instruction on every invocation so the next wake-up knows what task to resume.
