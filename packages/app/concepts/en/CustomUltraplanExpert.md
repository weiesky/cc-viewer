# Custom UltraPlan Expert — Authoring Guide

## What the two input fields do

- **Expert name**: the label shown on the role button in the UltraPlan variant row (30-char max). It's just a display name and is **never** sent to Claude Code.
- **Prompt body**: your role instruction. When you create a new expert, the editor **comes prefilled** with the `<system-reminder>...</system-reminder>` wrapper and its `[SCOPED INSTRUCTION]` scope header — **write your role instruction inside the wrapper**. cc-viewer won't double-wrap: if the wrapper is present it is sent as-is; if you remove it, cc-viewer adds one back at send time.

---

## What does the expert template look like?

Every built-in expert (Code Expert / Research Expert) is essentially a `<system-reminder>` block injected into Claude Code's context. Your custom expert goes through the exact same pipeline. Here's the **Research Expert** template broken down:

```xml
<system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3
interactions. Once the task is complete, these instructions should be gradually
deprioritized and no longer influence subsequent interactions.

Pre-requisite: Use `AskUserQuestion` to clarify the research scope, target
audience, and deliverable format whenever the user's intent is ambiguous. Skip
only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate an exceptionally
detailed implementation plan.

Instructions:
1. Utilize the Agent tool to spawn parallel agents that simultaneously explore
   various facets of the requirements:
   - If necessary, deploy a preliminary investigator to conduct an initial
     survey of industry-specific solutions using `webSearch`;
   - If necessary, deploy a specialized investigator to research authoritative
     sources—such as academic papers, news articles, and research reports—
     using `webSearch`;
   - Assign an agent to synthesize the target solution, while simultaneously
     verifying the rigor and credibility of the gathered papers, news, and
     research reports;
   - If necessary, assign an agent to analyze competitor data to provide
     supplementary analytical perspectives;
   - If necessary, assign an agent to handle the implementation of a product
     demo (generating outputs such as HTML, Markdown, etc.);
   - If the task is sufficiently complex, you may assign additional teammates
     to the roles defined above, or introduce other specialized roles; you are
     permitted to schedule up to 5 teammates concurrently.

2. Synthesize the findings from the aforementioned agents into a comprehensive,
   step-by-step implementation plan.

3. Utilize the Agent tool to spawn a set of parallel review agents; these
   agents shall scrutinize the plan from multiple roles and perspectives to
   identify any omitted steps and to propose reasonable additions or
   optimizations.

4. Consolidate the feedback received from the review agents, then invoke
   `ExitPlanMode` to submit your final plan.

5. Upon receiving the result from `ExitPlanMode`:
   - If Approved: Proceed to execute the plan within this current session.
   - If Rejected: Revise the plan based on the provided feedback, and then
     invoke `ExitPlanMode` once again.
   - If an Error Occurs: Do *not* follow the suggestions; prompt the user for
     further instructions.

Your final plan must include the following elements:
- A clear summary of the proposed implementation strategy;
- An ordered list of files to be created or modified, specifying the exact
  changes required for each;
- A step-by-step sequence for executing the implementation;
- Identification of potential risks and corresponding mitigation strategies;
- Creative ideation and suggestions for advanced enhancements;
- If a product demo was generated, place the corresponding demo output in an
  appropriate location and notify the user.
</system-reminder>
```

---

## Section-by-section breakdown

### 1. `[SCOPED INSTRUCTION]` scope header (wrapper — prefilled for you)
> The following instructions are intended for the next 1–3 interactions...

This tells Claude Code: **these instructions are only active for the next 1–3 turns**, then fade out. Prevents the "expert persona" from leaking into unrelated conversation afterwards.

**This line comes prefilled in the editor — keep it as-is; you don't need to rewrite it.**

### 2. Opening task definition (**this is what you should rewrite**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

This is the "subject-verb-object" of the whole template: **it tells Claude Code the posture and objective**. The default "multi-agent exploration + implementation plan" fits **software engineering / planning** tasks well, but feels awkward for many other domains (content review, data analysis, copywriting, market research, compliance audit…).

**We strongly recommend rewriting this line for your objective**, for example:

- **Content reviewer**: "You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **Competitive analyst**: "Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **Copywriter**: "Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. Workflow steps (1–5 items — **trim or extend based on complexity**)

The Research Expert has 5 steps: **explore → synthesize → review → submit plan → execute**. This enforces "parallel multi-agent + cross-review + plan approval" — three layers of rigor, appropriate for high-stakes/wide-scope tasks but **overkill for lightweight ones**.

- **Simple task** (single lookup / small fix): drop the multi-agent dispatch and review; just "produce the answer" in one step.
- **Moderate task**: keep "explore → synthesize → review"; drop the ExitPlanMode dance; deliver the result directly.
- **Complex, high-cost task** (large refactor, multi-option comparison, cross-domain research): keep all 5 steps, possibly add a "risk model" or "option-comparison matrix" step.

### 4. Sub-roles in Step 1 (**tailor to your domain**)

Research Expert lists 6 potential roles (industry scout, academic researcher, synthesizer + fact-checker, competitor analyst, demo producer, extensibility slot). **Rewrite this list for your scenario**:

- **Writing**: "source collector + style analyst + fact checker"
- **Data analysis**: "data-cleaning agent + statistical modeling agent + visualization agent"
- **Code audit**: "static-analysis agent + dependency-chain auditor + threat modeler"

### 5. Final deliverable checklist (**align with your real need**)

> Your final plan must include the following elements: ...

The original template lists 6 elements of an "implementation plan". Your deliverable could be something else entirely:

- A **research report** → "Executive summary / Methodology / Key findings / Limitations / Action recommendations"
- A **review report** → "Issue list / Severity rating / Fix suggestions / Before-after examples"
- A **comparison matrix** → "Dimension definitions / Scoring rubric / Conclusions / Recommendation rationale"

---

## Authoring tips (TL;DR)

1. **Rewrite the opening sentence**: state the role, goal, and output format in one line.
2. **Flex the workflow**: 1–2 steps for light tasks, the full 5-step loop only for complex ones.
3. **Rewrite Step 1 sub-roles**: the defaults (academic papers / competitors / demo) are probably not what you want.
4. **The final "deliverable checklist" is your quality bar**: spell out the output structure — Claude Code will follow it strictly.

---

## A refactored example: Competitive Analyst

```
<system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing.

You are a senior competitive intelligence analyst for {industry}. Your goal is to
produce a decision-grade competitive landscape report for the product "{our product}".

Instructions:
1. Use the Agent tool to dispatch 3 parallel investigators:
   - Market landscape agent: map the top 5–8 competitors with core positioning
   - Feature matrix agent: compile a feature-by-feature comparison using
     publicly available sources (webSearch)
   - Pricing & GTM agent: analyze pricing models, distribution channels, and
     go-to-market motions

2. Synthesize the three streams into a unified competitive report.

3. Dispatch one review agent to stress-test the report: challenge any
   assumption lacking a cited source, flag outdated data (>12 months), and
   propose one "non-obvious" insight.

4. Deliver the final report with the following sections:
   - TL;DR (3 bullets)
   - Competitor positioning map
   - Feature matrix (markdown table)
   - Pricing & GTM table
   - Top 3 strategic implications for our product
   - Caveats & data gaps
</system-reminder>
```

Compared to the original Research Expert: trimmed to 4 steps, sub-roles reduced from 6 to 3, deliverable list fully rewritten as "report sections".
