# ReportFindings

Report code-review findings as a typed, structured list that the host UI renders natively — instead of printing them as chat text.

## When to Use

- Concluding a code review whose active instructions explicitly say to report findings with this tool
- Re-reporting after applying fixes, when the review's apply instructions ask for it (each finding then carries an `outcome`)
- **Not** for ad-hoc opinions, ordinary answers, or reviews whose instructions specify a different output format — and never alongside a text duplicate of the same findings

## Parameters

- `findings` (array, required, max 32): The verified findings, ranked most-severe first — an empty array if nothing survived verification. Each finding:
  - `file` (string, required): Repo-relative path.
  - `line` (number, optional): 1-indexed anchor line.
  - `summary` (string, required): One-sentence statement of the defect.
  - `failure_scenario` (string, required): Concrete inputs/state → wrong output or crash.
  - `category` (string, optional): Short kebab-case slug, e.g. `correctness`, `simplification`, `efficiency`, `test-coverage`.
  - `verdict` (string, optional): `CONFIRMED` or `PLAUSIBLE` — set when a verify pass ran; absent on inline-only reviews.
  - `outcome` (string, optional): ONLY when re-reporting after fixes — `fixed`, `skipped`, or `no_change_needed`.
- `level` (string, optional): The effort level the review ran at — `low`, `medium`, `high`, `xhigh`, or `max`.

## Notes

- **Call it once.** A single call with the complete, verified, severity-ranked list — not one call per finding.
- **Empty is a valid result.** If no finding survived verification, report an empty array rather than padding with weak findings.
- **Don't duplicate in text.** When this tool reports the results, the findings must not also be printed as a chat message.
- **`outcome` is for re-reports only.** On the first report leave it unset; after an apply pass, set what actually happened to each finding.
