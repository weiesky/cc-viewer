# UltraPlan — 궁극의 소원 머신

## UltraPlan이란

UltraPlan은 Claude Code의 네이티브 `/ultraplan` 명령에 대한 cc-viewer의 **현지화 구현**입니다. Claude의 공식 원격 서비스를 실행할 필요 없이 로컬 환경에서 `/ultraplan`의 전체 기능을 사용할 수 있으며, Claude Code가 **멀티 에이전트 협업**으로 복잡한 계획 및 구현 작업을 수행하도록 안내합니다.

일반 Plan 모드나 Agent Team과 비교하여 UltraPlan은 다음이 가능합니다:
- 다양한 작업 유형에 맞는 **코드 전문가**와 **리서치 전문가** 역할 제공
- 여러 병렬 에이전트를 배치하여 다양한 차원에서 코드베이스 탐색 또는 조사 분석 수행
- 외부 리서치(webSearch)를 통합하여 업계 모범 사례를 참조
- 계획 실행 후 자동으로 Code Review Team을 구성하여 코드 리뷰 수행
- 완전한 **Plan → Execute → Review → Fix** 폐쇄 루프를 형성

---

## 중요 참고사항

### 1. UltraPlan은 만능이 아닙니다
UltraPlan은 더 강력한 소원 머신이지만, 모든 소원이 이루어지는 것은 아닙니다. Plan과 Agent Team보다 강력하지만 직접 "돈을 벌어주지"는 못합니다. 합리적인 작업 단위를 고려하세요 — 큰 목표를 실행 가능한 중간 규모의 작업으로 분할하고, 한 번에 모든 것을 달성하려 하지 마세요.

### 2. 현재 프로그래밍 프로젝트에 가장 효과적
UltraPlan의 템플릿과 워크플로우는 프로그래밍 프로젝트에 깊이 최적화되어 있습니다. 다른 시나리오(문서 작성, 데이터 분석 등)도 시도할 수 있지만, 향후 버전의 적응을 기다리는 것이 좋습니다.

### 3. 실행 시간 및 컨텍스트 윈도우 요구사항
- 성공적인 UltraPlan 실행에는 일반적으로 **30분 이상**이 소요됩니다
- MainAgent에 큰 컨텍스트 윈도우가 필요합니다 (1M context Opus 모델 권장)
- 200K 모델만 있는 경우, **실행 전에 반드시 `/clear`로 컨텍스트를 정리하세요**
- Claude Code의 `/compact`는 컨텍스트 윈도우가 부족하면 성능이 저하됩니다 — 공간이 소진되지 않도록 주의하세요
- 충분한 컨텍스트 공간을 유지하는 것이 UltraPlan 성공 실행의 핵심 전제 조건입니다

현지화된 UltraPlan에 대한 질문이나 제안이 있으시면 [GitHub Issues](https://github.com/anthropics/claude-code/issues)에서 자유롭게 토론에 참여해 주세요.

---

## 작동 원리

UltraPlan은 다양한 유형의 작업에 맞춘 두 가지 전문가 역할을 제공합니다:

### 코드 전문가
프로그래밍 프로젝트를 위한 다중 에이전트 협업 워크플로우:
1. 최대 5개의 병렬 에이전트를 배치하여 코드베이스를 동시에 탐색 (아키텍처 이해, 파일 식별, 위험 평가 등)
2. 선택적으로 webSearch를 통해 업계 솔루션을 조사하는 리서치 에이전트 배치
3. 모든 에이전트의 발견을 종합하여 상세한 구현 계획 생성
4. 여러 관점에서 계획을 검토하는 리뷰 에이전트 배치
5. 계획 승인 후 실행
6. 구현 완료 후 자동으로 Code Review Team을 구성하여 코드 품질 검증

### 리서치 전문가
조사 및 분석 작업을 위한 다중 에이전트 협업 워크플로우:
1. 여러 병렬 에이전트를 배치하여 다양한 차원에서 조사 수행 (업계 조사, 학술 논문, 뉴스, 경쟁사 분석 등)
2. 에이전트를 지정하여 목표 솔루션을 종합하고, 수집된 논문, 뉴스 및 연구 보고서의 엄밀성과 신뢰성을 동시에 검증
3. 선택적으로 제품 데모 제작 에이전트 배치 (HTML, Markdown 등)
4. 모든 에이전트의 발견을 종합하여 포괄적인 구현 계획 생성
5. 여러 리뷰 에이전트를 배치하여 다양한 역할과 관점에서 계획 검토
6. 계획 승인 후 실행

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
