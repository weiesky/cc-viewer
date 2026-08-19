# KV-Cache-Inhalt

## Was ist Prompt Caching?

Wenn du mit Claude kommunizierst, wird bei jeder API-Anfrage der vollständige Gesprächskontext gesendet (System Prompt + Tool-Definitionen + Nachrichtenverlauf). Der Prompt-Caching-Mechanismus von Anthropic speichert bereits berechnete Präfix-Inhalte serverseitig. Wenn nachfolgende Anfragen denselben Präfix haben, werden die zwischengespeicherten Ergebnisse direkt wiederverwendet, wodurch redundante Berechnungen übersprungen und Latenz sowie Kosten erheblich reduziert werden.

In cc-viewer wird dieser Mechanismus als „KV-Cache" bezeichnet und entspricht dem Prompt Caching auf Anthropic-API-Ebene – nicht dem Key-Value-Cache der internen Transformer-Attention-Schichten des LLM.

## Wie Caching funktioniert

Das Prompt Caching von Anthropic erstellt den Cache-Schlüssel in fester Reihenfolge:

```
Tools → System Prompt → Messages (bis zum Cache-Breakpoint)
```

Solange dieser Präfix innerhalb des TTL-Fensters mit einer früheren Anfrage vollständig übereinstimmt, wird der Cache getroffen (Rückgabe von `cache_read_input_tokens`), anstatt neu zu berechnen (`cache_creation_input_tokens`).

> **Claude Code ist nicht zwingend auf das `cache_control`-Attribut angewiesen. Die Serverseite entfernt teilweise diese Attribute, kann aber dennoch gut Caches erstellen. Das Fehlen des `cache_control`-Attributs bedeutet also nicht, dass kein Caching stattfindet.**
>
> Für spezielle Clients wie Claude Code verlässt sich die Serverseite von Anthropic nicht vollständig auf das `cache_control`-Attribut in der Anfrage, um das Caching-Verhalten zu bestimmen. Der Server führt automatisch Caching-Strategien für bestimmte Felder aus (wie System Prompt und Tool-Definitionen), auch wenn die Anfrage keine expliziten `cache_control`-Markierungen enthält. Wenn du dieses Attribut also nicht im Request Body siehst, besteht kein Grund zur Verwirrung – der Server hat das Caching bereits im Hintergrund durchgeführt, diese Information wird dem Client nur nicht offengelegt. Dies ist eine stillschweigende Vereinbarung zwischen Claude Code und der Anthropic-API.

## Was ist der „aktuelle KV-Cache-Inhalt"?

Der in cc-viewer angezeigte „aktuelle KV-Cache-Inhalt" wird aus der letzten MainAgent-Anfrage extrahiert und umfasst den Inhalt vor der Cache-Grenze (Cache-Breakpoint). Im Einzelnen beinhaltet er:

- **System Prompt**: Die Systemanweisungen von Claude Code, einschließlich grundlegender Agent-Anweisungen, Tool-Nutzungsrichtlinien, CLAUDE.md-Projektanweisungen, Umgebungsinformationen usw.
- **Tools**: Die Liste der aktuell verfügbaren Tool-Definitionen (wie Read, Write, Bash, Agent, MCP-Tools usw.)
- **Messages**: Der zwischengespeicherte Teil des Nachrichtenverlaufs (typischerweise ältere Nachrichten bis zur letzten `cache_control`-Markierung)

## Warum sollte man den Cache-Inhalt ansehen?

1. **Kontext verstehen**: Erfahre, welche Inhalte Claude aktuell „im Gedächtnis" hat, um zu beurteilen, ob sein Verhalten den Erwartungen entspricht
2. **Kostenoptimierung**: Cache-Treffer sind deutlich günstiger als Neuberechnungen. Die Ansicht des Cache-Inhalts hilft zu verstehen, warum bestimmte Anfragen einen Cache-Neuaufbau (Cache Rebuild) ausgelöst haben
3. **Gespräche debuggen**: Wenn Claudes Antworten nicht den Erwartungen entsprechen, kannst du den Cache-Inhalt überprüfen, um sicherzustellen, dass System Prompt und Nachrichtenverlauf korrekt sind
4. **Kontextqualitäts-Monitoring**: Beim Debuggen, Ändern von Konfigurationen oder Anpassen von Prompts bietet der KV-Cache-Text eine zentrale Ansicht, die dir hilft, schnell zu überprüfen, ob der Kernkontext degradiert ist oder durch unerwartete Inhalte verunreinigt wurde – ohne die Originalnachrichten einzeln durchsehen zu müssen

## Mehrstufige Caching-Strategie

Der KV-Cache von Claude Code besteht nicht nur aus einem einzigen Cache. Die Serverseite erstellt separate Caches für Tools und System Prompt, unabhängig vom Messages-Cache. Der Vorteil dieses Designs: Wenn der Messages-Stack Probleme aufweist (z. B. Kontextabschneidung, Nachrichtenänderungen usw.) und neu aufgebaut werden muss, werden die Caches für Tools und System Prompt nicht mit invalidiert, wodurch eine vollständige Neuberechnung vermieden wird.

Dies ist eine aktuelle serverseitige Optimierungsstrategie – da Tool-Definitionen und System Prompt im normalen Betrieb relativ stabil sind und sich selten ändern, minimiert das separate Caching unnötigen Neuaufbau-Overhead. Wenn du den Cache beobachtest, wirst du feststellen, dass außer bei einem Neuaufbau der Tools (der den gesamten Cache neu erstellen erfordert) bei Änderungen am System Prompt oder an den Messages immer noch vererbbare Caches zur Verfügung stehen.

## Lebenszyklus des Caches

- **Erstellung**: Bei der ersten Anfrage oder nach Cache-Invalidierung erstellt die API einen neuen Cache (`cache_creation_input_tokens`)
- **Treffer**: Nachfolgende Anfragen mit identischem Präfix verwenden den Cache wieder (`cache_read_input_tokens`)
- **Ablauf**: Der Cache hat eine TTL (Time to Live) von 5 Minuten und wird nach Ablauf automatisch ungültig
- **Neuaufbau**: Wenn sich System Prompt, Tool-Liste, Modell oder Nachrichteninhalte ändern, stimmt der Cache-Schlüssel nicht mehr überein und löst einen Cache-Neuaufbau der entsprechenden Ebene aus
