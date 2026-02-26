# CC-Viewer

[![npm version](https://img.shields.io/npm/v/cc-viewer)](https://www.npmjs.com/package/cc-viewer)

Ein Anfragenüberwachungssystem für Claude Code, das alle API-Anfragen und -Antworten in Echtzeit erfasst und visualisiert. Hilft Entwicklern, ihren Context beim Vibe Coding zu überwachen, zu überprüfen und zu debuggen.

[简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Verwendung

```bash
npm install -g cc-viewer
```

Nach der Installation ausführen:

```bash
ccv
```

Dieser Befehl erkennt automatisch die Installationsmethode von Claude Code (NPM oder Native Install) und passt sich an.

- **NPM Install**: Injiziert das Interceptor-Skript automatisch in `cli.js` von Claude Code.
- **Native Install**: Erkennt die `claude`-Binärdatei automatisch, richtet einen lokalen transparenten Proxy ein und konfiguriert einen Zsh Shell Hook, um den Datenverkehr automatisch weiterzuleiten.

### Konfigurationsüberschreibung (Configuration Override)

Wenn Sie einen benutzerdefinierten API-Endpunkt (z. B. Unternehmens-Proxy) verwenden müssen, konfigurieren Sie ihn einfach in `~/.claude/settings.json` oder setzen Sie die Umgebungsvariable `ANTHROPIC_BASE_URL`. `ccv` erkennt diese Einstellungen automatisch und leitet Anfragen korrekt weiter.

### Stiller Modus (Silent Mode)

Standardmäßig läuft `ccv` beim Wrappen von `claude` im stillen Modus, um sicherzustellen, dass Ihre Terminalausgabe sauber bleibt und identisch mit der ursprünglichen Claude Code-Erfahrung ist. Alle Protokolle werden im Hintergrund erfasst und sind unter `http://localhost:7008` sichtbar.

Verwenden Sie dann Claude Code wie gewohnt und öffnen Sie `http://localhost:7008` in Ihrem Browser, um die Überwachungsoberfläche anzuzeigen.

### Fehlerbehebung (Troubleshooting)

- **Gemischte Ausgabe (Mixed Output)**: Wenn Sie `[CC-Viewer]` Debug-Logs sehen, die mit der Ausgabe von Claude vermischt sind, aktualisieren Sie bitte auf die neueste Version (`npm install -g cc-viewer`).
- **Verbindung abgelehnt (Connection Refused)**: Stellen Sie sicher, dass der `ccv`-Hintergrundprozess läuft. Das Ausführen von `ccv` oder `claude` (nach der Hook-Installation) sollte ihn automatisch starten.
- **Kein Inhalt (Empty Body)**: Wenn Sie im Viewer "No Body" sehen, liegt dies möglicherweise an nicht standardmäßigen SSE-Formaten. Der Viewer unterstützt jetzt das Erfassen von Rohinhalten als Fallback.

### Version prüfen (Check Version)

```bash
ccv --version
```

### Deinstallation

```bash
ccv --uninstall
```

## Funktionen

### Anfragenüberwachung (Raw Mode)

- Echtzeit-Erfassung aller API-Anfragen von Claude Code, einschließlich Streaming-Antworten
- Linkes Panel zeigt Anfragemethode, URL, Dauer und Statuscode
- Automatische Erkennung und Kennzeichnung von Main Agent- und Sub Agent-Anfragen (Untertypen: Bash, Task, Plan, General)
- Anfrageliste scrollt automatisch zum ausgewählten Element (zentriert bei Moduswechsel, nächstgelegen bei manuellem Klick)
- Rechtes Panel unterstützt Umschaltung zwischen Request / Response Tabs
- Request Body klappt `messages`, `system`, `tools` standardmäßig eine Ebene auf
- Response Body standardmäßig vollständig aufgeklappt
- Umschaltung zwischen JSON-Ansicht und Klartextansicht
- JSON-Inhalt mit einem Klick kopieren
- MainAgent-Anfragen unterstützen Body Diff JSON, zeigt eingeklappt die Unterschiede zur vorherigen MainAgent-Anfrage (nur geänderte/neue Felder)
- Diff-Bereich unterstützt JSON/Text-Ansichtsumschaltung und Ein-Klick-Kopieren
- Einstellung „Diff aufklappen": Wenn aktiviert, wird der Diff-Bereich bei MainAgent-Anfragen automatisch aufgeklappt
- Body Diff JSON-Tooltip kann geschlossen werden; nach dem Schließen wird die Einstellung serverseitig gespeichert und nie wieder angezeigt
- Sensible Header (`x-api-key`, `authorization`) werden in JSONL-Log-Dateien automatisch maskiert, um Credential-Leaks zu verhindern
- Inline-Token-Nutzungsstatistiken pro Anfrage (Eingabe-/Ausgabe-Token, Cache-Erstellung/-Lesen, Trefferquote)
- Kompatibel mit Claude Code Router (CCR) und anderen Proxy-Setups — Anfragen werden als Fallback über API-Pfadmuster erkannt

### Chat Mode

Klicken Sie auf die Schaltfläche „Chat mode" oben rechts, um den vollständigen Gesprächsverlauf des Main Agent als Chat-Oberfläche darzustellen:

- Benutzernachrichten rechtsbündig (blaue Blasen), Main Agent-Antworten linksbündig (dunkle Blasen) mit Markdown-Rendering
- `/compact`-Nachrichten werden automatisch erkannt und eingeklappt angezeigt, zum Aufklappen der vollständigen Zusammenfassung klicken
- Tool-Aufruf-Ergebnisse werden inline innerhalb der entsprechenden Assistant-Nachricht angezeigt
- `thinking`-Blöcke standardmäßig eingeklappt, als Markdown gerendert, zum Aufklappen klicken; Ein-Klick-Übersetzung unterstützt
- `tool_use` als kompakte Tool-Aufruf-Karten dargestellt (Bash, Read, Edit, Write, Glob, Grep, Task haben jeweils eigene Darstellungen)
- Task (SubAgent) Tool-Ergebnisse werden als Markdown gerendert
- Benutzerauswahl-Nachrichten (AskUserQuestion) im Frage-Antwort-Format angezeigt
- System-Tags (`<system-reminder>`, `<project-reminder>`, usw.) automatisch eingeklappt
- Skill-Lademeldungen automatisch erkannt und eingeklappt, Skill-Name angezeigt; Klick zum Aufklappen der vollständigen Dokumentation (Markdown-Rendering)
- Skills-Reminder automatisch erkannt und eingeklappt
- Systemtext automatisch gefiltert, nur echte Benutzereingaben werden angezeigt
- Mehrsitzungs-Segmentanzeige (automatische Segmentierung nach `/compact`, `/clear`, usw.)
- Jede Nachricht zeigt einen sekundengenauen Zeitstempel, abgeleitet aus dem API-Anfrage-Timing
- Jede Nachricht enthält einen „Anfrage anzeigen"-Link, um zum Raw-Modus bei der entsprechenden API-Anfrage zurückzuspringen
- Bidirektionale Modus-Synchronisation: Beim Wechsel zum Chat-Modus wird zur Konversation der ausgewählten Anfrage gescrollt; beim Zurückwechseln wird zur ausgewählten Anfrage gescrollt
- Einstellungspanel: Standard-Einklappstatus für Tool-Ergebnisse und Thinking-Blöcke umschalten
- Globale Einstellungen: Filterung irrelevanter Anfragen (count_tokens, Heartbeat) ein-/ausschalten

### Übersetzung

- Thinking-Blöcke und Assistant-Nachrichten unterstützen Ein-Klick-Übersetzung
- Basierend auf Claude Haiku API, verwendet ausschließlich `x-api-key`-Authentifizierung (OAuth-Session-Tokens werden zur Vermeidung von Kontextverschmutzung ausgeschlossen)
- Erfasst automatisch den Haiku-Modellnamen aus mainAgent-Anfragen; Standard ist `claude-haiku-4-5-20251001`
- Übersetzungsergebnisse werden automatisch zwischengespeichert; erneutes Klicken wechselt zum Originaltext
- Ladeanimation während der Übersetzung
- (?) Symbol neben dem `authorization`-Header in den Anfragedetails verlinkt auf das Konzeptdokument zur Kontextverschmutzung

### Token-Statistiken

Hover-Panel im Kopfbereich:

- Token-Anzahl gruppiert nach Modell (Eingabe/Ausgabe)
- Cache-Erstellungs-/Lesezähler und Cache-Trefferquote
- Cache-Rebuild-Statistiken nach Grund gruppiert (TTL, System-/Tools-/Modelländerung, Nachrichtenkürzung/-änderung, Schlüsseländerung) mit Anzahl und cache_creation-Token
- Tool-Nutzungsstatistiken: Aufrufanzahl pro Tool, nach Häufigkeit sortiert
- Skill-Nutzungsstatistik: Aufrufhäufigkeit pro Skill, sortiert nach Häufigkeit
- Konzepthilfe (?)-Icons: Klicken zum Anzeigen der integrierten Dokumentation für MainAgent, CacheRebuild und jedes Tool
- Main Agent Cache-Ablauf-Countdown

### Log-Verwaltung

Über das CC-Viewer-Dropdown-Menü oben links:

- Lokale Logs importieren: historische Log-Dateien durchsuchen, nach Projekt gruppiert, öffnet in neuem Fenster
- Lokale JSONL-Datei laden: eine lokale `.jsonl`-Datei direkt auswählen und laden (bis zu 500MB)
- Aktuelles Log herunterladen: aktuelle Überwachungs-JSONL-Log-Datei herunterladen
- Logs zusammenführen: Mehrere JSONL-Logdateien zu einer Sitzung zusammenführen für einheitliche Analyse
- Benutzer-Prompts anzeigen: Alle Benutzereingaben extrahieren und in drei Ansichtsmodi anzeigen — Originalmodus (Rohinhalt), Kontextmodus (Systemtags einklappbar), Textmodus (reiner Text); Slash-Befehle (`/model`, `/context` usw.) als eigenständige Einträge; befehlsbezogene Tags automatisch aus dem Prompt-Inhalt ausgeblendet
- Prompts als TXT exportieren: Benutzer-Prompts (nur Text, ohne System-Tags) in eine lokale `.txt`-Datei exportieren

### Mehrsprachige Unterstützung

CC-Viewer unterstützt 18 Sprachen und wechselt automatisch basierend auf der Systemsprache:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## Lizenz

MIT
