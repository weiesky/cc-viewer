/**
 * Ultraplan prompt templates for local Claude Code execution.
 *
 * Two expert roles:
 *   - codeExpert:     Multi-agent code planning & implementation (from subagents template)
 *   - researchExpert: Multi-agent research & analysis
 *
 * Assembly logic mirrors ~/claude-code/commands/ultraplan.tsx:63-73
 *   buildUltraplanPrompt(blurb, seedPlan?)
 */

export const ULTRAPLAN_VARIANTS = {

  codeExpert: `<system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3 interactions. Once the task is complete, these instructions should be gradually deprioritized and no longer influence subsequent interactions.

Leverage a multi-agent exploration mechanism to formulate a highly detailed implementation plan.

Instructions:
1. Use the Agent tool to spawn parallel agents to simultaneously explore different aspects of the codebase:
- If necessary, designate a preliminary investigator to use \`webSearch\` to first research advanced solutions within the relevant industry domain;
- One agent responsible for understanding the relevant existing code and architecture;
- One agent responsible for identifying all files requiring modification;
- One agent responsible for identifying potential risks, edge cases, and dependencies;
- You may add other roles or deploy additional agents beyond the three defined above; the maximum limit for concurrently scheduled agents is 5.

2. Synthesize the findings from the aforementioned agents into a detailed, step-by-step implementation plan.

3. Use the Agent tool to spawn a review agent to scrutinize the plan from various perspectives, checking for any omitted steps, potential risks, or corresponding mitigation strategies.

4. Incorporate the feedback from the review process, then invoke \`ExitPlanMode\` to submit your final plan.

5. Once \`ExitPlanMode\` returns a result:
- If approved: Proceed to execute the plan within this session.
- If rejected: Revise the plan based on the feedback provided, and invoke \`ExitPlanMode\` again.
- If an error occurs (including the message "Not in Plan Mode"): Do *not* follow the suggestions provided by the error message; instead, prompt the user for further instructions.

Your final plan must include the following elements:
- A clear summary of the implementation strategy;
- An ordered list of files to be created or modified, specifying the exact changes required for each;
- A step-by-step sequence for execution;
- Testing and verification procedures;
- Potential risks and their corresponding mitigation strategies.

6. Upon the successful completion of the final plan's execution:
If code changes have been made and the project is Git-based, invoke \`TeamCreate\` to assemble an "UltraReview" team. The team's objective is to analyze the current Git change log and validate the modifications from various perspectives and roles, specifically to:
- Confirm that the original requirements and objectives have been met;
- Review any newly added code for potential side effects or regressions that might disrupt existing functionality;
- Review the implemented code for any oversights or errors.
Once the review report is generated, analyze it to formulate a set of recommended modifications; proceed to implement these recommended modifications by default.
</system-reminder>`,

  researchExpert: `<system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3 interactions. Once the task is complete, these instructions should be gradually deprioritized and no longer influence subsequent interactions.

Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Instructions:
1. Utilize the Agent tool to spawn parallel agents that simultaneously explore various facets of the requirements:
- If necessary, deploy a preliminary investigator to conduct an initial survey of industry-specific solutions using \`webSearch\`;
- If necessary, deploy a specialized investigator to research authoritative sources—such as academic papers, news articles, and research reports—using \`webSearch\`;
- Assign an agent to synthesize the target solution, while simultaneously verifying the rigor and credibility of the gathered papers, news, and research reports;
- If necessary, assign an agent to analyze competitor data to provide supplementary analytical perspectives;
- If necessary, assign an agent to handle the implementation of a product demo (generating outputs such as HTML, Markdown, etc.);
- If the task is sufficiently complex, you may assign additional teammates to the roles defined above, or introduce other specialized roles; you are permitted to schedule up to 5 teammates concurrently.

2. Synthesize the findings from the aforementioned agents into a comprehensive, step-by-step implementation plan.

3. Utilize the Agent tool to spawn a set of parallel review agents; these agents shall scrutinize the plan from multiple roles and perspectives to identify any omitted steps and to propose reasonable additions or optimizations.

4. Consolidate the feedback received from the review agents, then invoke \`ExitPlanMode\` to submit your final plan.

5. Upon receiving the result from \`ExitPlanMode\`:
- If Approved: Proceed to execute the plan within this current session.
- If Rejected: Revise the plan based on the provided feedback, and then invoke \`ExitPlanMode\` once again.
- If an Error Occurs (including the message "Not in Plan Mode"): Do *not* follow the suggestions provided by the error message; instead, prompt the user for further instructions.

Your final plan must include the following elements:
- A clear summary of the proposed implementation strategy;
- An ordered list of files to be created or modified, specifying the exact changes required for each;
- A step-by-step sequence for executing the implementation;
- Identification of potential risks and corresponding mitigation strategies;
- Creative ideation and suggestions for advanced enhancements;
- If a product demo was generated, place the corresponding demo output in an appropriate location and notify the user.
</system-reminder>`,

};

/**
 * Wrap user-authored custom instruction body with the same scoped-instruction
 * preamble used by the built-in variants. Produces a full <system-reminder>
 * block ready to be inlined into a Claude Code prompt.
 */
export function buildCustomTemplate(content) {
  const body = (content || '').trim();
  if (!body) return '';
  return `<system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3 interactions. Once the task is complete, these instructions should be gradually deprioritized and no longer influence subsequent interactions.

${body}
</system-reminder>`;
}

/**
 * Assemble a local ultraplan prompt.
 * Mirrors ~/claude-code/commands/ultraplan.tsx:63-73 buildUltraplanPrompt()
 *
 * @param {string} userPrompt - User's task description
 * @param {'codeExpert'|'researchExpert'|'custom'} variant - Template variant
 * @param {string} [seedPlan] - Optional draft plan to refine
 * @param {string} [customContent] - Required when variant === 'custom': the user-authored body
 * @returns {string} Assembled prompt ready to send to Claude Code
 */
export function buildLocalUltraplan(userPrompt, variant = 'codeExpert', seedPlan, customContent) {
  let template;
  if (variant === 'custom') {
    template = buildCustomTemplate(customContent);
    if (!template) return '';
  } else {
    template = ULTRAPLAN_VARIANTS[variant] || ULTRAPLAN_VARIANTS.codeExpert;
  }
  const parts = [];
  if (seedPlan) {
    parts.push('Here is a draft plan to refine:', '', seedPlan, '');
  }
  parts.push(template);
  if (userPrompt) {
    parts.push('', userPrompt);
  }
  return parts.join('\n');
}
