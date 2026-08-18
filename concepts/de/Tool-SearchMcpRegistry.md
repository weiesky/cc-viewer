# SearchMcpRegistry

Durchsucht die MCP-Connector-Registry per Stichwort, um Connectors zu entdecken, die beim Abschließen der Aufgabe helfen könnten.

## Wann verwenden

- Die Aufgabe würde von einem externen Dienst profitieren (einer Datenbank, einem Issue-Tracker, einer SaaS-API), und Sie möchten prüfen, ob dafür ein MCP-Connector existiert.
- Der Benutzer nennt ein Produkt und bittet darum, es zu verbinden – durchsuchen Sie die Registry nach einem passenden Connector.

## Aktivierung

- Nur in Remote-Sitzungen (claude.ai) über die First-Party-API verfügbar.

## Parameter

- `keywords` (array of strings, erforderlich): Stichwortphrasen, die die Absicht des Benutzers oder ein genanntes Produkt beschreiben. 1–8 Elemente, jedes 1–64 Zeichen.

## Beispiele

### Beispiel 1: Einen Connector für ein genanntes Produkt finden

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

Gibt Registry-Einträge zurück, deren Connectors zu den Stichwörtern passen. Lösen Sie vollständige Connector-Details mit `SuggestConnectors` auf.

## Hinweise

- Schreibgeschützt und nebenläufigkeitssicher; die Ergebnisse sind größenmäßig begrenzt.- Das Suchen installiert nichts – es ist reine Erkundung.
