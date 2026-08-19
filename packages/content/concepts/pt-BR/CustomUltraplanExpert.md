# Especialista UltraPlan personalizado — Guia de criação

## O que fazem os dois campos de entrada

- **Nome do especialista**: o rótulo exibido no botão de função na linha de variantes do UltraPlan (máx. 30 caracteres). É apenas um nome de exibição e **nunca** é enviado ao Claude Code.
- **Corpo do prompt**: sua instrução de função. Quando você cria um novo especialista, o editor **vem pré-preenchido** com o wrapper `<system-reminder>...</system-reminder>` e seu cabeçalho de escopo `[SCOPED INSTRUCTION]` — **escreva sua instrução de função dentro do wrapper**. O cc-viewer não envolve em duplicidade: se o wrapper estiver presente, ele é enviado como está; se você o remover, o cc-viewer adiciona um de volta no momento do envio.

---

## Como é o modelo do especialista?

Cada especialista integrado (Code Expert / Research Expert) é essencialmente um bloco `<system-reminder>` injetado no contexto do Claude Code. Seu especialista personalizado passa exatamente pelo mesmo pipeline. Aqui está o modelo do **Research Expert** detalhado:

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

## Análise seção por seção

### 1. Cabeçalho de escopo `[SCOPED INSTRUCTION]` (wrapper — pré-preenchido para você)
> The following instructions are intended for the next 1–3 interactions...

Isso diz ao Claude Code: **estas instruções estão ativas apenas para as próximas 1–3 rodadas**, depois se dissipam. Impede que a "persona do especialista" vaze para conversas não relacionadas posteriormente.

**Esta linha vem pré-preenchida no editor — mantenha-a como está; você não precisa reescrevê-la.**

### 2. Definição da tarefa inicial (**isto é o que você deve reescrever**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Este é o "sujeito-verbo-objeto" de todo o modelo: **diz ao Claude Code a postura e o objetivo**. O padrão "exploração multiagente + plano de implementação" se encaixa bem em tarefas de **engenharia de software / planejamento**, mas parece estranho para muitos outros domínios (revisão de conteúdo, análise de dados, copywriting, pesquisa de mercado, auditoria de conformidade…).

**Recomendamos fortemente reescrever esta linha para o seu objetivo**, por exemplo:

- **Revisor de conteúdo**: "Você é um revisor de conteúdo sênior especializado em {domínio}. Seu objetivo é identificar imprecisões factuais, inconsistências de tom e fragilidades estruturais no material fornecido."
- **Analista competitivo**: "Conduza uma análise competitiva rigorosa para {categoria de produto}. Produza uma matriz de comparação, insights de posicionamento e recomendações estratégicas."
- **Copywriter**: "Gere várias variantes criativas de texto para {cenário}, cada uma com posicionamento, tom e estratégia de chamada para ação distintos."

### 3. Etapas do fluxo de trabalho (1–5 itens — **reduza ou estenda com base na complexidade**)

O Research Expert tem 5 etapas: **explorar → sintetizar → revisar → enviar plano → executar**. Isso impõe "multiagente paralelo + revisão cruzada + aprovação do plano" — três camadas de rigor, apropriadas para tarefas de alto risco/amplo escopo, mas **exageradas para as leves**.

- **Tarefa simples** (consulta única / pequena correção): elimine o despacho multiagente e a revisão; apenas "produza a resposta" em uma única etapa.
- **Tarefa moderada**: mantenha "explorar → sintetizar → revisar"; elimine o passo a passo do ExitPlanMode; entregue o resultado diretamente.
- **Tarefa complexa e cara** (grande refatoração, comparação de várias opções, pesquisa interdisciplinar): mantenha todas as 5 etapas, possivelmente adicione uma etapa de "modelo de risco" ou "matriz de comparação de opções".

### 4. Subfunções na Etapa 1 (**adapte ao seu domínio**)

O Research Expert lista 6 funções potenciais (explorador da indústria, pesquisador acadêmico, sintetizador + verificador de fatos, analista da concorrência, produtor de demo, slot de extensibilidade). **Reescreva esta lista para o seu cenário**:

- **Redação**: "coletor de fontes + analista de estilo + verificador de fatos"
- **Análise de dados**: "agente de limpeza de dados + agente de modelagem estatística + agente de visualização"
- **Auditoria de código**: "agente de análise estática + auditor de cadeia de dependências + modelador de ameaças"

### 5. Lista de verificação final de entregáveis (**alinhe com sua necessidade real**)

> Your final plan must include the following elements: ...

O modelo original lista 6 elementos de um "plano de implementação". Seu entregável pode ser algo completamente diferente:

- Um **relatório de pesquisa** → "Resumo executivo / Metodologia / Principais conclusões / Limitações / Recomendações de ação"
- Um **relatório de revisão** → "Lista de problemas / Classificação de gravidade / Sugestões de correção / Exemplos antes e depois"
- Uma **matriz de comparação** → "Definições de dimensões / Rubrica de pontuação / Conclusões / Justificativa da recomendação"

---

## Dicas de criação (TL;DR)

1. **Reescreva a frase inicial**: declare a função, o objetivo e o formato de saída em uma única linha.
2. **Flexibilize o fluxo de trabalho**: 1–2 etapas para tarefas leves, o ciclo completo de 5 etapas apenas para as complexas.
3. **Reescreva as subfunções da Etapa 1**: os padrões (artigos acadêmicos / concorrentes / demo) provavelmente não são o que você quer.
4. **A "lista de verificação de entregáveis" final é seu padrão de qualidade**: especifique a estrutura de saída — o Claude Code seguirá rigorosamente.

---

## Um exemplo refatorado: Analista competitivo

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

Em comparação com o Research Expert original: reduzido para 4 etapas, subfunções reduzidas de 6 para 3, lista de entregáveis totalmente reescrita como "seções do relatório".
