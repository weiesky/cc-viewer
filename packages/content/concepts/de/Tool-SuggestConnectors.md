# SuggestConnectors

Löst vollständige Connector-Payloads für `directoryUuid`-Werte auf, die `SearchMcpRegistry` zurückgegeben hat, damit dem Benutzer konkrete Connectors zum Aktivieren angeboten werden können.

## Wann verwenden

- Nachdem `SearchMcpRegistry` Kandidaten-Connectors zurückgegeben hat, um ihre vollständigen Details zur Darstellung abzurufen.

## Aktivierung

- Nur in Remote-Sitzungen (claude.ai) über die First-Party-API verfügbar.

## Parameter

- `uuids` (array of strings, erforderlich): Aufzulösende `directoryUuid`- oder `server_id`-Werte. 1–32 Elemente, jedes 1–64 Zeichen.

## Beispiele

### Beispiel 1: Zwei Registry-Treffer auflösen

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## Hinweise

- Raten Sie niemals UUIDs – lösen Sie nur Kennungen auf, die von `SearchMcpRegistry` zurückkamen.
- Das Tool verbindet selbst nichts; das Aktivieren eines Connectors erfolgt separat.