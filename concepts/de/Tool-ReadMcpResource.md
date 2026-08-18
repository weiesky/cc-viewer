# ReadMcpResource

Liest eine einzelne Ressource, die von einem verbundenen MCP-Server (Model Context Protocol) bereitgestellt wird, adressiert über ihre URI.

## Wann verwenden

- Ein MCP-Server kündigt eine Ressource an (Datei, Datensatz, Dokument), deren Inhalt Sie im Kontext benötigen.
- Sie haben eine konkrete Ressourcen-URI – aus `ListMcpResources`, aus der Dokumentation des Servers oder aus einem früheren Tool-Ergebnis.

## Aktivierung

- Immer aktiviert, wird aber nicht in der Tool-Liste des Modells angezeigt – für Thin-Client-/Sidecar-Nutzung gedacht.

## Parameter

- `server` (string, erforderlich): Der Name des MCP-Servers.
- `uri` (string, erforderlich): Die zu lesende Ressourcen-URI.

## Beispiele

### Beispiel 1: Eine Server-Ressource per URI lesen

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

Gibt den Ressourceninhalt so zurück, wie er vom MCP-Server `github` bereitgestellt wird.

## Hinweise

- Verwenden Sie zuerst `ListMcpResources`, wenn Sie nicht wissen, welche Ressourcen ein Server bereitstellt; für verzeichnisartige Auflistungen `ReadMcpResourceDir` verwenden.
- Das URI-Schema ist serverspezifisch (`file://`, `https://`, eigene Schemata) – prüfen Sie, was der Zielserver ankündigt.
