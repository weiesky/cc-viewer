# Custom UltraPlan Expert — Руководство по созданию

## Что делают два поля ввода

- **Имя эксперта**: подпись, отображаемая на кнопке роли в строке вариантов UltraPlan (макс. 30 символов). Это просто отображаемое имя, и оно **никогда** не отправляется в Claude Code.
- **Тело промпта**: ваша инструкция роли. При создании нового эксперта редактор **предзаполнен** обёрткой `<system-reminder>...</system-reminder>` с её заголовком области `[SCOPED INSTRUCTION]` — **пишите свою инструкцию роли внутри обёртки**. cc-viewer не оборачивает дважды: если обёртка присутствует, она отправляется как есть; если вы её удалите, cc-viewer добавит новую при отправке.

---

## Как выглядит шаблон эксперта?

Каждый встроенный эксперт (Code Expert / Research Expert) — это, по сути, блок `<system-reminder>`, внедряемый в контекст Claude Code. Ваш пользовательский эксперт проходит через тот же самый конвейер. Вот разбор шаблона **Research Expert**:

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

## Разбор по разделам

### 1. Заголовок области `[SCOPED INSTRUCTION]` (обёртка — предзаполнена за вас)
> The following instructions are intended for the next 1–3 interactions...

Это говорит Claude Code: **эти инструкции активны только для следующих 1–3 ходов**, затем затухают. Предотвращает «утечку» «персоны эксперта» в последующие несвязанные диалоги.

**Эта строка предзаполнена в редакторе — оставьте её как есть; вам не нужно её переписывать.**

### 2. Начальное определение задачи (**это то, что вы должны переписать**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Это «подлежащее-сказуемое-дополнение» всего шаблона: **оно сообщает Claude Code позицию и цель**. Дефолтная «многоагентная разведка + план реализации» хорошо подходит для задач **программной инженерии / планирования**, но выглядит неуклюже для многих других областей (рецензирование контента, анализ данных, копирайтинг, маркетинговые исследования, аудит соответствия…).

**Мы настоятельно рекомендуем переписать эту строку под вашу цель**, например:

- **Рецензент контента**: "You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **Конкурентный аналитик**: "Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **Копирайтер**: "Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. Шаги рабочего процесса (1–5 пунктов — **сократите или расширьте в зависимости от сложности**)

Research Expert содержит 5 шагов: **исследование → синтез → ревью → отправка плана → выполнение**. Это обеспечивает «параллельная многоагентная работа + перекрёстное ревью + утверждение плана» — три уровня строгости, подходящие для задач высокой ставки/широкого охвата, но **избыточные для лёгких**.

- **Простая задача** (одиночный поиск / маленькая правка): откажитесь от диспетчеризации многоагентности и ревью; просто «выдайте ответ» в один шаг.
- **Умеренная задача**: оставьте «исследование → синтез → ревью»; уберите танец с ExitPlanMode; выдайте результат напрямую.
- **Сложная, дорогостоящая задача** (крупный рефакторинг, сравнение нескольких вариантов, кросс-доменное исследование): сохраните все 5 шагов, возможно добавьте шаг «модель рисков» или «матрица сравнения вариантов».

### 4. Подроли в шаге 1 (**адаптируйте под вашу область**)

Research Expert перечисляет 6 потенциальных ролей (отраслевой разведчик, академический исследователь, синтезатор + проверяющий факты, аналитик конкурентов, продюсер демо, расширяемый слот). **Перепишите этот список под ваш сценарий**:

- **Письмо**: "source collector + style analyst + fact checker"
- **Анализ данных**: "data-cleaning agent + statistical modeling agent + visualization agent"
- **Аудит кода**: "static-analysis agent + dependency-chain auditor + threat modeler"

### 5. Контрольный список итогового результата (**согласуйте с вашей реальной потребностью**)

> Your final plan must include the following elements: ...

Оригинальный шаблон перечисляет 6 элементов «плана реализации». Ваш итоговый результат может быть совершенно другим:

- **Исследовательский отчёт** → "Executive summary / Methodology / Key findings / Limitations / Action recommendations"
- **Отчёт о ревью** → "Issue list / Severity rating / Fix suggestions / Before-after examples"
- **Матрица сравнения** → "Dimension definitions / Scoring rubric / Conclusions / Recommendation rationale"

---

## Советы по созданию (TL;DR)

1. **Перепишите вступительное предложение**: укажите роль, цель и формат вывода в одной строке.
2. **Гибко используйте рабочий процесс**: 1–2 шага для лёгких задач, полный 5-шаговый цикл — только для сложных.
3. **Перепишите подроли шага 1**: дефолты (академические статьи / конкуренты / демо), вероятно, не то, что вам нужно.
4. **Финальный «контрольный список результата» — это ваша планка качества**: пропишите структуру вывода — Claude Code будет строго ей следовать.

---

## Рефакторенный пример: Competitive Analyst

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

По сравнению с оригинальным Research Expert: сокращено до 4 шагов, подроли уменьшены с 6 до 3, список результатов полностью переписан как «разделы отчёта».
