# Cache Rebuild (Cache-Neuaufbau)

## Hintergrund

Der Prompt-Caching-Mechanismus von Anthropic verkettet system → tools → messages (bis zum Cache-Breakpoint) in der Anfrage sequenziell zu einem Cache-Schlüssel. Wenn der Cache-Schlüssel mit der vorherigen Anfrage exakt übereinstimmt, gibt die API `cache_read_input_tokens` zurück (Cache-Treffer); wenn sich der Cache-Schlüssel ändert, erstellt die API den Cache neu und gibt eine große Anzahl von `cache_creation_input_tokens` zurück – das ist der Cache-Neuaufbau.

Ein Cache-Neuaufbau bedeutet zusätzliche Token-Kosten (Cache Creation ist teurer als Cache Read), daher hat die Identifizierung der Neuaufbau-Ursachen direkten Wert für die Kostenoptimierung.

## Klassifizierung der Cache-Neuaufbau-Ursachen

cc-viewer vergleicht die Bodies zweier aufeinanderfolgender MainAgent-Anfragen und bestimmt präzise die Ursache des Cache-Neuaufbaus:

| reason | Bedeutung | Erkennungsmethode |
|--------|-----------|-------------------|
| `ttl` | Cache abgelaufen | Mehr als 5 Minuten seit der letzten MainAgent-Anfrage |
| `system_change` | System-Prompt geändert | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | Tool-Definitionen geändert | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | Modellwechsel | `prev.model !== curr.model` |
| `msg_truncated` | Nachrichtenstapel gekürzt | Die aktuelle Anfrage hat weniger Messages als die vorherige, typischerweise ausgelöst durch Kontextfenster-Überlauf |
| `msg_modified` | Verlaufsnachrichten geändert | Präfix-Nachrichten stimmen nicht überein (beim normalen Anhängen sollte das Präfix identisch sein) |
| `key_change` | Unbekannte Schlüsseländerung | Fallback, wenn keine der obigen Bedingungen zutrifft |

## Prioritätsreihenfolge

1. Zuerst wird das Zeitintervall geprüft – über 5 Minuten wird direkt als `ttl` eingestuft, ohne Body-Vergleich
2. Dann werden nacheinander model, system, tools, messages geprüft
3. Eine Anfrage kann mehrere Ursachen gleichzeitig auslösen (z.B. Modellwechsel + System-Prompt-Änderung), wobei das `reasons`-Array alle Treffer enthält und der Tooltip sie zeilenweise anzeigt

## Häufige Szenarien

- **`ttl`**: Der Benutzer pausiert länger als 5 Minuten und setzt dann fort – der Cache läuft natürlich ab
- **`system_change`**: Claude Code hat den System-Prompt aktualisiert (z.B. neue CLAUDE.md geladen, Project Instructions geändert)
- **`tools_change`**: MCP-Server-Verbindung/-Trennung führt zu Änderungen in der verfügbaren Tool-Liste
- **`model_change`**: Der Benutzer wechselt das Modell über den `/model`-Befehl
- **`msg_truncated`**: Ein zu langes Gespräch löst die Kontextfenster-Verwaltung aus, Claude Code kürzt frühere Nachrichten
- **`msg_modified`**: Claude Code hat Verlaufsnachrichten bearbeitet (z.B. `/compact` ersetzt Originalnachrichten durch komprimierte Zusammenfassungen)
