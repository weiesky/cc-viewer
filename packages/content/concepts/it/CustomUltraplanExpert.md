# Esperto UltraPlan personalizzato — Guida alla creazione

## Cosa fanno i due campi di input

- **Nome esperto**: l'etichetta mostrata sul pulsante del ruolo nella riga delle varianti UltraPlan (max 30 caratteri). È solo un nome visualizzato e **non viene mai** inviato a Claude Code.
- **Corpo del prompt**: la tua istruzione di ruolo. Quando crei un nuovo esperto, l'editor **è precompilato** con il wrapper `<system-reminder>...</system-reminder>` e la sua intestazione di scope `[SCOPED INSTRUCTION]` — **scrivi la tua istruzione di ruolo all'interno del wrapper**. cc-viewer non avvolge due volte: se il wrapper è presente viene inviato così com'è; se lo rimuovi, cc-viewer ne aggiunge uno al momento dell'invio.

---

## Che aspetto ha il modello dell'esperto?

Ogni esperto integrato (Code Expert / Research Expert) è essenzialmente un blocco `<system-reminder>` iniettato nel contesto di Claude Code. Il tuo esperto personalizzato passa attraverso esattamente la stessa pipeline. Ecco il modello **Research Expert** scomposto:

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

## Analisi sezione per sezione

### 1. Intestazione di scope `[SCOPED INSTRUCTION]` (wrapper — precompilato per te)
> The following instructions are intended for the next 1–3 interactions...

Questo dice a Claude Code: **queste istruzioni sono attive solo per i prossimi 1–3 turni**, poi svaniscono. Impedisce alla "persona dell'esperto" di trasferirsi in conversazioni non correlate successive.

**Questa riga è precompilata nell'editor — lasciala così com'è; non è necessario riscriverla.**

### 2. Definizione del compito iniziale (**questo è ciò che dovresti riscrivere**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Questo è il "soggetto-verbo-oggetto" dell'intero modello: **dice a Claude Code l'atteggiamento e l'obiettivo**. L'impostazione predefinita "esplorazione multi-agente + piano di implementazione" si adatta bene alle attività di **ingegneria del software / pianificazione**, ma sembra inadeguata per molti altri domini (revisione di contenuti, analisi dei dati, copywriting, ricerche di mercato, audit di conformità…).

**Consigliamo vivamente di riscrivere questa riga per il tuo obiettivo**, ad esempio:

- **Revisore di contenuti**: "Sei un revisore di contenuti senior specializzato in {dominio}. Il tuo obiettivo è identificare imprecisioni fattuali, incongruenze di tono e debolezze strutturali nel materiale fornito."
- **Analista competitivo**: "Conduci un'analisi competitiva rigorosa per {categoria di prodotto}. Produci una matrice di confronto, insight di posizionamento e raccomandazioni strategiche."
- **Copywriter**: "Genera più varianti creative di testo per {scenario}, ciascuna con posizionamento, tono e strategia di call-to-action distinti."

### 3. Passaggi del workflow (1–5 elementi — **riduci o estendi in base alla complessità**)

Il Research Expert ha 5 passaggi: **esplora → sintetizza → revisiona → invia il piano → esegui**. Questo impone "multi-agente parallelo + revisione incrociata + approvazione del piano" — tre livelli di rigore, appropriati per attività ad alto rischio/ampio scope ma **eccessivi per quelle leggere**.

- **Compito semplice** (singola ricerca / piccola correzione): elimina l'invio multi-agente e la revisione; basta "produrre la risposta" in un solo passaggio.
- **Compito moderato**: mantieni "esplora → sintetizza → revisiona"; elimina la procedura ExitPlanMode; consegna il risultato direttamente.
- **Compito complesso e oneroso** (grande refactoring, confronto multi-opzione, ricerca interdisciplinare): mantieni tutti i 5 passaggi, eventualmente aggiungi un passaggio "modello di rischio" o "matrice di confronto delle opzioni".

### 4. Sotto-ruoli nel passaggio 1 (**adatta al tuo dominio**)

Research Expert elenca 6 ruoli potenziali (scout di settore, ricercatore accademico, sintetizzatore + verificatore di fatti, analista della concorrenza, produttore di demo, slot di estensibilità). **Riscrivi questo elenco per il tuo scenario**:

- **Scrittura**: "raccoglitore di fonti + analista di stile + verificatore di fatti"
- **Analisi dei dati**: "agente di pulizia dei dati + agente di modellazione statistica + agente di visualizzazione"
- **Audit del codice**: "agente di analisi statica + auditor della catena di dipendenze + modellatore di minacce"

### 5. Checklist finale dei deliverable (**allinea con la tua reale necessità**)

> Your final plan must include the following elements: ...

Il modello originale elenca 6 elementi di un "piano di implementazione". Il tuo deliverable potrebbe essere qualcosa di completamente diverso:

- Un **rapporto di ricerca** → "Sintesi esecutiva / Metodologia / Risultati chiave / Limitazioni / Raccomandazioni d'azione"
- Un **rapporto di revisione** → "Elenco dei problemi / Valutazione della gravità / Suggerimenti di correzione / Esempi prima-dopo"
- Una **matrice di confronto** → "Definizioni delle dimensioni / Schema di valutazione / Conclusioni / Razionale della raccomandazione"

---

## Suggerimenti per la creazione (TL;DR)

1. **Riscrivi la frase di apertura**: dichiara ruolo, obiettivo e formato di output in una sola riga.
2. **Flessibilizza il workflow**: 1–2 passaggi per attività leggere, l'intero ciclo a 5 passaggi solo per quelle complesse.
3. **Riscrivi i sotto-ruoli del passaggio 1**: i valori predefiniti (articoli accademici / concorrenti / demo) probabilmente non sono ciò che vuoi.
4. **La "checklist dei deliverable" finale è il tuo standard di qualità**: specifica la struttura di output — Claude Code la seguirà rigorosamente.

---

## Un esempio rifattorizzato: Analista competitivo

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

Rispetto al Research Expert originale: ridotto a 4 passaggi, sotto-ruoli ridotti da 6 a 3, elenco dei deliverable completamente riscritto come "sezioni del rapporto".
