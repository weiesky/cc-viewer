# UltraPlan — Die ultimative Wunschmaschine

## Was ist UltraPlan

UltraPlan ist die **lokalisierte Implementierung** von cc-viewer fuer den nativen `/ultraplan`-Befehl von Claude Code. Es ermoeglicht Ihnen, die vollstaendigen Funktionen von `/ultraplan` in Ihrer lokalen Umgebung zu nutzen, **ohne Claudes offiziellen Remote-Dienst starten zu muessen**, und leitet Claude Code an, komplexe Planungs- und Implementierungsaufgaben mittels **Multi-Agenten-Zusammenarbeit** zu bewaeltigen.

Im Vergleich zum regulaeren Plan-Modus oder Agent Team kann UltraPlan:
- Bietet die Rollen **Code-Experte** und **Recherche-Experte** für verschiedene Aufgabentypen
- Einsatz mehrerer paralleler Agenten zur Erkundung der Codebasis oder Durchführung von Recherchen aus verschiedenen Perspektiven
- Externe Recherche (webSearch) fuer branchenbewaehrte Verfahren einbeziehen
- Nach der Planausfuehrung automatisch ein Code Review Team zusammenstellen
- Einen vollstaendigen **Plan → Execute → Review → Fix** Kreislauf bilden

---

## Wichtige Hinweise

### 1. UltraPlan ist nicht allmaechtig
UltraPlan ist eine leistungsfaehigere Wunschmaschine, aber das bedeutet nicht, dass jeder Wunsch erfuellt werden kann. Es ist leistungsfaehiger als Plan und Agent Team, kann aber nicht direkt „Geld fuer Sie verdienen". Beruecksichtigen Sie eine angemessene Aufgabengranularitaet — zerlegen Sie grosse Ziele in ausfuehrbare mittelgrosse Aufgaben, anstatt alles auf einmal erreichen zu wollen.

### 2. Derzeit am effektivsten fuer Programmierprojekte
Die Vorlagen und Workflows von UltraPlan sind tiefgehend fuer Programmierprojekte optimiert. Andere Szenarien (Dokumentation, Datenanalyse usw.) koennen ausprobiert werden, aber es empfiehlt sich, auf Anpassungen in zukuenftigen Versionen zu warten.

### 3. Ausfuehrungszeit und Kontextfenster-Anforderungen
- Eine erfolgreiche UltraPlan-Ausfuehrung dauert in der Regel **30 Minuten oder laenger**
- Erfordert, dass der MainAgent ein grosses Kontextfenster hat (1M-Context-Opus-Modell empfohlen)
- Wenn Sie nur ein 200K-Modell haben, **fuehren Sie unbedingt `/clear` vor der Ausfuehrung aus**
- Claude Codes `/compact` funktioniert schlecht bei unzureichendem Kontextfenster — vermeiden Sie es, den Platz aufzubrauchen
- Ausreichend Kontextplatz zu erhalten ist eine entscheidende Voraussetzung fuer eine erfolgreiche UltraPlan-Ausfuehrung

Wenn Sie Fragen oder Vorschlaege zum lokalisierten UltraPlan haben, eroeffnen Sie gerne [Issues auf GitHub](https://github.com/anthropics/claude-code/issues), um zu diskutieren und zusammenzuarbeiten.

---

## Funktionsweise

UltraPlan bietet zwei Expertenrollen für verschiedene Aufgabentypen:

### Code-Experte
Ein Multi-Agenten-Workflow für Programmierprojekte:
1. Einsatz von bis zu 5 parallelen Agenten zur gleichzeitigen Erkundung der Codebasis (Architektur, Dateiidentifikation, Risikobewertung usw.)
2. Optional: Einsatz eines Recherche-Agenten zur Untersuchung von Branchenlösungen via webSearch
3. Synthese aller Agenten-Erkenntnisse zu einem detaillierten Implementierungsplan
4. Einsatz eines Review-Agenten zur Überprüfung des Plans aus mehreren Perspektiven
5. Umsetzung nach Plangenehmigung
6. Automatische Zusammenstellung eines Code Review Teams zur Validierung der Codequalität nach der Implementierung

### Recherche-Experte
Ein Multi-Agenten-Workflow für Recherche- und Analyseaufgaben:
1. Einsatz mehrerer paralleler Agenten für Recherchen aus verschiedenen Dimensionen (Branchenanalyse, wissenschaftliche Arbeiten, Nachrichtenartikel, Wettbewerbsanalyse usw.)
2. Beauftragung eines Agenten zur Synthese der Ziellösung bei gleichzeitiger Überprüfung der Seriosität und Glaubwürdigkeit gesammelter Quellen
3. Optional: Einsatz eines Agenten zur Erstellung eines Produkt-Demos (HTML, Markdown usw.)
4. Synthese aller Agenten-Erkenntnisse zu einem umfassenden Implementierungsplan
5. Einsatz mehrerer Review-Agenten zur Überprüfung des Plans aus verschiedenen Rollen und Perspektiven
6. Umsetzung nach Plangenehmigung
