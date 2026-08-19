# Custom UltraPlan Expert — Przewodnik tworzenia

## Co robią dwa pola wejściowe

- **Nazwa eksperta**: etykieta wyświetlana na przycisku roli w wierszu wariantów UltraPlan (maks. 30 znaków). To tylko nazwa wyświetlana i **nigdy** nie jest wysyłana do Claude Code.
- **Treść promptu**: twoja instrukcja roli. Gdy tworzysz nowego eksperta, edytor jest **wstępnie wypełniony** wrapperem `<system-reminder>...</system-reminder>` wraz z nagłówkiem zakresu `[SCOPED INSTRUCTION]` — **pisz swoją instrukcję roli wewnątrz wrappera**. cc-viewer nie opakowuje podwójnie: jeśli wrapper jest obecny, jest wysyłany bez zmian; jeśli go usuniesz, cc-viewer doda go ponownie w momencie wysyłania.

---

## Jak wygląda szablon eksperta?

Każdy wbudowany ekspert (Code Expert / Research Expert) to w istocie blok `<system-reminder>` wstrzykiwany do kontekstu Claude Code. Twój własny ekspert przechodzi przez dokładnie ten sam pipeline. Oto rozłożony szablon **Research Expert**:

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

## Analiza sekcja po sekcji

### 1. Nagłówek zakresu `[SCOPED INSTRUCTION]` (wrapper — wstępnie wypełniony dla ciebie)
> The following instructions are intended for the next 1–3 interactions...

Mówi to Claude Code: **te instrukcje są aktywne tylko przez najbliższe 1–3 tury**, a następnie wygasają. Zapobiega temu, by "persona eksperta" przeciekała do niezwiązanej rozmowy później.

**Ta linia jest wstępnie wypełniona w edytorze — zostaw ją bez zmian; nie musisz jej przepisywać.**

### 2. Wstępna definicja zadania (**to jest to, co powinieneś przepisać**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

To "podmiot-orzeczenie-dopełnienie" całego szablonu: **mówi Claude Code o postawie i celu**. Domyślne "multi-agent exploration + implementation plan" dobrze pasuje do zadań **inżynierii oprogramowania / planowania**, ale wydaje się niezręczne w wielu innych dziedzinach (recenzja treści, analiza danych, copywriting, badania rynku, audyt zgodności…).

**Zdecydowanie zalecamy przepisanie tej linii pod twój cel**, na przykład:

- **Recenzent treści**: "You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **Analityk konkurencji**: "Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **Copywriter**: "Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. Kroki workflow (1–5 elementów — **przytnij lub rozszerz w zależności od złożoności**)

Research Expert ma 5 kroków: **eksploruj → syntetyzuj → review → złóż plan → wykonaj**. Wymusza to "równoległy multi-agent + krzyżowy review + zatwierdzenie planu" — trzy warstwy rygoru, odpowiednie dla zadań wysokiego ryzyka/szerokiego zakresu, ale **przesadne dla lekkich**.

- **Proste zadanie** (pojedyncze wyszukanie / mała poprawka): porzuć rozsyłanie multi-agent i review; po prostu "wyprodukuj odpowiedź" w jednym kroku.
- **Zadanie średnio złożone**: zachowaj "eksploruj → syntetyzuj → review"; porzuć taniec ExitPlanMode; dostarcz wynik bezpośrednio.
- **Zadanie złożone, kosztowne** (duża refaktoryzacja, porównanie wielu opcji, badania międzydziedzinowe): zachowaj wszystkie 5 kroków, ewentualnie dodaj krok "modelu ryzyka" lub "macierzy porównania opcji".

### 4. Podrole w Kroku 1 (**dostosuj do swojej dziedziny**)

Research Expert wymienia 6 potencjalnych ról (zwiadowca branżowy, badacz akademicki, syntetyzator + fact-checker, analityk konkurencji, producent demo, slot rozszerzalności). **Przepisz tę listę pod swój scenariusz**:

- **Pisanie**: "zbieracz źródeł + analityk stylu + fact-checker"
- **Analiza danych**: "agent czyszczenia danych + agent modelowania statystycznego + agent wizualizacji"
- **Audyt kodu**: "agent analizy statycznej + audytor łańcucha zależności + threat modeler"

### 5. Lista końcowych deliverables (**dostosuj do realnych potrzeb**)

> Your final plan must include the following elements: ...

Oryginalny szablon wymienia 6 elementów "planu wdrożenia". Twój deliverable może być czymś zupełnie innym:

- **Raport badawczy** → "Executive summary / Methodology / Key findings / Limitations / Action recommendations"
- **Raport z review** → "Issue list / Severity rating / Fix suggestions / Before-after examples"
- **Macierz porównawcza** → "Dimension definitions / Scoring rubric / Conclusions / Recommendation rationale"

---

## Wskazówki dla autorów (TL;DR)

1. **Przepisz zdanie otwierające**: określ rolę, cel i format wyjścia w jednej linii.
2. **Elastycznie kształtuj workflow**: 1–2 kroki dla lekkich zadań, pełna pętla 5-krokowa tylko dla złożonych.
3. **Przepisz podrole z Kroku 1**: domyślne (artykuły akademickie / konkurenci / demo) prawdopodobnie nie są tym, czego chcesz.
4. **Końcowa "lista deliverables" to twój próg jakości**: rozpisz strukturę wyjścia — Claude Code będzie ją ściśle przestrzegać.

---

## Przerobiony przykład: Competitive Analyst

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

W porównaniu z oryginalnym Research Expert: przycięte do 4 kroków, podrole zredukowane z 6 do 3, lista deliverables całkowicie przepisana jako "sekcje raportu".
