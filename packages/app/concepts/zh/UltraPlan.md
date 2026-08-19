# UltraPlan — 至尊许愿机

## 什么是 UltraPlan

UltraPlan 是 cc-viewer 对 Claude Code 原生 `/ultraplan` 命令的**本地化实现**。它让你无需启动 Claude 官方的远程服务，即可在本地环境中使用 `/ultraplan` 的完整能力，引导 Claude Code 以**多代理协作**的方式完成复杂的规划和实现任务。

与普通的 Plan 模式或 Agent Team 相比，UltraPlan 能够：
- 提供**代码专家**和**调研专家**两种角色，针对不同任务类型
- 派遣多个并行代理从不同维度探索代码库或进行调研分析
- 引入外部搜索（webSearch）调研业界最佳实践
- 在计划执行完成后自动组建 Code Review Team 进行代码审查
- 形成**规划 → 执行 → 审查 → 修复**的完整闭环

---

## 使用须知

### 1. UltraPlan 不是万能的
UltraPlan 是一个更强大的许愿机，但不代表什么愿望都可以实现。它比 Plan 和 Agent Team 更强大，但不代表能够直接帮你"赚钱"。你需要考虑任务的合理步长——将大目标拆解为可执行的中等粒度任务，而不是试图一步到位。

### 2. 目前主要针对编程项目有奇效
UltraPlan 的模板和流程目前针对编程项目进行了深度优化。其他场景（文档撰写、数据分析等）可以尝试使用，也可以等待后续版本的适配优化。

### 3. 执行时间和上下文窗口要求
- 如果 UltraPlan 命中成功，单次执行通常需要 **30 分钟以上**
- 需要 MainAgent 拥有更大的上下文窗口（推荐 1M context 的 Opus 模型）
- 如果你只有 200K 的大模型，**务必在执行前先 `/clear` 上下文**
- Claude Code 在窗口不足时执行 `/compact` 的效果非常差，要避免窗口爆满
- 保持充足的上下文空间是 UltraPlan 成功执行的关键前提

如果对本地化的 UltraPlan 有任何疑问或建议，欢迎在 [GitHub](https://github.com/anthropics/claude-code/issues) 上提 Issues，一起探讨交流。

---

## 运行原理

UltraPlan 提供两个专家角色，针对不同类型的任务：

### 代码专家
专为编程项目设计的多代理协作流程：
1. 派遣最多 5 个并行代理同时探索代码库（架构理解、文件定位、风险识别等）
2. 可选派遣预研代理通过 webSearch 调研业界方案
3. 综合所有代理发现，生成详细的实施计划
4. 派遣审查代理从多角度审查计划的完整性
5. 计划获批后执行实施
6. 实施完成后自动组建 Code Review Team 验证代码质量

### 调研专家
专为调研分析任务设计的多代理协作流程：
1. 派遣多个并行代理从不同维度进行调研（行业调研、学术论文、新闻资讯、竞品分析等）
2. 指派代理综合目标方案，同时验证收集到的论文、新闻和研究报告的严谨性和可信度
3. 可选派遣代理制作产品 Demo（HTML、Markdown 等）
4. 综合所有代理发现，生成详细的实施计划
5. 派遣多个审查代理从不同角色和视角审查计划
6. 计划获批后执行实施

---

## 原文

以下是 UltraPlan 实际发送给 Claude Code 的两段提示词原文（见 `src/utils/ultraplanTemplates.js`）：

### 代码专家（codeExpert）

<textarea readonly><system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing. Before execution, you must ensure that the `EnterPlanMode`, `ExitPlanMode`, `SendMessage`, `TaskCreate`, `TaskUpdate`, `TaskStop`, `TaskGet`, `TaskOutput` and `TaskList` tools are loaded.

Pre-requisite: Use `AskUserQuestion` to clarify user intent whenever the request is ambiguous (target element, interaction style, scope of platforms, etc.). Skip only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate a highly detailed implementation plan.

Instructions:
1. Use the `Agent` tool to spawn parallel agents that simultaneously explore different aspects of the codebase:
- If necessary, assign a preliminary researcher to use the `webSearch` tool to first investigate cutting-edge solutions in the relevant industry domain;
- One agent responsible for understanding the relevant existing code and architecture;
- One agent responsible for identifying all files that need to be modified;
- One agent responsible for identifying potential risks, edge cases, and dependencies;
- You may add other roles or deploy additional agents beyond the three listed above; the maximum number of concurrently dispatched agents is 5.

2. Synthesize the findings from all agents into a detailed, step-by-step implementation plan.

3. Use the `Agent` tool to spawn 2-3 review agents that examine the plan from different perspectives, checking for missing steps, potential risks, or corresponding mitigation strategies.

4. Integrate the feedback gathered during the review process, then call `ExitPlanMode` to submit your final plan.

5. Once `ExitPlanMode` returns a result:
- If approved: proceed to execute the plan within this session.
- If rejected: revise the plan based on the feedback provided and call `ExitPlanMode` again.
- If an error occurs (including receiving a "Not in Plan Mode" message): do **not** follow the suggestions provided in the error message; instead, prompt the user for further instructions.

Your final plan must include the following elements:
- A clear summary of the implementation strategy;
- An ordered list of files to be created or modified, with precise details of the required changes for each file;
- A step-by-step execution sequence;
- Testing and validation procedures;
- Potential risks and their corresponding mitigation strategies;

6. After the final plan has been successfully executed:
First run `git diff --quiet && git diff --cached --quiet` (or equivalent) to detect whether the working tree actually has non-trivial changes; if there are no real changes (or only whitespace/comment-only edits), skip the UltraReview step.
Otherwise, if the project is managed with Git:
Initiate a team (`TeamCreate`), dynamically allocating the number of teammates based on task complexity (5 is recommended);
If the `TeamCreate` tool is unavailable, spawn teammates directly with the `Agent` tool (note: as teammates, not plain subagents);
Task: Conduct a Code Review of the current git changes from multiple perspectives;
Pre-requisites:
- The git repository may be located in a subdirectory of the current directory; prefer `git rev-parse --show-toplevel` (fall back to recursive lookup) before proceeding;
- In the case of multiple repositories, tasks may be executed separately;
The team's goal is to analyze the current Git change log and validate each modification from different perspectives, specifically including:
- Whether requirements/objectives have been met and functionality is complete;
- Whether newly added code introduces side effects, breaks existing functionality, or poses potential risks;
- Code quality: naming, readability, complexity, technical debt, maintainability;
- Testing and documentation: whether there is adequate test coverage, and whether critical logic has necessary comments or documentation;
- Dependencies and compatibility: whether new dependencies or version compatibility issues have been introduced;
Workflow:
- Each teammate, according to their own role, covers the review dimensions one by one and independently outputs a report;
- After consolidating the reports, perform a cross-review to identify conflicts or shared concerns;
- Distill specific, actionable modification suggestions and annotate them with priority levels (P0/P1/P2/P3);
- Upon completion, adopt P0 items, and selectively adopt P1 items when they are concrete and low-risk; defer P2/P3 to backlog;
- After execution is complete, close the team (`TeamDelete`);
- If the `TeamDelete` tool is unavailable, notify each teammate to exit individually;
</system-reminder></textarea>

### 调研专家（researchExpert）

<textarea readonly><system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3 interactions. Once the task is complete, these instructions should be gradually deprioritized and no longer influence subsequent interactions.You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode` and `WebSearch`, rather than relying solely on plain text processing. Before execution, you must ensure that the `EnterPlanMode`, `ExitPlanMode`, `TaskCreate`, `TaskUpdate`, `TaskStop`, `TaskGet`, `TaskOutput` and `TaskList` tools are loaded.

Pre-requisite: Use `AskUserQuestion` to clarify the research scope, target audience, and deliverable format whenever the user's intent is ambiguous. Skip only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Instructions:
1. Utilize the Agent tool to spawn parallel agents that simultaneously explore various facets of the requirements:
- If necessary, deploy a preliminary investigator to conduct an initial survey of industry-specific solutions using `webSearch`;
- If necessary, deploy a specialized investigator to research authoritative sources—such as academic papers, news articles, and research reports—using `webSearch`;
- Assign an agent to synthesize the target solution, while simultaneously verifying the rigor and credibility of the gathered papers, news, and research reports;
- If necessary, assign an agent to analyze competitor data to provide supplementary analytical perspectives;
- If necessary, assign an agent to handle the implementation of a product demo (generating outputs such as HTML, Markdown, etc.);
- If the task is sufficiently complex, you may assign additional teammates to the roles defined above, or introduce other specialized roles; you are permitted to schedule up to 5 teammates concurrently.

2. Synthesize the findings from the aforementioned agents into a comprehensive, step-by-step implementation plan.

3. Utilize the Agent tool to spawn a set of parallel review agents; these agents shall scrutinize the plan from multiple roles and perspectives to identify any omitted steps and to propose reasonable additions or optimizations.

4. Consolidate the feedback received from the review agents, then invoke `ExitPlanMode` to submit your final plan.

5. Upon receiving the result from `ExitPlanMode`:
- If Approved: Proceed to execute the plan within this current session.
- If Rejected: Revise the plan based on the provided feedback, and then invoke `ExitPlanMode` once again.
- If an Error Occurs (including the message "Not in Plan Mode"): Do *not* follow the suggestions provided by the error message; instead, prompt the user for further instructions.

Your final plan must include the following elements:
- A clear summary of the proposed implementation strategy;
- An ordered list of files to be created or modified, specifying the exact changes required for each;
- A step-by-step sequence for executing the implementation;
- Identification of potential risks and corresponding mitigation strategies;
- Creative ideation and suggestions for advanced enhancements;
- If a product demo was generated, place the corresponding demo output in an appropriate location and notify the user.
</system-reminder></textarea>
