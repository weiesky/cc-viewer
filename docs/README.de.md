# CC-Viewer

Anfragenuberwachungssystem fur Claude Code, das alle API-Anfragen und -Antworten in Echtzeit erfasst und visualisiert (Originaltext, ungekurzt). Ermoglicht Entwicklern die Uberwachung ihres Contexts, um Probleme beim Vibe Coding nachzuvollziehen und zu beheben.
Die neueste Version von CC-Viewer bietet ausserdem Losungen fur serverbasiertes Web-Programmieren sowie Tools fur die mobile Programmierung. Wir laden alle ein, diese in ihren eigenen Projekten einzusetzen. In Zukunft werden weitere Plugin-Funktionen und Cloud-Deployment-Unterstutzung folgen.

Zunachst der spannende Teil -- so sieht es auf dem Mobilgerat aus:

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | Deutsch | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Verwendung

### Installation

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Programmiermodus

ccv ist ein direkter Ersatz fur claude -- alle Parameter werden transparent an claude weitergegeben, wahrend gleichzeitig der Web Viewer gestartet wird.

```bash
ccv                    # == claude (interaktiver Modus)
ccv -c                 # == claude --continue (letzte Konversation fortsetzen)
ccv -r                 # == claude --resume (Konversation wiederherstellen)
ccv -p "hello"         # == claude --print "hello" (Druckmodus)
ccv --d                # == claude --dangerously-skip-permissions (Kurzform)
ccv --model opus       # == claude --model opus
```

Der Autor selbst verwendet meistens:
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

Nach dem Start des Programmiermodus wird automatisch eine Webseite geoffnet.

Sie konnen Claude direkt auf der Webseite nutzen und gleichzeitig die vollstandigen Request-Daten einsehen sowie Code-Anderungen uberprufen.

Und noch besser -- Sie konnen sogar auf dem Mobilgerat programmieren!


### Logger-Modus

⚠️ Wenn Sie weiterhin das native claude-Tool oder das VS Code-Plugin verwenden mochten, nutzen Sie bitte diesen Modus.

In diesem Modus wird beim Starten von ```claude``` oder ```claude --dangerously-skip-permissions```

automatisch ein Log-Prozess gestartet, der Anfragen in ~/.claude/cc-viewer/*IhrProjekt*/date.jsonl protokolliert.

Logger-Modus starten:
```bash
ccv -logger
```

Wenn der spezifische Port nicht in der Konsole ausgegeben werden kann, ist der erste Standardport 127.0.0.1:7008. Bei mehreren gleichzeitigen Instanzen werden die Ports fortlaufend erhoht, z. B. 7009, 7010.

Dieser Befehl erkennt automatisch die Installationsmethode von Claude Code (NPM oder Native Install) und passt sich entsprechend an.

- **NPM-Version von Claude Code**: Injiziert automatisch das Interceptor-Skript in `cli.js` von Claude Code.
- **Native-Version von Claude Code**: Erkennt automatisch die `claude`-Binardatei, konfiguriert einen lokalen transparenten Proxy und richtet einen Zsh Shell Hook ein, um den Datenverkehr automatisch weiterzuleiten.
- Dieses Projekt empfiehlt die Verwendung der uber NPM installierten Version von Claude Code.

Logger-Modus deinstallieren:
```bash
ccv --uninstall
```

### Fehlerbehebung (Troubleshooting)

Wenn Sie auf Startprobleme stossen, gibt es eine ultimative Losung:
Schritt 1: Offnen Sie Claude Code in einem beliebigen Verzeichnis;
Schritt 2: Geben Sie Claude Code folgende Anweisung:
```
Ich habe das npm-Paket cc-viewer installiert, aber nach dem Ausfuhren von ccv funktioniert es immer noch nicht richtig. Schau dir cli.js und findcc.js von cc-viewer an und passe die lokale Claude Code-Deployment-Methode entsprechend der konkreten Umgebung an. Beschranke die Anderungen dabei moglichst auf findcc.js.
```
Claude Code selbst die Fehler prufen zu lassen ist effektiver als jede andere Person zu fragen oder Dokumentation zu lesen!

Nachdem die obigen Anweisungen abgeschlossen sind, wird findcc.js aktualisiert. Wenn Ihr Projekt haufig lokal bereitgestellt werden muss oder der geforkte Code regelmasig Installationsprobleme losen muss, behalten Sie diese Datei einfach bei. Beim nachsten Mal konnen Sie sie direkt kopieren. Derzeit setzen viele Projekte und Unternehmen Claude Code nicht auf dem Mac ein, sondern auf serverseitig gehosteten Deployments. Daher hat der Autor findcc.js ausgelagert, um das Nachverfolgen von cc-viewer-Quellcode-Updates zu erleichtern.

### Weitere Hilfsbefehle

Hilfe anzeigen:
```bash
ccv -h
```

### Konfigurationsuberschreibung (Configuration Override)

Wenn Sie einen benutzerdefinierten API-Endpunkt verwenden mussen (z. B. Unternehmens-Proxy), konfigurieren Sie ihn einfach in `~/.claude/settings.json` oder setzen Sie die Umgebungsvariable `ANTHROPIC_BASE_URL`. `ccv` erkennt diese Einstellungen automatisch und leitet Anfragen korrekt weiter.

### Stiller Modus (Silent Mode)

Standardmasig lauft `ccv` beim Wrappen von `claude` im stillen Modus, um sicherzustellen, dass Ihre Terminalausgabe sauber bleibt und identisch mit der nativen Erfahrung ist. Alle Protokolle werden im Hintergrund erfasst und sind unter `http://localhost:7008` einsehbar.

Nach Abschluss der Konfiguration verwenden Sie den `claude`-Befehl wie gewohnt. Offnen Sie `http://localhost:7008`, um die Uberwachungsoberflache anzuzeigen.


## Client-Version

CC-Viewer bietet eine Desktop-Client-Version an, die Sie auf GitHub herunterladen konnen:
[Download-Link](https://github.com/weiesky/cc-viewer/releases)
Die Client-Version befindet sich derzeit in der Testphase. Bei Problemen konnen Sie jederzeit Feedback geben. Ausserdem setzt die Nutzung von cc-viewer voraus, dass Claude Code lokal installiert ist.
Bitte beachten Sie: cc-viewer ist lediglich ein „Kleidungsstuck" fur den Arbeiter (Claude Code). Ohne Claude Code kann das Kleidungsstuck nicht eigenstandig funktionieren.


## Funktionen


### Programmiermodus

Nach dem Start mit ccv sehen Sie:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


Sie konnen nach Abschluss der Bearbeitung direkt den Code-Diff anzeigen:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Obwohl Sie Dateien offnen und manuell programmieren konnen, wird dies nicht empfohlen -- das ist altmodisches Programmieren!

### Mobile Programmierung

Sie konnen sogar einen QR-Code scannen, um auf Mobilgeraten zu programmieren:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

Erfullt Ihre Vorstellungen von mobiler Programmierung. Ausserdem gibt es einen Plugin-Mechanismus -- wenn Sie Anpassungen an Ihre Programmiergewohnheiten vornehmen mochten, konnen Sie spater die Plugin-Hooks-Updates verfolgen.

### Logger-Modus (vollstandige Claude Code Konversation anzeigen)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Erfasst in Echtzeit alle von Claude Code gesendeten API-Anfragen und stellt sicher, dass es sich um den Originaltext handelt -- nicht um gekurzte Logs (das ist sehr wichtig!!!)
- Erkennt und markiert automatisch Main Agent und Sub Agent Anfragen (Untertypen: Plan, Search, Bash)
- MainAgent-Anfragen unterstutzen Body Diff JSON, zeigen eingeklappt die Unterschiede zur vorherigen MainAgent-Anfrage an (nur geanderte/neue Felder werden angezeigt)
- Jede Anfrage zeigt inline Token-Nutzungsstatistiken an (Eingabe-/Ausgabe-Token, Cache-Erstellung/-Lesung, Trefferquote)
- Kompatibel mit Claude Code Router (CCR) und anderen Proxy-Szenarien -- Anfragen werden uber API-Pfadmuster-Fallback abgeglichen

### Konversationsmodus

Klicken Sie auf die Schaltflache "Konversationsmodus" oben rechts, um den vollstandigen Konversationsverlauf des Main Agent als Chat-Oberflache darzustellen:

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Agent Team-Anzeige wird derzeit nicht unterstutzt
- Benutzernachrichten rechtsbundig (blaue Sprechblase), Main Agent-Antworten linksbundig (dunkle Sprechblase)
- `thinking`-Blocke standardmasig eingeklappt, als Markdown gerendert, zum Aufklappen klicken, um den Denkprozess einzusehen; unterstutzt Ein-Klick-Ubersetzung (Funktion noch nicht stabil)
- Benutzerauswahl-Nachrichten (AskUserQuestion) werden im Frage-Antwort-Format angezeigt
- Bidirektionale Modussynchronisation: Beim Wechsel in den Konversationsmodus wird automatisch zur Konversation der ausgewahlten Anfrage navigiert; beim Zuruckwechseln in den Originalmodus wird automatisch zur ausgewahlten Anfrage navigiert
- Einstellungspanel: Kann den Standard-Einklappzustand von Tool-Ergebnissen und Thinking-Blocken umschalten
- Mobile Konversationsansicht: Im mobilen CLI-Modus konnen Sie auf die Schaltflache "Konversationsansicht" in der oberen Leiste klicken, um eine schreibgeschutzte Konversationsansicht einzublenden und den vollstandigen Konversationsverlauf auf dem Handy zu durchsuchen

### Statistik-Tools

Hover-Panel "Datenstatistik" im Header-Bereich:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- Anzeige von Cache-Erstellungs-/Lesezahlern und Cache-Trefferquote
- Cache-Rebuild-Statistiken: nach Grund gruppiert (TTL, System-/Tools-/Modellanderung, Nachrichtenkurzung/-anderung, Schlusselanderung) mit Anzahl und cache_creation-Token
- Tool-Nutzungsstatistiken: Aufrufhaufigkeit pro Tool, nach Haufigkeit sortiert
- Skill-Nutzungsstatistiken: Aufrufhaufigkeit pro Skill, nach Haufigkeit sortiert
- Unterstutzt Statistiken fur Teammates
- Konzepthilfe (?)-Icons: Klicken zum Anzeigen der integrierten Dokumentation fur MainAgent, CacheRebuild und jedes Tool

### Log-Verwaltung

Uber das CC-Viewer-Dropdown-Menu oben links:
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**Log-Komprimierung**
Zur Log-Thematik mochte der Autor anmerken, dass keine Anderungen an den offiziellen Anthropic-Definitionen vorgenommen wurden, um die Vollstandigkeit der Logs zu gewahrleisten.
Da jedoch einzelne Logs von 1M Opus im spateren Verlauf extrem gross werden konnen, konnte der Autor dank einiger Optimierungen an den MainAgent-Logs die Grosse ohne gzip um mindestens 66% reduzieren.
Die Methode zum Parsen dieser komprimierten Logs lasst sich aus dem aktuellen Repository extrahieren.

### Weitere nutzliche Funktionen

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

Uber die Seitenleiste konnen Sie schnell zu Ihrem Prompt navigieren

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

Der interessante KV-Cache-Text hilft Ihnen zu sehen, was Claude tatsachlich sieht

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

Sie konnen Bilder hochladen und Ihre Anforderungen beschreiben -- Claude hat ein ausgezeichnetes Bildverstandnis. Und wie Sie wissen, konnen Sie Screenshots einfach per Strg+V einfugen; im Dialog wird Ihr vollstandiger Inhalt angezeigt

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

Sie konnen eigene Plugins erstellen, alle CC-Viewer-Prozesse verwalten und CC-Viewer bietet Hot-Switching fur Drittanbieter-Schnittstellen (ja, Sie konnen GLM, Kimi, MiniMax, Qwen, DeepSeek verwenden -- auch wenn der Autor findet, dass sie derzeit noch recht schwach sind)

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

Weitere Funktionen warten darauf, entdeckt zu werden... zum Beispiel: Das System unterstutzt Agent Team und enthalt einen integrierten Code Reviewer. Die Integration des Codex Code Reviewers steht kurz bevor (der Autor empfiehlt sehr, Codex fur Claude Code Reviews einzusetzen)


### Automatische Updates

CC-Viewer pruft beim Start automatisch auf Updates (maximal einmal alle 4 Stunden). Innerhalb derselben Hauptversion (z. B. 1.x.x -> 1.y.z) wird automatisch aktualisiert und beim nachsten Start wirksam. Bei einem Hauptversionswechsel wird nur eine Benachrichtigung angezeigt.

Die automatische Aktualisierung folgt der globalen Claude Code-Konfiguration `~/.claude/settings.json`. Wenn Claude Code die automatischen Updates deaktiviert hat (`autoUpdates: false`), uberspringt CC-Viewer die automatische Aktualisierung ebenfalls.

### Mehrsprachige Unterstutzung

CC-Viewer unterstutzt 18 Sprachen und wechselt automatisch basierend auf der Systemsprache:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
