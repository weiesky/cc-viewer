# EnterPlanMode

Switches the session into plan mode, a read-only exploration phase in which the assistant investigates the codebase and drafts a concrete implementation plan for the user to approve before any files are modified.

## When to Use

- The user asks for a non-trivial change that spans multiple files or subsystems.
- Requirements are ambiguous and the assistant needs to read code before committing to an approach.
- A refactor, migration, or dependency upgrade is proposed and the blast radius is unclear.
- The user explicitly says "plan this", "let's plan first", or requests a design review.
- Risk is high enough that moving straight to edits could waste work or damage state.

## Parameters

None. `EnterPlanMode` takes no arguments — invoke it with an empty parameter object.

## Examples

### Example 1: Large feature request

The user asks: "Add SSO via Okta to the admin panel." The assistant calls `EnterPlanMode`, then spends several turns reading auth middleware, session storage, route guards, and existing login UI. It writes a plan describing required changes, migration steps, and test coverage, then submits via `ExitPlanMode` for approval.

### Example 2: Risky refactor

The user says: "Convert the REST controllers to tRPC." The assistant enters plan mode, surveys each controller, catalogs the public contract, lists rollout phases (shim, dual-read, cutover), and proposes a sequencing plan before touching any file.

## Notes

- Plan mode is read-only by contract. While inside it, the assistant must not run `Edit`, `Write`, `NotebookEdit`, or any mutating shell command. Use `Read`, `Grep`, `Glob`, and non-destructive `Bash` commands only.
- Do not enter plan mode for trivial one-liner edits, pure research questions, or tasks where the user has already specified the change in full detail. The overhead hurts more than it helps.
- Under Auto mode, plan mode is discouraged unless the user explicitly requests it — Auto mode prefers action over up-front planning.
- Use plan mode to reduce course-corrections on expensive work. A five-minute plan often saves an hour of misdirected edits.
- Once in plan mode, focus investigation on the parts of the system that will actually change. Avoid exhaustive tours of the repository unrelated to the task at hand.
- The plan itself should be written to disk at the path the harness expects so that `ExitPlanMode` can submit it. The plan should contain concrete file paths, function names, and verification steps, not vague intent.
- The user may reject the plan and ask for revisions. Iterate inside plan mode until the plan is accepted; only then exit.
