# UltraPlan — Идеальная Машина Желаний

## Что такое UltraPlan

UltraPlan — это **локализованная реализация** нативной команды `/ultraplan` Claude Code от cc-viewer. Он позволяет использовать полные возможности `/ultraplan` в вашем локальном окружении **без необходимости запуска официального удалённого сервиса Claude**, направляя Claude Code на выполнение сложных задач планирования и реализации с использованием **мультиагентного взаимодействия**.

По сравнению с обычным режимом Plan или Agent Team, UltraPlan способен:
- Предлагает роли **Эксперт по коду** и **Эксперт по исследованиям** для различных типов задач
- Развёртывание нескольких параллельных агентов для исследования кодовой базы или проведения аналитики с разных сторон
- Использовать внешние исследования (webSearch) для получения лучших отраслевых практик
- Автоматически формировать команду Code Review после выполнения плана для ревью кода
- Создавать полный замкнутый цикл **План → Выполнение → Ревью → Исправление**

---

## Важные замечания

### 1. UltraPlan не всемогущ
UltraPlan — это более мощная машина желаний, но это не значит, что каждое желание может быть исполнено. Он мощнее, чем Plan и Agent Team, но не может напрямую «заработать вам деньги». Учитывайте разумную гранулярность задач — разбивайте большие цели на выполнимые задачи среднего размера, а не пытайтесь достичь всего за один раз.

### 2. В настоящее время наиболее эффективен для программных проектов
Шаблоны и рабочие процессы UltraPlan глубоко оптимизированы для программных проектов. Другие сценарии (документация, анализ данных и т.д.) можно попробовать, но возможно стоит подождать адаптации в будущих версиях.

### 3. Время выполнения и требования к контекстному окну
- Успешный запуск UltraPlan обычно занимает **30 минут или более**
- Требует, чтобы MainAgent имел большое контекстное окно (рекомендуется модель Opus с контекстом 1M)
- Если у вас только модель на 200K, **обязательно выполните `/clear` контекста перед запуском**
- Команда `/compact` Claude Code работает плохо при недостаточном контекстном окне — не допускайте исчерпания пространства
- Поддержание достаточного пространства контекста является критически важным условием для успешного выполнения UltraPlan

Если у вас есть вопросы или предложения по локализованному UltraPlan, не стесняйтесь открывать [Issues на GitHub](https://github.com/anthropics/claude-code/issues) для обсуждения и сотрудничества.

---

## Принцип работы

UltraPlan предлагает две экспертные роли для разных типов задач:

### Эксперт по коду
Мультиагентный рабочий процесс для программных проектов:
1. Развёртывание до 5 параллельных агентов для одновременного исследования кодовой базы (архитектура, идентификация файлов, оценка рисков и т.д.)
2. Опционально: развёртывание исследовательского агента для изучения отраслевых решений через webSearch
3. Синтез всех находок агентов в детальный план реализации
4. Развёртывание агента-рецензента для проверки плана с нескольких перспектив
5. Выполнение плана после утверждения
6. Автоматическое формирование Code Review Team для проверки качества кода после реализации

### Эксперт по исследованиям
Мультиагентный рабочий процесс для задач исследования и анализа:
1. Развёртывание нескольких параллельных агентов для исследований с разных сторон (отраслевые обзоры, научные статьи, новости, конкурентный анализ и т.д.)
2. Назначение агента для синтеза целевого решения с одновременной проверкой строгости и достоверности собранных источников
3. Опционально: развёртывание агента для создания демо продукта (HTML, Markdown и т.д.)
4. Синтез всех находок в комплексный план реализации
5. Развёртывание нескольких агентов-рецензентов для проверки плана с разных ролей и перспектив
6. Выполнение плана после утверждения

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
