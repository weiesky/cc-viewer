---
"cc-viewer": minor
---

Add a new "Test Analysis Expert" (测分专家) UltraPlan preset expert (`packages/content/ultraAgents/test-analysis-expert.json`). The preset drives a UI test-analysis workflow in local Claude Code: gated materials intake (system-analysis docs / requirements / SUT repo / environment context), multi-agent analysis, a test-point matrix with test-design decision rules (EP+BVA, decision tables, state-transition, pairwise, risk-based), then generation of Midscene.js YAML automation flows under an anti-oracle-compliance guardrail (expectations come from the specification, never from the current implementation — suspected-bug flows are isolated), plus static review-agent validation. UI layer only; generation only, never executes the flows. Title/description are inline-localized across all 18 languages.
