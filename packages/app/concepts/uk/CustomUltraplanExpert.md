# Custom UltraPlan Expert — Посібник зі створення

## Що роблять два поля введення

- **Ім'я експерта**: підпис, що відображається на кнопці ролі у рядку варіантів UltraPlan (макс. 30 символів). Це просто відображуване ім'я, і воно **ніколи** не надсилається до Claude Code.
- **Тіло промпту**: ваша інструкція ролі. Коли ви створюєте нового експерта, редактор **уже заповнений** обгорткою `<system-reminder>...</system-reminder>` із заголовком області `[SCOPED INSTRUCTION]` — **пишіть свою інструкцію ролі всередині обгортки**. cc-viewer не обгортає двічі: якщо обгортка присутня, вона надсилається як є; якщо ви її видалите, cc-viewer додасть її назад під час надсилання.

---

## Як виглядає шаблон експерта?

Кожен вбудований експерт (Code Expert / Research Expert) — це, по суті, блок `<system-reminder>`, що впроваджується у контекст Claude Code. Ваш користувацький експерт проходить через той самий конвеєр. Ось розбір шаблону **Research Expert**:

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

## Розбір за розділами

### 1. Заголовок області `[SCOPED INSTRUCTION]` (обгортка — заповнена для вас)
> The following instructions are intended for the next 1–3 interactions...

Це повідомляє Claude Code: **ці інструкції активні лише для наступних 1–3 ходів**, потім згасають. Запобігає «витоку» «персони експерта» у подальші непов'язані діалоги.

**Цей рядок уже заповнений у редакторі — залиште його як є; вам не потрібно його переписувати.**

### 2. Початкове визначення завдання (**це те, що ви маєте переписати**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Це «підмет-присудок-додаток» усього шаблону: **він повідомляє Claude Code позицію та мету**. Стандартна «багатоагентна розвідка + план реалізації» добре підходить для задач **програмної інженерії / планування**, але виглядає незграбно для багатьох інших галузей (рецензування контенту, аналіз даних, копірайтинг, маркетингові дослідження, аудит відповідності…).

**Ми наполегливо рекомендуємо переписати цей рядок під вашу мету**, наприклад:

- **Рецензент контенту**: "You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **Конкурентний аналітик**: "Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **Копірайтер**: "Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. Кроки робочого процесу (1–5 пунктів — **скоротіть або розширте залежно від складності**)

Research Expert містить 5 кроків: **дослідження → синтез → рев'ю → надсилання плану → виконання**. Це забезпечує «паралельну багатоагентну роботу + перехресне рев'ю + затвердження плану» — три рівні строгості, придатні для задач високих ставок/широкого охоплення, але **надлишкові для легких**.

- **Просте завдання** (одиночний пошук / маленьке виправлення): відмовтеся від диспетчеризації багатоагентності та рев'ю; просто «видайте відповідь» за один крок.
- **Помірне завдання**: залиште «дослідження → синтез → рев'ю»; приберіть танець з ExitPlanMode; видайте результат напряму.
- **Складне, дороге завдання** (великий рефакторинг, порівняння кількох варіантів, крос-доменне дослідження): збережіть усі 5 кроків, можливо додайте крок «модель ризиків» або «матриця порівняння варіантів».

### 4. Підролі у кроці 1 (**адаптуйте під вашу галузь**)

Research Expert перелічує 6 потенційних ролей (галузевий розвідник, академічний дослідник, синтезатор + перевіряючий факти, аналітик конкурентів, продюсер демо, розширюваний слот). **Перепишіть цей список під ваш сценарій**:

- **Письмо**: "source collector + style analyst + fact checker"
- **Аналіз даних**: "data-cleaning agent + statistical modeling agent + visualization agent"
- **Аудит коду**: "static-analysis agent + dependency-chain auditor + threat modeler"

### 5. Контрольний список підсумкового результату (**узгодьте з вашою реальною потребою**)

> Your final plan must include the following elements: ...

Оригінальний шаблон перелічує 6 елементів «плану реалізації». Ваш підсумковий результат може бути цілком іншим:

- **Дослідницький звіт** → "Executive summary / Methodology / Key findings / Limitations / Action recommendations"
- **Звіт про рев'ю** → "Issue list / Severity rating / Fix suggestions / Before-after examples"
- **Матриця порівняння** → "Dimension definitions / Scoring rubric / Conclusions / Recommendation rationale"

---

## Поради щодо створення (TL;DR)

1. **Перепишіть вступне речення**: вкажіть роль, мету та формат виводу в одному рядку.
2. **Гнучко використовуйте робочий процес**: 1–2 кроки для легких завдань, повний 5-кроковий цикл — лише для складних.
3. **Перепишіть підролі кроку 1**: стандартні (академічні статті / конкуренти / демо), ймовірно, не те, що вам потрібно.
4. **Фінальний «контрольний список результату» — це ваша планка якості**: пропишіть структуру виводу — Claude Code суворо її дотримуватиметься.

---

## Рефакторений приклад: Competitive Analyst

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

Порівняно з оригінальним Research Expert: скорочено до 4 кроків, підролі зменшено з 6 до 3, список результатів повністю переписано як «розділи звіту».
