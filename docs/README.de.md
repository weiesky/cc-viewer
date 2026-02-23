# CC-Viewer

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

Dieser Befehl konfiguriert automatisch Ihr lokal installiertes Claude Code für die Überwachung und fügt einen Auto-Reparatur-Hook in Ihre Shell-Konfiguration (`~/.zshrc` oder `~/.bashrc`) ein. Verwenden Sie dann Claude Code wie gewohnt und öffnen Sie `http://localhost:7008` in Ihrem Browser, um die Überwachungsoberfläche anzuzeigen.

Nach einem Update von Claude Code ist keine manuelle Aktion erforderlich — beim nächsten Start von `claude` wird die Konfiguration automatisch erkannt und erneut durchgeführt.

### Deinstallation

```bash
ccv --uninstall
```

## Funktionen

### Anfragenüberwachung (Raw Mode)

- Echtzeit-Erfassung aller API-Anfragen von Claude Code, einschließlich Streaming-Antworten
- Linkes Panel zeigt Anfragemethode, URL, Dauer und Statuscode
- Automatische Erkennung und Kennzeichnung von Main Agent- und Sub Agent-Anfragen (Untertypen: Bash, Task, Plan, General)
- Rechtes Panel unterstützt Umschaltung zwischen Request / Response Tabs
- Request Body klappt `messages`, `system`, `tools` standardmäßig eine Ebene auf
- Response Body standardmäßig vollständig aufgeklappt
- Umschaltung zwischen JSON-Ansicht und Klartextansicht
- JSON-Inhalt mit einem Klick kopieren
- MainAgent-Anfragen unterstützen Body Diff JSON, zeigt eingeklappt die Unterschiede zur vorherigen MainAgent-Anfrage (nur geänderte/neue Felder)
- Body Diff JSON-Tooltip kann geschlossen werden; nach dem Schließen wird die Einstellung serverseitig gespeichert und nie wieder angezeigt
- Inline-Token-Nutzungsstatistiken pro Anfrage (Eingabe-/Ausgabe-Token, Cache-Erstellung/-Lesen, Trefferquote)

### Chat Mode

Klicken Sie auf die Schaltfläche „Chat mode" oben rechts, um den vollständigen Gesprächsverlauf des Main Agent als Chat-Oberfläche darzustellen:

- Benutzernachrichten rechtsbündig (blaue Blasen), Main Agent-Antworten linksbündig (dunkle Blasen) mit Markdown-Rendering
- `/compact`-Nachrichten werden automatisch erkannt und eingeklappt angezeigt, zum Aufklappen der vollständigen Zusammenfassung klicken
- Tool-Aufruf-Ergebnisse werden inline innerhalb der entsprechenden Assistant-Nachricht angezeigt
- `thinking`-Blöcke standardmäßig eingeklappt, als Markdown gerendert, zum Aufklappen klicken
- `tool_use` als kompakte Tool-Aufruf-Karten dargestellt (Bash, Read, Edit, Write, Glob, Grep, Task haben jeweils eigene Darstellungen)
- Task (SubAgent) Tool-Ergebnisse werden als Markdown gerendert
- Benutzerauswahl-Nachrichten (AskUserQuestion) im Frage-Antwort-Format angezeigt
- System-Tags (`<system-reminder>`, `<project-reminder>`, usw.) automatisch eingeklappt
- Skill-Lademeldungen automatisch erkannt und eingeklappt, Skill-Name angezeigt; Klick zum Aufklappen der vollständigen Dokumentation (Markdown-Rendering)
- Systemtext automatisch gefiltert, nur echte Benutzereingaben werden angezeigt
- Mehrsitzungs-Segmentanzeige (automatische Segmentierung nach `/compact`, `/clear`, usw.)
- Jede Nachricht zeigt einen sekundengenauen Zeitstempel, abgeleitet aus dem API-Anfrage-Timing
- Einstellungspanel: Standard-Einklappstatus für Tool-Ergebnisse und Thinking-Blöcke umschalten

### Token-Statistiken

Hover-Panel im Kopfbereich:

- Token-Anzahl gruppiert nach Modell (Eingabe/Ausgabe)
- Cache-Erstellungs-/Lesezähler und Cache-Trefferquote
- Main Agent Cache-Ablauf-Countdown

### Log-Verwaltung

Über das CC-Viewer-Dropdown-Menü oben links:

- Lokale Logs importieren: historische Log-Dateien durchsuchen, nach Projekt gruppiert, öffnet in neuem Fenster
- Lokale JSONL-Datei laden: eine lokale `.jsonl`-Datei direkt auswählen und laden (bis zu 200 MB)
- Aktuelles Log herunterladen: aktuelle Überwachungs-JSONL-Log-Datei herunterladen
- Benutzer-Prompts exportieren: alle Benutzereingaben extrahieren und anzeigen, XML-Tags (system-reminder usw.) einklappbar; Slash-Befehle (`/model`, `/context` usw.) als eigenständige Einträge angezeigt; befehlsbezogene Tags automatisch aus dem Prompt-Inhalt ausgeblendet
- Prompts als TXT exportieren: Benutzer-Prompts (nur Text, ohne System-Tags) in eine lokale `.txt`-Datei exportieren

### Mehrsprachige Unterstützung

CC-Viewer unterstützt 18 Sprachen und wechselt automatisch basierend auf der Systemsprache:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## Lizenz

MIT
