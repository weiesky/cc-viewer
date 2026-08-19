# PushNotification

Sends a desktop notification from the current Claude Code session. If Remote Control is connected, it also pushes to the user's phone, pulling their attention back from wherever they are.

## When to Use

- A long-running task finished while the user was likely away from the terminal
- A build, test run, or deployment completed and the result is ready to review
- You have reached a decision point that requires user input before work can continue
- An error or blocker has surfaced that you cannot resolve autonomously
- The user explicitly asked to be notified when a specific task or condition is met

## When NOT to Use

Do not send a notification for routine progress updates mid-task, or to confirm you have answered a question the user clearly just asked and is still watching. Do not notify when a short task completes — if the user submitted it and is waiting, a notification adds no value and erodes trust for future ones. Err strongly toward not sending one.

## Activation

- Off by default (server-side feature flag).
- Delivery runs through Anthropic-hosted infrastructure — not available on Amazon Bedrock, Claude Platform on AWS, Google Cloud, or Microsoft Foundry.
- Phone push additionally requires a connected Remote Control client.

## Parameters

- `message` (string, required): the notification body. Keep under 200 characters; mobile operating systems truncate longer strings. Lead with what the user would act on: "build failed: 2 auth tests" is more useful than "task complete."
- `status` (string, required): always set to `"proactive"`. This is a fixed marker and does not change.

## Examples

### Example 1: notifying on completion of a long analysis

A repository-wide dependency audit was requested and took several minutes to run. The user stepped away. When the report is ready:

```
message: "Dependency audit done: 3 high-severity CVEs found in lodash, axios, jsonwebtoken. Report at audit-report.txt"
status: "proactive"
```

### Example 2: flagging a decision point during autonomous work

During a multi-step refactor, you discover that two modules have conflicting interfaces and cannot be merged without a design decision:

```
message: "Refactor paused: AuthService and UserService have conflicting token interfaces. Need your call before continuing."
status: "proactive"
```

## Notes

- Err toward **not** sending. The notification interrupts the user regardless of what they are doing. Treat it as a cost that must be justified by the value of the information.
- Lead with actionable content. The first words should tell the user what happened and what, if anything, they need to do — not a generic status label.
- Keep `message` under 200 characters. Mobile operating systems will truncate longer strings, cutting off the most important part if it appears at the end.
- If the result indicates the push was not sent because Remote Control is not connected, that is expected behavior. No retry or follow-up action is needed; the desktop notification still fires locally.
- Avoid notification spam. If you send notifications frequently for minor events, the user will start ignoring them. Reserve this tool for moments where there is a real chance the user has walked away and will want to know the result now.
