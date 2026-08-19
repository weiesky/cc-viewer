# UltraPlan — La Maquina de Deseos Definitiva

## Que es UltraPlan

UltraPlan es la **implementacion localizada** de cc-viewer del comando nativo `/ultraplan` de Claude Code. Te permite usar las capacidades completas de `/ultraplan` en tu entorno local **sin necesidad de iniciar el servicio remoto oficial de Claude**, guiando a Claude Code para lograr tareas complejas de planificacion e implementacion mediante **colaboracion multi-agente**.

En comparacion con el modo Plan regular o Agent Team, UltraPlan puede:
- Ofrece los roles de **Experto en código** y **Experto en investigación** adaptados a diferentes tipos de tareas
- Desplegar múltiples agentes paralelos para explorar el código o realizar investigaciones desde diferentes dimensiones
- Incorporar investigacion externa (webSearch) sobre mejores practicas de la industria
- Ensamblar automaticamente un Code Review Team despues de la ejecucion del plan para revision de codigo
- Formar un ciclo cerrado completo de **Plan → Execute → Review → Fix**

---

## Notas Importantes

### 1. UltraPlan No Es Omnipotente
UltraPlan es una maquina de deseos mas poderosa, pero eso no significa que cada deseo pueda cumplirse. Es mas poderoso que Plan y Agent Team, pero no puede directamente "hacerte ganar dinero". Considera una granularidad de tareas razonable — divide los grandes objetivos en tareas medianas ejecutables en lugar de intentar lograrlo todo de una sola vez.

### 2. Actualmente Mas Efectivo para Proyectos de Programacion
Las plantillas y flujos de trabajo de UltraPlan estan profundamente optimizados para proyectos de programacion. Otros escenarios (documentacion, analisis de datos, etc.) pueden intentarse, pero es recomendable esperar las adaptaciones en versiones futuras.

### 3. Tiempo de Ejecucion y Requisitos de Ventana de Contexto
- Una ejecucion exitosa de UltraPlan normalmente toma **30 minutos o mas**
- Requiere que el MainAgent tenga una ventana de contexto grande (se recomienda el modelo Opus con 1M de contexto)
- Si solo tienes un modelo de 200K, **asegurate de ejecutar `/clear` en el contexto antes de comenzar**
- El `/compact` de Claude Code funciona mal cuando la ventana de contexto es insuficiente — evita quedarte sin espacio
- Mantener suficiente espacio de contexto es un prerequisito critico para la ejecucion exitosa de UltraPlan

Si tienes preguntas o sugerencias sobre el UltraPlan localizado, no dudes en abrir [Issues en GitHub](https://github.com/anthropics/claude-code/issues) para discutir y colaborar.

---

## Cómo funciona

UltraPlan ofrece dos roles de experto, adaptados a diferentes tipos de tareas:

### Experto en código
Un flujo de trabajo de colaboración multi-agente diseñado para proyectos de programación:
1. Desplegar hasta 5 agentes paralelos para explorar el código simultáneamente (arquitectura, identificación de archivos, evaluación de riesgos, etc.)
2. Opcionalmente desplegar un agente de investigación para examinar soluciones del sector vía webSearch
3. Sintetizar todos los hallazgos de los agentes en un plan de implementación detallado
4. Desplegar un agente de revisión para examinar el plan desde múltiples perspectivas
5. Ejecutar el plan una vez aprobado
6. Ensamblar automáticamente un Code Review Team para validar la calidad del código tras la implementación

### Experto en investigación
Un flujo de trabajo de colaboración multi-agente diseñado para tareas de investigación y análisis:
1. Desplegar múltiples agentes paralelos para investigar desde diferentes dimensiones (estudios sectoriales, artículos académicos, noticias, análisis competitivo, etc.)
2. Asignar un agente para sintetizar la solución objetivo verificando la rigurosidad y credibilidad de las fuentes recopiladas
3. Opcionalmente desplegar un agente para crear un demo del producto (HTML, Markdown, etc.)
4. Sintetizar todos los hallazgos en un plan de implementación integral
5. Desplegar múltiples agentes de revisión para examinar el plan desde diferentes roles y perspectivas
6. Ejecutar el plan una vez aprobado

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
