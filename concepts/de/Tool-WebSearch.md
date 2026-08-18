# WebSearch

Führt eine Live-Websuche durch und gibt gerankte Ergebnisse zurück, mit denen der Assistent seine Antwort auf aktuelle Informationen jenseits des Trainings-Cutoffs des Modells stützt.

## Wann verwenden

- Beantworten von Fragen zu aktuellen Ereignissen, jüngsten Releases oder Breaking News.
- Nachschlagen der neuesten Version einer Bibliothek, eines Frameworks oder CLI-Tools.
- Finden von Dokumentation oder Blogposts, wenn die genaue URL unbekannt ist.
- Verifizieren einer Tatsache, die sich seit dem Training des Modells geändert haben könnte.
- Entdecken mehrerer Perspektiven zu einem Thema, bevor eine einzelne Seite mit `WebFetch` abgerufen wird.

## Aktivierung

- Die Verfügbarkeit ist provider- und modellabhängig: verfügbar über die Anthropic-API und Claude Platform on AWS; auf Microsoft Foundry ist ein von Anthropic gehostetes Deployment erforderlich; auf Google Cloud funktioniert es mit Claude-4+-Modellen.
- Nicht verfügbar auf Amazon Bedrock.
- Begrenzung auf 200 Aufrufe pro Sitzung mit `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

## Parameter

- `query` (string, erforderlich): Die Suchanfrage. Mindestlänge 2 Zeichen. Fügen Sie das aktuelle Jahr hinzu, wenn Sie nach "aktuellen" oder "jüngsten" Informationen fragen, damit die Ergebnisse frisch sind.
- `allowed_domains` (array of strings, optional): Beschränkt Ergebnisse auf nur diese Domains, zum Beispiel `["nodejs.org", "developer.mozilla.org"]`. Nützlich, wenn Sie einer bestimmten Quelle vertrauen.
- `blocked_domains` (array of strings, optional): Schließt Ergebnisse von diesen Domains aus. Übergeben Sie dieselbe Domain nicht sowohl an `allowed_domains` als auch an `blocked_domains`.

## Beispiele

### Beispiel 1: Versions-Nachschlagen mit aktuellem Jahr

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

Liefert offizielle Ankündigungen und vermeidet Low-Quality-Aggregator-Seiten.

### Beispiel 2: Rauschige Quellen ausschließen

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

Hält die Ergebnisse auf Herstellerhinweise und Security-Tracker fokussiert.

## Hinweise

- Wenn Sie `WebSearch` in einer Antwort verwenden, müssen Sie am Ende Ihrer Antwort einen `Sources:`-Abschnitt anhängen, der jedes zitierte Ergebnis als Markdown-Hyperlink der Form `[Title](URL)` auflistet. Das ist eine harte Voraussetzung, keine Option.
- `WebSearch` ist nur für Benutzer in den Vereinigten Staaten verfügbar. Wenn das Tool in Ihrer Region nicht verfügbar ist, weichen Sie auf `WebFetch` gegen eine bekannte URL aus oder bitten Sie den Benutzer, relevanten Inhalt einzufügen.
- Jeder Aufruf führt die Suche in einem einzigen Roundtrip aus – Sie können nicht streamen oder paginieren. Verfeinern Sie die Anfrage, wenn das erste Ergebnisset unpassend ist.
- Das Tool gibt Snippets und Metadaten zurück, keine vollständigen Seiteninhalte. Um einen bestimmten Treffer tiefgehend zu lesen, folgen Sie mit `WebFetch` unter Verwendung der zurückgegebenen URL.
- Verwenden Sie `allowed_domains`, um autoritative Quellen für sicherheitsrelevante Fragen wie CVEs oder Compliance durchzusetzen, und `blocked_domains`, um SEO-Farmen auszuschließen, die Dokumentation spiegeln.
- Halten Sie Anfragen kurz und schlagwortgetrieben. Natürlichsprachliche Fragen funktionieren, neigen aber dazu, Konversationsantworten statt Primärquellen zurückzuliefern.
- Erfinden Sie keine URLs aufgrund Suchintuition – führen Sie die Suche stets aus und zitieren Sie, was das Tool tatsächlich zurückgegeben hat.
