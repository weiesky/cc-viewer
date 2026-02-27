# CC-Viewer

Anfragenüberwachungssystem für Claude Code, das alle API-Anfragen und -Antworten in Echtzeit erfasst und visualisiert (Originaltext, ungekürzt). Ermöglicht Entwicklern die Überwachung ihres Contexts, um Probleme beim Vibe Coding nachzuvollziehen und zu beheben.

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | Deutsch | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Verwendung

### Installation

```bash
npm install -g cc-viewer
```

### Ausführen und automatische Konfiguration

```bash
ccv
```

Dieser Befehl erkennt automatisch die Installationsmethode von Claude Code (NPM oder Native Install) und passt sich entsprechend an.

- **NPM-Installation**: Injiziert automatisch das Interceptor-Skript in `cli.js` von Claude Code.
- **Native Install**: Erkennt automatisch die `claude`-Binärdatei, konfiguriert einen lokalen transparenten Proxy und richtet einen Zsh Shell Hook ein, um den Datenverkehr automatisch weiterzuleiten.

### Konfigurationsüberschreibung (Configuration Override)

Wenn Sie einen benutzerdefinierten API-Endpunkt verwenden müssen (z. B. Unternehmens-Proxy), konfigurieren Sie ihn einfach in `~/.claude/settings.json` oder setzen Sie die Umgebungsvariable `ANTHROPIC_BASE_URL`. `ccv` erkennt diese Einstellungen automatisch und leitet Anfragen korrekt weiter.

### Stiller Modus (Silent Mode)

Standardmäßig läuft `ccv` beim Wrappen von `claude` im stillen Modus, um sicherzustellen, dass Ihre Terminalausgabe sauber bleibt und identisch mit der nativen Erfahrung ist. Alle Protokolle werden im Hintergrund erfasst und sind unter `http://localhost:7008` einsehbar.

Nach Abschluss der Konfiguration verwenden Sie den `claude`-Befehl wie gewohnt. Öffnen Sie `http://localhost:7008`, um die Überwachungsoberfläche anzuzeigen.

### Fehlerbehebung (Troubleshooting)

Wenn Sie auf Startprobleme stoßen, gibt es eine ultimative Lösung:
Schritt 1: Öffnen Sie Claude Code in einem beliebigen Verzeichnis;
Schritt 2: Geben Sie Claude Code folgende Anweisung:
```
Ich habe das npm-Paket cc-viewer installiert, aber es lässt sich nicht starten. Schau dir cli.js und findcc.js von cc-viewer an und passe die lokale Claude Code-Deployment-Methode entsprechend an. Beschränke die Änderungen dabei möglichst auf findcc.js.
```
Claude Code selbst die Fehler prüfen zu lassen ist effektiver als jede andere Person zu fragen oder Dokumentation zu lesen!

Nachdem die obigen Anweisungen abgeschlossen sind, wird findcc.js aktualisiert. Wenn Ihr Projekt häufig lokal bereitgestellt werden muss oder der geforkte Code regelmäßig Installationsprobleme lösen muss, behalten Sie diese Datei einfach. Beim nächsten Mal können Sie sie direkt kopieren. Derzeit setzen viele Projekte und Unternehmen Claude Code nicht auf dem Mac ein, sondern auf serverseitig gehosteten Deployments. Daher hat der Autor findcc.js ausgelagert, um das Tracking von cc-viewer-Quellcode-Updates zu erleichtern.

### Deinstallation

```bash
ccv --uninstall
```

### Version prüfen

```bash
ccv --version
```

## Funktionen

### Anfragenüberwachung (Originaltextmodus)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Echtzeit-Erfassung aller API-Anfragen von Claude Code — im Originaltext, nicht in gekürzten Logs (das ist wichtig!!!)
- Automatische Erkennung und Kennzeichnung von Main Agent- und Sub Agent-Anfragen (Untertypen: Bash, Task, Plan, General)
- MainAgent-Anfragen unterstützen Body Diff JSON, das eingeklappt die Unterschiede zur vorherigen MainAgent-Anfrage anzeigt (nur geänderte/neue Felder)
- Inline-Token-Nutzungsstatistiken pro Anfrage (Eingabe-/Ausgabe-Token, Cache-Erstellung/-Lesen, Trefferquote)
- Kompatibel mit Claude Code Router (CCR) und anderen Proxy-Szenarien — Anfragen werden als Fallback über API-Pfadmuster erkannt

### Konversationsmodus

Klicken Sie auf die Schaltfläche „Konversationsmodus" oben rechts, um den vollständigen Gesprächsverlauf des Main Agent als Chat-Oberfläche darzustellen:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Darstellung von Agent Teams wird derzeit noch nicht unterstützt
- Benutzernachrichten rechtsbündig (blaue Blasen), Main Agent-Antworten linksbündig (dunkle Blasen)
- `thinking`-Blöcke sind standardmäßig eingeklappt, werden als Markdown gerendert und können zum Anzeigen des Denkprozesses aufgeklappt werden; Ein-Klick-Übersetzung wird unterstützt (Funktion noch instabil)
- Benutzerauswahl-Nachrichten (AskUserQuestion) werden im Frage-Antwort-Format dargestellt
- Bidirektionale Modussynchronisation: Beim Wechsel zum Konversationsmodus wird automatisch zur Konversation der ausgewählten Anfrage navigiert; beim Zurückwechseln zum Originaltextmodus wird automatisch zur ausgewählten Anfrage navigiert
- Einstellungspanel: Standardmäßiger Einklappstatus von Tool-Ergebnissen und Thinking-Blöcken kann umgeschaltet werden


### Statistik-Tools

Hover-Panel „Datenstatistik" im Header-Bereich:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Anzeige von Cache-Erstellungs-/Lesezählern und Cache-Trefferquote
- Cache-Rebuild-Statistiken: nach Grund gruppiert (TTL, System-/Tools-/Modelländerung, Nachrichtenkürzung/-änderung, Schlüsseländerung) mit Anzahl und cache_creation-Token
- Tool-Nutzungsstatistiken: Aufrufanzahl pro Tool, nach Häufigkeit sortiert
- Skill-Nutzungsstatistiken: Aufrufhäufigkeit pro Skill, nach Häufigkeit sortiert
- Konzepthilfe (?)-Icons: Klicken zum Anzeigen der integrierten Dokumentation für MainAgent, CacheRebuild und jedes Tool

### Log-Verwaltung

Über das CC-Viewer-Dropdown-Menü oben links:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Lokale Logs importieren: Historische Log-Dateien durchsuchen, nach Projekt gruppiert, öffnet in neuem Fenster
- Lokale JSONL-Datei laden: Eine lokale `.jsonl`-Datei direkt auswählen und laden (bis zu 500MB)
- Aktuelles Log speichern unter: Aktuelle Überwachungs-JSONL-Log-Datei herunterladen
- Logs zusammenführen: Mehrere JSONL-Log-Dateien zu einer Sitzung zusammenführen für einheitliche Analyse
- Benutzer-Prompts anzeigen: Alle Benutzereingaben extrahieren und anzeigen, mit drei Ansichtsmodi — Originalmodus (Rohinhalt), Kontextmodus (Systemtags einklappbar), Textmodus (reiner Text); Slash-Befehle (`/model`, `/context` usw.) als eigenständige Einträge; befehlsbezogene Tags werden automatisch aus dem Prompt-Inhalt ausgeblendet
- Prompts als TXT exportieren: Benutzer-Prompts (reiner Text, ohne Systemtags) in eine lokale `.txt`-Datei exportieren

### Mehrsprachige Unterstützung

CC-Viewer unterstützt 18 Sprachen und wechselt automatisch basierend auf der Systemsprache:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
