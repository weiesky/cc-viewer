# Custom UltraPlan Expert — Forfatterveiledning

## Hva de to inndatafeltene gjør

- **Ekspertnavn**: etiketten som vises på rolleknappen i UltraPlan-variantraden (maks 30 tegn). Det er bare et visningsnavn og sendes **aldri** til Claude Code.
- **Promptinnhold**: din rolleinstruksjon. Når du oppretter en ny ekspert, kommer editoren **ferdig utfylt** med `<system-reminder>...</system-reminder>`-wrapperen og dens `[SCOPED INSTRUCTION]`-scope-header — **skriv rolleinstruksjonen din inni wrapperen**. cc-viewer pakker ikke dobbelt: hvis wrapperen er til stede sendes den som den er; hvis du fjerner den, legger cc-viewer til en ny ved sending.

---

## Hvordan ser ekspertmalen ut?

Hver innebygde ekspert (Code Expert / Research Expert) er i bunn og grunn en `<system-reminder>`-blokk som injiseres inn i Claude Codes kontekst. Din custom-ekspert går gjennom nøyaktig samme pipeline. Her er **Research Expert**-malen brutt ned:

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

## Seksjon-for-seksjon gjennomgang

### 1. `[SCOPED INSTRUCTION]`-scope-header (wrapper — ferdig utfylt for deg)
> The following instructions are intended for the next 1–3 interactions...

Dette forteller Claude Code: **disse instruksjonene er kun aktive de neste 1–3 turene**, deretter avtar de. Hindrer at "ekspertpersonaen" lekker inn i urelaterte samtaler etterpå.

**Denne linjen kommer ferdig utfylt i editoren — la den stå som den er; du trenger ikke å skrive den om.**

### 2. Innledende oppgavedefinisjon (**dette er det du skal skrive om**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Dette er hele malens "subjekt-verb-objekt": **det forteller Claude Code holdningen og målet**. Standarden "multi-agent exploration + implementation plan" passer godt til **programvareutvikling / planlegging**, men føles klosset for mange andre domener (innholdsgjennomgang, dataanalyse, copywriting, markedsundersøkelse, compliance-revisjon…).

**Vi anbefaler sterkt å skrive om denne linjen for målet ditt**, for eksempel:

- **Innholdsanmelder**: "You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **Konkurranseanalytiker**: "Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **Copywriter**: "Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. Arbeidsflyttrinn (1–5 punkter — **trim eller utvid basert på kompleksitet**)

Research Expert har 5 trinn: **utforsk → syntetiser → review → send inn plan → utfør**. Dette håndhever "parallell multi-agent + kryssreview + plangodkjenning" — tre lag av strenghet, passende for høyrisiko-/breddeomfangsoppgaver, men **overdrevent for lette oppgaver**.

- **Enkel oppgave** (enkelt oppslag / liten fiks): dropp multi-agent-utsendelsen og review; bare "produser svaret" i ett trinn.
- **Middels kompleks oppgave**: behold "utforsk → syntetiser → review"; dropp ExitPlanMode-dansen; lever resultatet direkte.
- **Kompleks, dyr oppgave** (stor refaktorering, multi-option-sammenligning, tverrfaglig forskning): behold alle 5 trinn, og legg eventuelt til et "risikomodell"- eller "alternativ-sammenligningsmatrise"-trinn.

### 4. Underroller i Trinn 1 (**tilpass til ditt domene**)

Research Expert lister 6 potensielle roller (bransjespeider, akademisk forsker, syntetiserer + faktasjekker, konkurranseanalytiker, demo-produsent, utvidelsesplass). **Skriv om denne listen for ditt scenario**:

- **Skriving**: "kildesamler + stilanalytiker + faktasjekker"
- **Dataanalyse**: "datavaskingsagent + statistisk modelleringsagent + visualiseringsagent"
- **Kodeaudit**: "statisk-analyse-agent + avhengighetskjederevisor + threat modeler"

### 5. Endelig leveranse-sjekkliste (**tilpass til ditt reelle behov**)

> Your final plan must include the following elements: ...

Den opprinnelige malen lister 6 elementer i en "implementeringsplan". Din leveranse kan være noe helt annet:

- En **forskningsrapport** → "Executive summary / Methodology / Key findings / Limitations / Action recommendations"
- En **review-rapport** → "Issue list / Severity rating / Fix suggestions / Before-after examples"
- En **sammenligningsmatrise** → "Dimension definitions / Scoring rubric / Conclusions / Recommendation rationale"

---

## Forfattertips (TL;DR)

1. **Skriv om åpningssetningen**: oppgi rolle, mål og utdataformat på én linje.
2. **Flex arbeidsflyten**: 1–2 trinn for lette oppgaver, den fulle 5-trinns sløyfen kun for komplekse.
3. **Skriv om Trinn 1s underroller**: standardene (akademiske artikler / konkurrenter / demo) er sannsynligvis ikke det du vil ha.
4. **Den endelige "leveranse-sjekklisten" er din kvalitetslinje**: stav ut utdatastrukturen — Claude Code følger den strengt.

---

## Et omarbeidet eksempel: Competitive Analyst

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

Sammenlignet med den originale Research Expert: trimmet til 4 trinn, underroller redusert fra 6 til 3, leveranseliste fullstendig omskrevet som "rapportseksjoner".
