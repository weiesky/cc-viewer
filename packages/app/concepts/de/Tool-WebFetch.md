# WebFetch

Ruft den Inhalt einer öffentlichen Webseite ab, konvertiert das HTML in Markdown und führt ein kleines Hilfsmodell mit einer Natürlichsprachlichen Aufforderung über das Ergebnis laufen, um die gewünschten Informationen zu extrahieren.

## Wann verwenden

- Lesen einer öffentlichen Dokumentationsseite, eines Blogposts oder eines RFCs, der in der Unterhaltung referenziert wird.
- Extrahieren einer bestimmten Tatsache, eines Code-Snippets oder einer Tabelle aus einer bekannten URL, ohne die gesamte Seite in den Kontext zu laden.
- Zusammenfassen von Release Notes oder Changelogs aus einer offenen Webressource.
- Prüfen der öffentlichen API-Referenz einer Bibliothek, wenn die Quelle nicht im lokalen Repository vorhanden ist.
- Einem vom Benutzer im Chat eingefügten Link folgen, um eine Folgefrage zu beantworten.

## Parameter

- `url` (string, erforderlich): Eine voll ausgeformte absolute URL. Einfaches `http://` wird automatisch auf `https://` aktualisiert.
- `prompt` (string, erforderlich): Die Anweisung, die an das kleine Extraktionsmodell übergeben wird. Beschreiben Sie genau, was aus der Seite herausgezogen werden soll, z. B. "list all exported functions" oder "return the minimum supported Node version".

## Beispiele

### Beispiel 1: Einen Konfigurations-Standardwert extrahieren

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

Das Tool holt die Vite-Dokumentationsseite, wandelt sie in Markdown um und gibt eine kurze Antwort zurück wie "Default is `5173`; accepts a number only."

### Beispiel 2: Einen Changelog-Abschnitt zusammenfassen

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

Nützlich, wenn der Benutzer fragt "was hat sich in Node 20.11 geändert" und die Release-Seite lang ist.

## Hinweise

- `WebFetch` schlägt bei jeder URL fehl, die Authentifizierung, Cookies oder ein VPN erfordert. Für Google Docs, Confluence, Jira, private GitHub-Ressourcen oder interne Wikis verwenden Sie stattdessen einen dedizierten MCP-Server, der authentifizierten Zugriff bereitstellt.
- Für alles, was auf GitHub gehostet wird (PRs, Issues, Datei-Blobs, API-Antworten), bevorzugen Sie die `gh`-CLI über `Bash` statt die Web-UI zu scrapen. `gh pr view`, `gh issue view` und `gh api` geben strukturierte Daten zurück und funktionieren gegen private Repositories.
- Ergebnisse können zusammengefasst werden, wenn die abgerufene Seite sehr groß ist. Wenn Sie exakten Text benötigen, formulieren Sie den `prompt` enger, um einen wörtlichen Auszug anzufordern.
- Ein selbstbereinigender 15-Minuten-Cache wird pro URL angewendet. Wiederholte Aufrufe derselben Seite innerhalb einer Sitzung sind nahezu sofort, können aber leicht veralteten Inhalt zurückgeben. Wenn Aktualität wichtig ist, erwähnen Sie das im Prompt oder warten Sie den Cache ab.
- Gibt der Ziel-Host eine Cross-Host-Umleitung aus, gibt das Tool die neue URL in einem speziellen Antwortblock zurück und folgt ihr nicht automatisch. Rufen Sie `WebFetch` mit dem Umleitungsziel erneut auf, wenn Sie den Inhalt dennoch möchten.
- Der Prompt wird von einem kleineren, schnelleren Modell als dem Hauptassistenten ausgeführt. Halten Sie ihn eng und konkret; komplexes mehrstufiges Reasoning wird besser erledigt, indem Sie das rohe Markdown nach dem Abruf selbst lesen.
- Übergeben Sie niemals Geheimnisse, Tokens oder in der URL eingebettete Session-Bezeichner – Seiteninhalte und in der Ausgabe widergespiegelte Query-Strings können von vorgelagerten Diensten protokolliert werden.
