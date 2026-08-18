# ListConnectors

Listet die MCP-Connectors auf, die für die claude.ai-Organisation des Benutzers installiert sind, optional per Stichwort gefiltert.

## Wann verwenden

- Sie müssen wissen, welche Connectors bereits installiert sind, bevor Sie neue vorschlagen.
- Der Benutzer fragt, welche Integrationen seine Organisation hat.

## Aktivierung

- Nur in Remote-Sitzungen (claude.ai) über die First-Party-API verfügbar.

## Parameter

- `keywords` (array of strings, optional): Filtert die Liste – bis zu 8 Elemente, jedes 1–64 Zeichen. Weglassen, um alles aufzulisten.

## Beispiele

### Beispiel 1: Alle installierten Connectors auflisten

```
ListConnectors()
```

### Beispiel 2: Nach Stichwort filtern

```
ListConnectors(keywords=["github"])
```

## Hinweise

- Kombinieren Sie es mit `SearchMcpRegistry` (Erkundung) und `SuggestConnectors` (Details) für den vollständigen Finden-und-Aktivieren-Ablauf.
