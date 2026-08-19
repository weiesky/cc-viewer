# UltraPlan — La Macchina dei Desideri Definitiva

## Cos'e UltraPlan

UltraPlan e l'**implementazione localizzata** di cc-viewer del comando nativo `/ultraplan` di Claude Code. Permette di utilizzare le funzionalita complete di `/ultraplan` nel proprio ambiente locale **senza dover avviare il servizio remoto ufficiale di Claude**, guidando Claude Code nel portare a termine compiti complessi di pianificazione e implementazione utilizzando la **collaborazione multi-agente**.

Rispetto alla modalita Plan standard o ad Agent Team, UltraPlan puo:
- Offre i ruoli di **Esperto di codice** ed **Esperto di ricerca** adattati a diversi tipi di attività
- Dispiegare più agenti paralleli per esplorare il codice o condurre ricerche da diverse dimensioni
- Incorporare ricerche esterne (webSearch) per le migliori pratiche del settore
- Assemblare automaticamente un Code Review Team dopo l'esecuzione del piano per la revisione del codice
- Formare un ciclo chiuso completo **Plan → Execute → Review → Fix**

---

## Note Importanti

### 1. UltraPlan Non E Onnipotente
UltraPlan e una macchina dei desideri piu potente, ma cio non significa che ogni desiderio possa essere esaudito. E piu potente di Plan e Agent Team, ma non puo direttamente "farti guadagnare soldi". Considera una granularita dei compiti ragionevole — suddividi i grandi obiettivi in compiti medi eseguibili piuttosto che cercare di realizzare tutto in un colpo solo.

### 2. Attualmente Piu Efficace per Progetti di Programmazione
I modelli e i flussi di lavoro di UltraPlan sono profondamente ottimizzati per progetti di programmazione. Altri scenari (documentazione, analisi dati, ecc.) possono essere tentati, ma si consiglia di attendere gli adattamenti nelle versioni future.

### 3. Tempo di Esecuzione e Requisiti della Finestra di Contesto
- Un'esecuzione riuscita di UltraPlan richiede tipicamente **30 minuti o piu**
- Richiede che il MainAgent abbia una finestra di contesto ampia (modello Opus con 1M di contesto consigliato)
- Se si dispone solo di un modello 200K, **assicurarsi di eseguire `/clear` sul contesto prima dell'esecuzione**
- Il `/compact` di Claude Code funziona male quando la finestra di contesto e insufficiente — evitare di esaurire lo spazio
- Mantenere spazio di contesto sufficiente e un prerequisito critico per l'esecuzione riuscita di UltraPlan

Se hai domande o suggerimenti sull'UltraPlan localizzato, sentiti libero di aprire [Issues su GitHub](https://github.com/anthropics/claude-code/issues) per discutere e collaborare.

---

## Come funziona

UltraPlan offre due ruoli di esperti, adattati a diversi tipi di attività:

### Esperto di codice
Un flusso di lavoro di collaborazione multi-agente progettato per progetti di programmazione:
1. Dispiegare fino a 5 agenti paralleli per esplorare simultaneamente il codice (architettura, identificazione file, valutazione rischi, ecc.)
2. Opzionalmente dispiegare un agente di ricerca per indagare soluzioni del settore tramite webSearch
3. Sintetizzare tutte le scoperte degli agenti in un piano di implementazione dettagliato
4. Dispiegare un agente di revisione per esaminare il piano da molteplici prospettive
5. Eseguire il piano una volta approvato
6. Assemblare automaticamente un Code Review Team per validare la qualità del codice dopo l'implementazione

### Esperto di ricerca
Un flusso di lavoro di collaborazione multi-agente progettato per attività di ricerca e analisi:
1. Dispiegare più agenti paralleli per ricercare da diverse dimensioni (indagini di settore, articoli accademici, notizie, analisi della concorrenza, ecc.)
2. Assegnare un agente per sintetizzare la soluzione obiettivo verificando il rigore e la credibilità delle fonti raccolte
3. Opzionalmente dispiegare un agente per creare un demo del prodotto (HTML, Markdown, ecc.)
4. Sintetizzare tutte le scoperte in un piano di implementazione completo
5. Dispiegare più agenti di revisione per esaminare il piano da diversi ruoli e prospettive
6. Eseguire il piano una volta approvato

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
