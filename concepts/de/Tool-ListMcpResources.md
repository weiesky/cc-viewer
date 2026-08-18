# ListMcpResources

Listet die von verbundenen MCP-Servern bereitgestellten Ressourcen auf, optional auf einen Server gefiltert.

## Wann verwenden

- Sie müssen herausfinden, welche Ressourcen (Dateien, Datensätze, Dokumente) ein MCP-Server anbietet, bevor Sie sie lesen.
- Sie möchten einen Überblick über alle Ressourcen über sämtliche verbundenen Server hinweg.

## Parameter

- `server` (string, optional): Servername, nach dem die Ressourcen gefiltert werden sollen. Weglassen, um Ressourcen aller verbundenen Server aufzulisten.

## Beispiele

### Beispiel 1: Alles auflisten

```
ListMcpResources()
```

### Beispiel 2: Die Ressourcen eines Servers auflisten

```
ListMcpResources(server="github")
```

## Hinweise

- Dies ist der Erkundungsschritt: Speisen Sie interessante URIs in `ReadMcpResource` (einzelne Ressource) oder `ReadMcpResourceDir` (Verzeichnisauflistungen) ein.
- Server verbinden und trennen sich im Laufe der Sitzungslebensdauer; listen Sie erneut auf, wenn gerade ein Server hinzugefügt wurde.
