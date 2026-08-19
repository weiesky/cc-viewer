# Benutzerdefinierter UltraPlan-Experte — Erstellungsleitfaden

## Was die beiden Eingabefelder tun

- **Expertenname**: das Label, das auf der Rollenschaltfläche in der UltraPlan-Variantenzeile angezeigt wird (max. 30 Zeichen). Es ist nur ein Anzeigename und wird **niemals** an Claude Code gesendet.
- **Prompt-Inhalt**: Ihre Rollenanweisung. Beim Anlegen eines neuen Experten **ist der Editor vorausgefüllt** mit dem `<system-reminder>...</system-reminder>`-Wrapper und seinem `[SCOPED INSTRUCTION]`-Scope-Header — **schreiben Sie Ihre Rollenanweisung innerhalb des Wrappers**. cc-viewer umschließt nicht doppelt: Ist der Wrapper vorhanden, wird er unverändert gesendet; entfernen Sie ihn, fügt cc-viewer beim Senden wieder einen hinzu.

---

## Wie sieht die Expertenvorlage aus?

Jeder eingebaute Experte (Code Expert / Research Expert) ist im Wesentlichen ein `<system-reminder>`-Block, der in den Kontext von Claude Code eingespeist wird. Ihr benutzerdefinierter Experte durchläuft genau dieselbe Pipeline. Hier ist die **Research Expert**-Vorlage im Detail:

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

## Aufschlüsselung Abschnitt für Abschnitt

### 1. `[SCOPED INSTRUCTION]`-Scope-Header (Wrapper — für Sie vorausgefüllt)
> The following instructions are intended for the next 1–3 interactions...

Dies teilt Claude Code mit: **diese Anweisungen sind nur für die nächsten 1–3 Runden aktiv**, danach werden sie ausgeblendet. Verhindert, dass die „Expertenpersona" anschließend in unzusammenhängende Konversationen einsickert.

**Diese Zeile ist im Editor vorausgefüllt — lassen Sie sie unverändert; Sie müssen sie nicht neu schreiben.**

### 2. Einführende Aufgabendefinition (**das ist es, was Sie umschreiben sollten**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Dies ist das „Subjekt-Prädikat-Objekt" der gesamten Vorlage: **es teilt Claude Code die Haltung und das Ziel mit**. Die Standardausrichtung „Multi-Agent-Erkundung + Implementierungsplan" passt gut zu **Software-Engineering-/Planungsaufgaben**, fühlt sich aber für viele andere Bereiche unpassend an (Inhaltsprüfung, Datenanalyse, Texterstellung, Marktforschung, Compliance-Audit…).

**Wir empfehlen dringend, diese Zeile für Ihr Ziel umzuschreiben**, zum Beispiel:

- **Inhaltsprüfer**: „Sie sind ein erfahrener Inhaltsprüfer mit Spezialisierung auf {Bereich}. Ihr Ziel ist es, sachliche Ungenauigkeiten, Inkonsistenzen im Tonfall und strukturelle Schwächen im bereitgestellten Material zu identifizieren."
- **Wettbewerbsanalyst**: „Führen Sie eine rigorose Wettbewerbsanalyse für {Produktkategorie} durch. Erstellen Sie eine Vergleichsmatrix, Positionierungserkenntnisse und strategische Empfehlungen."
- **Texter**: „Generieren Sie mehrere kreative Textvarianten für {Szenario}, jede mit eigener Positionierung, Tonalität und Call-to-Action-Strategie."

### 3. Workflow-Schritte (1–5 Punkte — **kürzen oder erweitern je nach Komplexität**)

Der Research Expert hat 5 Schritte: **erkunden → synthetisieren → prüfen → Plan einreichen → ausführen**. Dies erzwingt „parallele Multi-Agenten + Cross-Review + Plangenehmigung" — drei Ebenen der Strenge, geeignet für Aufgaben mit hoher Tragweite/breitem Umfang, aber **übertrieben für leichtgewichtige**.

- **Einfache Aufgabe** (einzelne Suche / kleiner Fix): Lassen Sie den Multi-Agenten-Versand und die Prüfung weg; einfach „Antwort liefern" in einem Schritt.
- **Mittlere Aufgabe**: Behalten Sie „erkunden → synthetisieren → prüfen"; lassen Sie den ExitPlanMode-Tanz weg; liefern Sie das Ergebnis direkt.
- **Komplexe, kostspielige Aufgabe** (großes Refactoring, Mehroptionen-Vergleich, fachübergreifende Recherche): Behalten Sie alle 5 Schritte, fügen Sie möglicherweise einen „Risikomodell"- oder „Optionsvergleichsmatrix"-Schritt hinzu.

### 4. Unterrollen in Schritt 1 (**auf Ihre Domäne zuschneiden**)

Research Expert listet 6 potenzielle Rollen auf (Branchen-Scout, akademischer Forscher, Synthesizer + Faktenprüfer, Wettbewerbsanalyst, Demo-Produzent, Erweiterungsslot). **Schreiben Sie diese Liste für Ihr Szenario um**:

- **Schreiben**: „Quellensammler + Stilanalyst + Faktenprüfer"
- **Datenanalyse**: „Datenbereinigungsagent + statistischer Modellierungsagent + Visualisierungsagent"
- **Code-Audit**: „Statische-Analyse-Agent + Abhängigkeitsketten-Auditor + Bedrohungsmodellierer"

### 5. Endgültige Liefer-Checkliste (**an Ihren tatsächlichen Bedarf anpassen**)

> Your final plan must include the following elements: ...

Die ursprüngliche Vorlage listet 6 Elemente eines „Implementierungsplans" auf. Ihr Liefergegenstand könnte etwas völlig anderes sein:

- Ein **Forschungsbericht** → „Executive Summary / Methodik / Wichtigste Erkenntnisse / Einschränkungen / Handlungsempfehlungen"
- Ein **Prüfbericht** → „Problemliste / Schweregradbewertung / Lösungsvorschläge / Vorher-Nachher-Beispiele"
- Eine **Vergleichsmatrix** → „Dimensionsdefinitionen / Bewertungsschema / Schlussfolgerungen / Begründung der Empfehlung"

---

## Tipps zur Erstellung (TL;DR)

1. **Schreiben Sie den Eröffnungssatz um**: nennen Sie Rolle, Ziel und Ausgabeformat in einer Zeile.
2. **Flexibler Workflow**: 1–2 Schritte für leichte Aufgaben, die volle 5-Schritte-Schleife nur für komplexe.
3. **Schreiben Sie die Unterrollen aus Schritt 1 um**: die Standardwerte (akademische Arbeiten / Wettbewerber / Demo) sind wahrscheinlich nicht das, was Sie wollen.
4. **Die finale „Liefer-Checkliste" ist Ihre Qualitätsschwelle**: spezifizieren Sie die Ausgabestruktur — Claude Code wird sie strikt befolgen.

---

## Ein überarbeitetes Beispiel: Wettbewerbsanalyst

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

Im Vergleich zum ursprünglichen Research Expert: auf 4 Schritte gekürzt, Unterrollen von 6 auf 3 reduziert, Liefer-Liste vollständig als „Berichtsabschnitte" umgeschrieben.
