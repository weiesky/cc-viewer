# ReadMcpResourceDir

Listet die Einträge einer verzeichnisartigen Ressource auf, die von einem verbundenen MCP-Server bereitgestellt wird, adressiert über ihre URI.

## Wann verwenden

- Ein MCP-Server organisiert Ressourcen hierarchisch, und Sie müssen eine Ebene dieser Hierarchie aufzählen.
- Sie möchten erst stöbern, bevor Sie einzelne Ressourcen mit `ReadMcpResource` lesen.

## Aktivierung

- Immer aktiviert, wird aber nicht in der Tool-Liste des Modells angezeigt – für Thin-Client-/Sidecar-Nutzung gedacht.

## Parameter

- `server` (string, erforderlich): Der Name des MCP-Servers.
- `uri` (string, erforderlich): Die aufzulistende Verzeichnis-Ressourcen-URI.

## Beispiele

### Beispiel 1: Ein Ressourcenverzeichnis auflisten

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

Gibt die Kindeinträge zurück, die der Server unter dieser Verzeichnis-URI bereitstellt.

## Hinweise

- Nur Server, die ihre Ressourcen als Verzeichnisse modellieren, unterstützen dies; flache Server geben einen Fehler oder eine leere Auflistung zurück – weichen Sie auf `ListMcpResources` aus.
- Kombinieren Sie es mit `ReadMcpResource`, um in die relevant erscheinenden Einträge hineinzugehen.
