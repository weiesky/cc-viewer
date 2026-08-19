# Custom UltraPlan Expert — Forfattervejledning

## Hvad gør de to inputfelter

- **Ekspertnavn**: etiketten der vises på rolleknappen i UltraPlan-variantrækken (max 30 tegn). Det er kun et visningsnavn og sendes **aldrig** til Claude Code.
- **Promptindhold**: din rolleinstruktion. Når du opretter en ny ekspert, **kommer editoren forudfyldt** med `<system-reminder>...</system-reminder>`-wrapperen og dens `[SCOPED INSTRUCTION]`-scope-header — **skriv din rolleinstruktion inde i wrapperen**. cc-viewer pakker ikke dobbelt: hvis wrapperen er til stede, sendes den som den er; hvis du fjerner den, tilføjer cc-viewer en igen ved afsendelse.

---

## Hvordan ser ekspertskabelonen ud?

Hver indbygget ekspert (Code Expert / Research Expert) er i bund og grund en `<system-reminder>`-blok, der injiceres ind i Claude Codes kontekst. Din custom-ekspert går gennem nøjagtig samme pipeline. Her er **Research Expert**-skabelonen brudt ned:

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

## Sektion-for-sektion gennemgang

### 1. `[SCOPED INSTRUCTION]`-scope-header (wrapper — forudfyldt for dig)
> The following instructions are intended for the next 1–3 interactions...

Dette fortæller Claude Code: **disse instruktioner er kun aktive de næste 1–3 turneringer**, derefter aftager de. Forhindrer "ekspertpersonaen" i at lække ind i ikke-relaterede samtaler bagefter.

**Denne linje kommer forudfyldt i editoren — behold den som den er; du behøver ikke at omskrive den.**

### 2. Indledende opgavedefinition (**dette er det, du skal omskrive**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Dette er hele skabelonens "subjekt-verbum-objekt": **det fortæller Claude Code holdningen og målet**. Standarden "multi-agent exploration + implementation plan" passer godt til **softwareudvikling / planlægning**, men virker akavet for mange andre domæner (indholdsgennemgang, dataanalyse, copywriting, markedsundersøgelser, compliance-audit…).

**Vi anbefaler kraftigt at omskrive denne linje til dit mål**, for eksempel:

- **Indholdsanmelder**: "You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **Konkurrenceanalytiker**: "Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **Copywriter**: "Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. Workflow-trin (1–5 punkter — **trim eller udvid baseret på kompleksitet**)

Research Expert har 5 trin: **udforsk → syntetisér → review → indsend plan → eksekvér**. Dette håndhæver "parallel multi-agent + krydsreview + plangodkendelse" — tre lag af stringens, passende for høj-risiko/bredt-omfangsopgaver, men **overdrevent for lette opgaver**.

- **Simpel opgave** (enkelt opslag / lille fix): drop multi-agent-udsendelsen og review; bare "producer svaret" i ét trin.
- **Mellemkompleks opgave**: behold "udforsk → syntetisér → review"; drop ExitPlanMode-dansen; lever resultatet direkte.
- **Kompleks, dyr opgave** (stor refaktorering, multi-option-sammenligning, tværfaglig forskning): behold alle 5 trin, og tilføj evt. et "risikomodel"- eller "options-sammenligningsmatrix"-trin.

### 4. Underroller i Trin 1 (**tilpas til dit domæne**)

Research Expert lister 6 potentielle roller (industri-spejder, akademisk forsker, syntetiserer + faktatjekker, konkurrenceanalytiker, demo-producent, udvidelsesplads). **Omskriv denne liste til dit scenarie**:

- **Skrivning**: "kildeindsamler + stilanalytiker + faktatjekker"
- **Dataanalyse**: "datarensningsagent + statistisk modelleringsagent + visualiseringsagent"
- **Code audit**: "statisk-analyse-agent + afhængighedskædeauditør + threat modeler"

### 5. Endelig leverance-tjekliste (**tilpas til dit reelle behov**)

> Your final plan must include the following elements: ...

Den oprindelige skabelon lister 6 elementer i en "implementeringsplan". Din leverance kunne være noget helt andet:

- En **forskningsrapport** → "Executive summary / Methodology / Key findings / Limitations / Action recommendations"
- En **review-rapport** → "Issue list / Severity rating / Fix suggestions / Before-after examples"
- En **sammenligningsmatrix** → "Dimension definitions / Scoring rubric / Conclusions / Recommendation rationale"

---

## Forfattertips (TL;DR)

1. **Omskriv åbningssætningen**: angiv rolle, mål og outputformat på én linje.
2. **Flex workflowet**: 1–2 trin for lette opgaver, det fulde 5-trin loop kun for komplekse.
3. **Omskriv Trin 1's underroller**: standardrollerne (akademiske artikler / konkurrenter / demo) er sandsynligvis ikke det, du vil have.
4. **Den endelige "leverance-tjekliste" er din kvalitetsbarrer**: stav outputstrukturen ud — Claude Code følger den strikt.

---

## Et omarbejdet eksempel: Competitive Analyst

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

Sammenlignet med den originale Research Expert: trimmet til 4 trin, underroller reduceret fra 6 til 3, leveranceliste fuldt omskrevet som "rapportsektioner".
