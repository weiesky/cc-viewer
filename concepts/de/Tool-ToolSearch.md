# ToolSearch

Ruft bei Bedarf die vollständigen Schema-Definitionen „aufgeschobener Tools" ab, damit diese aufrufbar werden. Wenn viele Tools verfügbar sind, werden einige nicht von vornherein geladen – sie erscheinen nur namentlich in `<system-reminder>`-Nachrichten. Bis sein Schema abgerufen ist, ist nur der Name bekannt und es gibt keine Parameterdefinition, sodass das Tool nicht aufgerufen werden kann. `ToolSearch` nimmt eine Anfrage entgegen, gleicht sie mit der Liste der aufgeschobenen Tools ab und liefert die vollständigen JSONSchema-Definitionen der übereinstimmenden Tools innerhalb eines `<functions>`-Blocks zurück. Sobald das Schema eines Tools im Ergebnis erscheint, ist es genauso aufrufbar wie jedes oben im Prompt definierte Tool.

## Wann verwenden

- Sie benötigen ein aufgeschobenes Tool – sein Name erscheint in einem `<system-reminder>`, aber in der Tool-Liste auf oberster Ebene gibt es keine Parameterdefinition dafür.
- Sie möchten die Tools eines MCP-Servers verwenden (z. B. Slack, Gmail, computer-use), die bei Bedarf geladen werden.
- Sie sind sich des exakten Tool-Namens für eine Fähigkeit nicht sicher und möchten Kandidaten per Stichwort in einem Zug zutage fördern.

Wenn das Schema eines Tools bereits im Kontext vorliegt, nicht erneut suchen – einfach aufrufen.

## Aktivierung

- Standardmäßig aktiviert.
- Deaktiviert, wenn `ANTHROPIC_BASE_URL` auf einen Nicht-Anthropic-Endpunkt zeigt (es sei denn, `ENABLE_TOOL_SEARCH` ist gesetzt), wenn `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` gesetzt ist, wenn dem Modell die Tool-Referenz-Unterstützung fehlt (Vertex-AI-Modelle vor Claude 4.5) oder wenn die Verwendung über `"deny": ["ToolSearch"]` verweigert wird.

## Parameter

- `query` (string, erforderlich): Die Anfrage zum Auffinden aufgeschobener Tools. Drei Formen werden unterstützt:
  - `select:Read,Edit,Grep` – diese exakten Tools namentlich abrufen.
  - `notebook jupyter` – Stichwortsuche, liefert bis zu `max_results` beste Treffer zurück.
  - `+slack send` – verlangt, dass `slack` im Tool-Namen vorkommt, und ordnet dann nach den übrigen Begriffen.
- `max_results` (number, optional): Maximale Anzahl zurückzugebender Ergebnisse. Standard ist 5.

## Beispiele

### Beispiel 1: Abruf per exaktem Namen

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### Beispiel 2: Stichwortsuche

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### Beispiel 3: Ein ganzes MCP-Toolkit auf einmal laden

Beim Massenladen aller Tools eines MCP-Servers (z. B. computer-use) eine einzelne Stichwortsuche verwenden, statt jedes einzeln auszuwählen – der Servername als Teilzeichenkette passt auf jedes Tool unter diesem Server:

```
ToolSearch(query="computer-use", max_results=30)
```

## Hinweise

- Bevor Sie ein aufgeschobenes Tool aufrufen, müssen Sie zuerst sein Schema mit `ToolSearch` abrufen – ein direkter Aufruf schlägt fehl, weil die Parameterdefinition fehlt.
- Beim Massenladen eines ganzen Toolkits (z. B. aller Tools eines MCP-Servers) eine einzige Stichwortsuche gegenüber vielen `select:`-Aufrufen bevorzugen, um Hin-und-Her-Runden zu sparen.
- Sobald ein Schema abgerufen ist, verhält sich das Tool genau wie jedes normale Tool; dasselbe Tool nicht erneut suchen.
- Ergebnisse kommen als `<functions>`-Block zurück, jedes Tool als eine einzelne `<function>{...}</function>`-Zeile – dieselbe Kodierung wie die Tool-Liste auf oberster Ebene.
