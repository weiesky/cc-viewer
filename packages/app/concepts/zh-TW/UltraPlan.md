# UltraPlan — 終極許願機

## 什麼是 UltraPlan

UltraPlan 是 cc-viewer 對 Claude Code 原生 `/ultraplan` 指令的**在地化實作**。它讓您無需啟動 Claude 的官方遠端服務，即可在本地環境中使用 `/ultraplan` 的完整功能，引導 Claude Code 以**多代理協作**的方式完成複雜的規劃與實作任務。

與一般的 Plan 模式或 Agent Team 相比，UltraPlan 能夠：
- 提供**程式碼專家**和**調研專家**兩種角色，針對不同任務類型
- 派遣多個並行代理從不同維度探索程式碼庫或進行調研分析
- 結合外部研究（webSearch）取得業界最佳實踐
- 計劃執行完畢後自動組建 Code Review Team 進行程式碼審查
- 形成完整的 **Plan → Execute → Review → Fix** 閉環

---

## 重要注意事項

### 1. UltraPlan 並非萬能
UltraPlan 是更強大的許願機，但這不代表每個願望都能實現。它比 Plan 和 Agent Team 更強大，但無法直接「幫你賺錢」。請考慮合理的任務粒度——將大目標拆分為可執行的中等規模任務，而不是試圖一步到位。

### 2. 目前對程式專案最為有效
UltraPlan 的模板和工作流程針對程式專案進行了深度最佳化。其他場景（文件撰寫、資料分析等）可以嘗試，但建議等待未來版本的適配。

### 3. 執行時間與上下文視窗需求
- 一次成功的 UltraPlan 執行通常需要 **30 分鐘或更久**
- 需要 MainAgent 擁有大型上下文視窗（建議使用 1M context 的 Opus 模型）
- 如果只有 200K 模型，**務必在執行前 `/clear` 上下文**
- Claude Code 的 `/compact` 在上下文視窗不足時表現不佳——避免空間耗盡
- 維持足夠的上下文空間是 UltraPlan 成功執行的關鍵前提

如果您對在地化 UltraPlan 有任何問題或建議，歡迎到 [GitHub Issues](https://github.com/anthropics/claude-code/issues) 上開啟討論與協作。

---

## 運行原理

UltraPlan 提供兩個專家角色，針對不同類型的任務：

### 程式碼專家
專為程式設計專案設計的多代理協作流程：
1. 派遣最多 5 個並行代理同時探索程式碼庫（架構理解、檔案定位、風險識別等）
2. 可選派遣預研代理透過 webSearch 調研業界方案
3. 綜合所有代理發現，生成詳細的實施計劃
4. 派遣審查代理從多角度審查計劃的完整性
5. 計劃獲批後執行實施
6. 實施完成後自動組建 Code Review Team 驗證程式碼品質

### 調研專家
專為調研分析任務設計的多代理協作流程：
1. 派遣多個並行代理從不同維度進行調研（行業調研、學術論文、新聞資訊、競品分析等）
2. 指派代理綜合目標方案，同時驗證收集到的論文、新聞和研究報告的嚴謹性和可信度
3. 可選派遣代理製作產品 Demo（HTML、Markdown 等）
4. 綜合所有代理發現，生成詳細的實施計劃
5. 派遣多個審查代理從不同角色和視角審查計劃
6. 計劃獲批後執行實施

---

## Raw Templates

Below are the two raw prompt templates UltraPlan actually sends to Claude Code (see `src/utils/ultraplanTemplates.js`):

### Code Expert (codeExpert)

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

### Research Expert (researchExpert)

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
