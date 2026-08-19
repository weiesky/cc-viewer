# UltraPlan — A Máquina de Desejos Definitiva

## O que é UltraPlan

UltraPlan é a **implementação localizada** do cc-viewer para o comando nativo `/ultraplan` do Claude Code. Ele permite que você use todas as capacidades do `/ultraplan` em seu ambiente local **sem precisar iniciar o serviço remoto oficial do Claude**, guiando o Claude Code para realizar tarefas complexas de planejamento e implementação usando **colaboração multiagente**.

Comparado ao modo Plan regular ou Agent Team, o UltraPlan pode:
- Oferece os papéis de **Especialista em código** e **Especialista em pesquisa** adaptados a diferentes tipos de tarefas
- Implantar múltiplos agentes paralelos para explorar a base de código ou realizar pesquisas a partir de diferentes dimensões
- Incorporar pesquisa externa (webSearch) para melhores práticas do setor
- Montar automaticamente uma Equipe de Code Review após a execução do plano para revisão de código
- Formar um ciclo fechado completo **Planejar → Executar → Revisar → Corrigir**

---

## Notas importantes

### 1. UltraPlan não é onipotente
O UltraPlan é uma máquina de desejos mais poderosa, mas isso não significa que todo desejo pode ser realizado. Ele é mais poderoso que o Plan e o Agent Team, mas não pode diretamente "fazer você ganhar dinheiro". Considere uma granularidade de tarefas razoável — divida grandes objetivos em tarefas de tamanho médio executáveis em vez de tentar realizar tudo de uma vez.

### 2. Atualmente mais eficaz para projetos de programação
Os modelos e fluxos de trabalho do UltraPlan são profundamente otimizados para projetos de programação. Outros cenários (documentação, análise de dados, etc.) podem ser tentados, mas você pode querer aguardar adaptações em versões futuras.

### 3. Tempo de execução e requisitos de janela de contexto
- Uma execução bem-sucedida do UltraPlan normalmente leva **30 minutos ou mais**
- Requer que o MainAgent tenha uma janela de contexto grande (modelo Opus com contexto 1M recomendado)
- Se você tem apenas um modelo de 200K, **certifique-se de executar `/clear` no contexto antes de rodar**
- O `/compact` do Claude Code tem desempenho ruim quando a janela de contexto é insuficiente — evite ficar sem espaço
- Manter espaço de contexto suficiente é um pré-requisito crítico para a execução bem-sucedida do UltraPlan

Se você tiver dúvidas ou sugestões sobre o UltraPlan localizado, fique à vontade para abrir [Issues no GitHub](https://github.com/anthropics/claude-code/issues) para discutir e colaborar.

---

## Como funciona

UltraPlan oferece dois papéis de especialista, adaptados a diferentes tipos de tarefas:

### Especialista em código
Um fluxo de trabalho de colaboração multi-agente projetado para projetos de programação:
1. Implantar até 5 agentes paralelos para explorar a base de código simultaneamente (arquitetura, identificação de arquivos, avaliação de riscos, etc.)
2. Opcionalmente implantar um agente de pesquisa para investigar soluções do setor via webSearch
3. Sintetizar todas as descobertas dos agentes em um plano de implementação detalhado
4. Implantar um agente de revisão para examinar o plano sob múltiplas perspectivas
5. Executar o plano após aprovação
6. Montar automaticamente um Code Review Team para validar a qualidade do código após a implementação

### Especialista em pesquisa
Um fluxo de trabalho de colaboração multi-agente projetado para tarefas de pesquisa e análise:
1. Implantar múltiplos agentes paralelos para pesquisar a partir de diferentes dimensões (pesquisas setoriais, artigos acadêmicos, notícias, análise competitiva, etc.)
2. Designar um agente para sintetizar a solução-alvo verificando o rigor e a credibilidade das fontes coletadas
3. Opcionalmente implantar um agente para criar um demo do produto (HTML, Markdown, etc.)
4. Sintetizar todas as descobertas em um plano de implementação abrangente
5. Implantar múltiplos agentes de revisão para examinar o plano sob diferentes papéis e perspectivas
6. Executar o plano após aprovação

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
