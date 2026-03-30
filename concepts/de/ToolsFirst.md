# Warum werden Tools zuerst aufgelistet?

Im Context-Panel von cc-viewer **erscheinen Tools vor System Prompt und Messages**. Diese Reihenfolge spiegelt exakt die **KV-Cache-Präfix-Sequenz der Anthropic API** wider.

## KV-Cache-Präfix-Sequenz

Wenn die Anthropic API den KV-Cache aufbaut, verkettet sie den Kontext in dieser **festen Reihenfolge** zu einem Präfix:

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

Das bedeutet: **Tools befinden sich vor dem System Prompt, ganz am Anfang des Cache-Präfixes**.

## Warum haben Tools ein höheres Cache-Gewicht als System?

Beim KV-Cache-Präfix-Matching ist **früher Inhalt entscheidender** — jede Änderung macht alles Folgende ungültig:

1. **Präfix-Matching beginnt am Anfang**: Der KV-Cache vergleicht die aktuelle Anfrage token-für-token vom Anfang mit dem gecachten Präfix. Sobald eine Abweichung gefunden wird, wird der gesamte nachfolgende Inhalt invalidiert.

2. **Änderung der Tools = gesamter Cache invalidiert**: Da Tools an erster Stelle stehen, **bricht jede Änderung an Tool-Definitionen (auch das Hinzufügen oder Entfernen eines einzelnen MCP-Tools) das Präfix vom ersten Moment an**, wodurch alle gecachten System Prompt- und Messages-Inhalte invalidiert werden.

3. **Änderung von System = Messages-Cache invalidiert**: Der System Prompt befindet sich in der Mitte, sodass seine Änderungen nur den nachfolgenden Messages-Teil invalidieren.

4. **Änderung von Messages = nur das Ende betroffen**: Messages stehen am Ende, sodass das Anhängen neuer Messages nur ein kleines abschließendes Segment invalidiert — Tools- und System-Cache bleiben intakt.

## Praktische Auswirkungen

| Änderungstyp | Cache-Auswirkung | Typisches Szenario |
|-------------|-------------|-----------------|
| Tool hinzugefügt/entfernt | **Vollständige Invalidierung** | MCP-Server verbinden/trennen, IDE-Plugin ein-/ausschalten |
| System Prompt-Änderung | Messages-Cache verloren | CLAUDE.md bearbeiten, system reminder einfügen |
| Neue Message angehängt | Nur Tail-Inkrement | Normaler Gesprächsfluss (am häufigsten, am günstigsten) |

Deshalb ist `tools_change` in [CacheRebuild](CacheRebuild.md) oft der teuerste Rebuild-Grund — es bricht die Präfix-Kette ganz am Anfang.

## Warum werden Tool-Definitionen vor dem „Gehirn" platziert?

Aus Caching-Perspektive ist die Platzierung der Tools an erster Stelle eine technische Tatsache. Doch auch aus Sicht des kognitiven Designs ist diese Reihenfolge logisch — **Tools sind die Hände und Füße, System Prompt ist das Gehirn**.

Bevor ein Mensch handelt, muss er wahrnehmen, welche Gliedmaßen und Werkzeuge ihm zur Verfügung stehen. Ein Säugling versteht nicht zuerst die Regeln der Welt (System) und lernt dann zu greifen — er nimmt zuerst wahr, dass er Hände und Füße hat, und versteht dann durch Interaktion mit der Umwelt allmählich die Regeln. Ebenso muss ein LLM wissen, welche Tools es aufrufen kann (Dateien lesen, Code schreiben, suchen, Befehle ausführen), bevor es Aufgabenanweisungen (System Prompt) erhält, damit es bei der Verarbeitung der Anweisungen genau einschätzen kann: „Was kann ich tun?" und „Wie soll ich vorgehen?"

Wenn es umgekehrt wäre — dem Modell zuerst sagen „Deine Aufgabe ist es, dieses Modul umzubauen", dann „Du hast Read, Edit, Bash-Tools" — würde dem Modell beim Verständnis der Aufgabe kritische Information über seine Fähigkeitsgrenzen fehlen, was zu unrealistischen Plänen oder dem Übersehen verfügbarer Ansätze führen könnte.

**Erst wissen, welche Karten man hat, dann entscheiden, wie man spielt.** Das ist die kognitive Logik dahinter, dass Tools vor System stehen.

## Warum sind MCP-Tools ebenfalls an dieser Position?

MCP-Tools (Model Context Protocol) werden wie eingebaute Tools ganz vorne im Tools-Bereich platziert. Das Verständnis der Position von MCP im Kontext hilft, die tatsächlichen Vorteile und Kosten zu bewerten.

### Vorteile von MCP

- **Fähigkeitserweiterung**: MCP ermöglicht Modellen den Zugriff auf externe Dienste (Datenbankabfragen, API-Aufrufe, IDE-Operationen, Browser-Steuerung usw.) und überwindet die Grenzen eingebauter Tools
- **Offenes Ökosystem**: Jeder kann einen MCP-Server implementieren; das Modell erhält neue Fähigkeiten ohne Neutraining
- **Laden bei Bedarf**: MCP-Server können je nach Aufgabenszenario selektiv verbunden/getrennt werden, was flexible Tool-Zusammenstellungen ermöglicht

### Kosten von MCP

- **Cache-Killer**: Die JSON-Schema-Definition jedes MCP-Tools wird ganz an den Anfang des KV-Cache-Präfix angehängt. Ein MCP-Tool hinzufügen/entfernen = **gesamter Cache von Anfang an ungültig**. Häufiges Verbinden/Trennen von MCP-Servern reduziert die Cache-Trefferquote drastisch
- **Präfix-Aufblähung**: MCP-Tool-Schemas sind typischerweise größer als eingebaute Tools (detaillierte Parameterbeschreibungen, Enumerationswerte usw.). Viele MCP-Tools erhöhen die Token-Anzahl im Tools-Bereich erheblich und verringern den für Messages verfügbaren Kontext-Raum
- **Latenz-Overhead**: MCP-Tool-Aufrufe erfordern prozessübergreifende Kommunikation (JSON-RPC über stdio/SSE), eine Größenordnung langsamer als eingebaute Funktionsaufrufe
- **Stabilitätsrisiko**: MCP-Server sind externe Prozesse, die abstürzen, Timeouts verursachen oder unerwartete Formate zurückgeben können und zusätzliche Fehlerbehandlung erfordern

### Praktische Empfehlungen

| Szenario | Empfehlung |
|----------|-----------|
| Lange Gespräche, häufige Interaktion | MCP-Tool-Anzahl minimieren, um Cache-Präfix-Stabilität zu schützen |
| Kurze Aufgaben, einmalige Operationen | MCP-Tools frei verwenden; Cache-Auswirkung ist begrenzt |
| Häufiges Hinzufügen/Entfernen von MCP-Servern | Jede Änderung löst vollständigen Cache-Neuaufbau aus; feste Tool-Zusammenstellung erwägen |
| Überdimensionierte Tool-Schemas | Beschreibungen und Enums kürzen, um Token-Verbrauch im Präfix zu reduzieren |

Im Context-Panel von cc-viewer werden MCP-Tools neben eingebauten Tools im Tools-Bereich angezeigt, sodass Sie die Schema-Größe jedes Tools und seinen Beitrag zum Cache-Präfix direkt sehen können.
