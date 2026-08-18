# Artifact

Rendert eine HTML- oder Markdown-Datei in ein Artifact — eine standardmäßig private Webseite, die auf claude.ai gehostet wird und der Benutzer im Browser öffnen und später freigeben kann. Verwenden Sie diese Option, wenn die visuelle Kommunikation dem Text im Terminal überlegen ist.

## Wann verwenden

- Veröffentlichung eines visuellen Lieferobjekts: ein Bericht, ein Dashboard, eine Fehleruntersuchung oder ein UI-Mockup
- Aktualisierung einer zuvor veröffentlichten Seite an Ort und Stelle (derselbe Dateipfad wird auf derselben URL erneut bereitgestellt)
- Auflistung der bestehenden Artifacts des Benutzers, um eines aus einer früheren Sitzung zu finden (`action: "list"`)
- **Nicht** für Inhalte, die lokal bleiben müssen, reine Textantworten oder alles, was externe Netzwerkressourcen beim Anzeigen benötigt — eine strikte CSP blockiert jeden externen Host

## Aktivierung

- Erfordert einen Pro-, Max-, Team- oder Enterprise-Plan mit claude.ai-Login (`/login`).
- Nur Anthropic-API – nicht verfügbar auf Amazon Bedrock, Google Cloud oder Microsoft Foundry.
- Erfordert Claude Code ≥ 2.1.183 oder die Desktop-App ≥ 1.13576.0.
- Deaktivieren Sie es mit der Einstellung `disableArtifact` oder `CLAUDE_CODE_DISABLE_ARTIFACT=1`.

## Parameter

- `file_path` (Zeichenkette): Pfad zur `.html` oder `.md` Datei zum Rendern. Die Datei wird zur Veröffentlichungszeit in ein Dokumentgerüst eingewickelt, daher schreiben Sie den Seiteninhalt direkt — keine `<!DOCTYPE>`, `<html>`, `<head>` oder `<body>` Tags. Derselbe Pfad → dieselbe URL bei erneuter Bereitstellung; ein anderer Pfad beansprucht eine neue URL.
- `favicon` (Zeichenkette, erforderlich zum Veröffentlichen): Ein oder zwei Emoji, die als Browser-Tab-Symbol verwendet werden (z. B. `"📊"`). Nur Emoji, kein Markup. Behalten Sie es über Bereitstellungen hinweg gleich — Benutzer finden ihre Registerkarte anhand des Symbols.
- `description` (Zeichenkette): Ein kurzer Untertitel, der auf der Artifact-Galerie-Karte angezeigt wird.
- `url` (Zeichenkette, optional): Übergeben Sie die URL eines bestehenden Artifacts, um es aus einer Konversation zu aktualisieren, die es nicht veröffentlicht hat. Ohne sie erzeugt eine neue Konversation immer eine neue URL.
- `label` (Zeichenkette, optional): Kurze, benutzerfreundliche Versionsnummer (max. 60 Zeichen), angezeigt in der Versionswahl.
- `action` (Zeichenkette, optional): `"publish"` (Standard) oder `"list"` — listet die veröffentlichten Artifacts des Benutzers auf (Titel, URL, Letzte Aktualisierung), optional mit `limit`.
- `force` (Boolescher Wert, optional): Ohne Konfliktprüfung überschreiben. Nur nach 409 von gleichzeitigem Schreiben, nach Abgleich.

## Hinweise

- **Nur selbstenthalten.** Eine strikte CSP blockiert Anfragen an jeden externen Host — CDN-Skripte, externe Stylesheets, Remote-Bilder, Fetch/WebSockets. Alle CSS/JS inline und Assets als `data:` URIs einbetten.
- **Reaktiv und themabewusst.** Seiten werden im hellen oder dunklen Theme des Betrachters gerendert; Stil beide (`prefers-color-scheme` plus das `data-theme` Override des Betrachters). Breiter Inhalt scrollt in seinem eigenen Container — der Seiten-Body muss niemals horizontal scrollen.
- **Aktualisierung über Konversationen benötigt `url`.** Das erneute Bereitstellen desselben Dateipfads stellt die URL nur innerhalb der Konversation wieder her, die sie veröffentlicht hat; um den Link eines älteren Artifacts zu behalten, finden Sie seine URL mit `action: "list"` und übergeben Sie sie als `url`.
- **Veröffentlichung ist nach außen gerichtet.** Inhalt, der an den Artifact-Service gesendet wird, kann zwischengespeichert werden, auch wenn er später gelöscht wird — veröffentlichen Sie nichts, das private auf dem Computer bleiben muss.
- **Mit WebFetch zurücklesen.** claude.ai Artifact-URLs können über WebFetch abgerufen werden (nicht curl, das die App-Shell erhält).
