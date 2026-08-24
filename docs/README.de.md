# CC-Viewer

🌐 **Website & Feature-Tour: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — in 18 Sprachen verfügbar.


Ein Vibe-Coding-Toolkit, das aus eigener Entwicklungserfahrung destilliert und auf Claude Code aufgebaut wurde:

1. Fähigkeitsobergrenze erhöhen: Führen Sie /ultraPlan und /ultraReview lokal aus, damit Ihr Projektcode nie vollständig der Cloud von Claude ausgesetzt werden muss;
2. Multi-Plattform-Unterstützung: Ermöglicht mobiles Programmieren (innerhalb des LAN); die Webversion passt sich an verschiedene Szenarien an, lässt sich problemlos in Browser-Erweiterungen und Splitscreen-Ansichten des Betriebssystems einbetten und bietet einen nativen Installer;
3. Vollständige Protokollierung: Bietet umfassende Abfang- und Analysefunktionen für Claude Code-Payloads — ideal für Logging, Debugging, Lernen, Inspiration und Reverse-Engineering;
4. Lern- und Erfahrungsaustausch: Eine Vielzahl von Studienmaterialien und Entwicklungserfahrungen wurden gesammelt (siehe die „?"-Symbole überall im System);
5. Native Erfahrung bewahrt: Erweitert lediglich die Fähigkeiten von Claude Code, ohne wesentliche Änderungen am Kernel — die native Erfahrung bleibt erhalten;
6. Drittanbieter-Modelle unterstützt: Kompatibel mit deepseek-v4-\*, GLM 5.1, Kimi K2.6, mit eingebauter cc-switch-Fähigkeit für jederzeitiges Hot-Switching zwischen Drittanbieter-Tools; der Hot-Switch-Dialog unterstützt außerdem rollenbasierte Quellen — Main Agent, Sub-Agents und Teammates können jeweils ein eigenes Proxy-Profil verwenden (Standard: dem Main Agent folgen); verwendet der Main Agent das eingebaute Default mit dem offiziellen Endpoint, bleibt die Rollenzuweisung verborgen und ruhend.

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | Deutsch | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Verwendung

### Voraussetzungen

* Stellen Sie sicher, dass Node.js 20.0.0+ installiert ist; [Download und Installation](https://nodejs.org)
* Stellen Sie sicher, dass Claude Code installiert ist; [Installationsanleitung](https://github.com/anthropics/claude-code)

### ccv installieren

#### Installation über npm

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### Installation über Homebrew (empfohlen für macOS / Linux)

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # für Updates — verwende NICHT npm install -g für mit brew installiertes ccv
```

#### Installation über pnpm (global)

```bash
pnpm add -g cc-viewer
pnpm add -g cc-viewer@latest   # für Updates — verwende NICHT npm install -g für mit pnpm installiertes ccv
```

### Start

ccv ist ein Drop-in-Ersatz für claude — alle Argumente werden an claude weitergereicht, während der Web-Viewer gestartet wird.

```bash
ccv                    # == claude（interaktiver Modus）
```

Der vom Autor am häufigsten verwendete Befehl ist:

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv reicht alle Startparameter von Claude Code durch — Sie können sie beliebig kombinieren
```

Nach dem Start im Programmiermodus wird automatisch eine Webseite geöffnet.

CC-Viewer wird auch als native Desktop-App ausgeliefert: [Download-Seite](https://github.com/weiesky/cc-viewer/releases)

### SDK-Modus (headless, `ccv -SDK`)

`ccv -SDK` führt die Sitzung über das Agent SDK statt über ein interaktives Terminal aus — kein Terminal-Panel; Nachrichten werden über die Web-UI gesendet, und alles andere (Sitzungsprotokolle, Streaming-Schreibmaschinen-Effekt, Nutzungsstatistiken) funktioniert genauso wie im Terminal-Modus.

```bash
ccv -SDK                # headless-Sitzung; chatten Sie im Browser
ccv -SDK -c             # setzt die letzte Sitzung fort
ccv -SDK --model sonnet # ein Modell auswählen
```

Genehmigungen (Bash/Edit/Write/WebFetch/…) erscheinen im Browser mit erlauben / ablehnen / für die Sitzung erlauben, und `AskUserQuestion`- sowie Plan-Prompts werden als modale Fenster angezeigt. `npm publish` erfordert immer eine ausdrückliche Genehmigung — auch mit `--d`. Erfordert das Paket `@anthropic-ai/claude-agent-sdk` (in cc-viewer enthalten); andernfalls wird auf den Terminal-Modus zurückgegriffen.

### Upgrade auf 1.7.0 (Logformat v2)

Seit 1.7.0 werden Logs im Format eines Verzeichnisses pro Sitzung (wire-format v2) gespeichert statt in einzelnen `.jsonl`-Dateien — etwa 90 % weniger Speicherplatz. Vorhandene v1-`.jsonl`-Dateien werden niemals geändert oder gelöscht; der Log-Dialog listet standardmäßig v2-Sitzungen auf, und ein kleiner Eintrag „Legacy-Logs (v1) anzeigen“ (sichtbar, solange alte Dateien vorhanden sind) öffnet eine v1-Ansicht, in der sie angezeigt, migriert oder gelöscht werden können. Beim Start bietet cc-viewer eine Ein-Klick-Migration an, wenn Legacy-Logs gefunden werden (dringend empfohlen, wenn Sie eine alte Unterhaltung mit `claude -c` fortsetzen, deren erste Hälfte in den alten Dateien liegt). Sie können auch über das Terminal migrieren:

```bash
ccv convert <project>   # ein Projekt migrieren
ccv convert --all       # jedes Projekt migrieren
ccv verify <v1-file>    # eine v1-Datei mit ihren konvertierten Sitzungen abgleichen
```

Besteht eine Sitzung die Golden-Prüfung nicht, wird sie zur Inspektion in `sessions-quarantine/` zurückgehalten, statt die gesamte Migration scheitern zu lassen – die übrigen Sitzungen werden weiterhin migriert.

### Logger-Modus

Wenn Sie weiterhin das native claude-Tool oder die VS Code-Erweiterung bevorzugen, verwenden Sie diesen Modus.

In diesem Modus startet `claude`

automatisch einen Protokollierungsprozess, der Anfrageprotokolle in Verzeichnissen pro Sitzung unter \~/.claude/cc-viewer/*yourproject*/sessions/ (wire-format v2) aufzeichnet.

Logger-Modus starten:

```bash
ccv -logger
```

Wenn die Konsole den spezifischen Port nicht ausgeben kann, ist der erste Standardport 127.0.0.1:7008. Bei mehreren Instanzen werden die Ports fortlaufend vergeben, z. B. 7009, 7010.

Logger-Modus deinstallieren:

```bash
ccv --uninstall
```

### Fehlerbehebung (Troubleshooting)

Falls beim Start Probleme auftreten, gibt es einen ultimativen Fehlerbehebungsansatz:
Schritt 1: Öffnen Sie Claude Code in einem beliebigen Verzeichnis;
Schritt 2: Geben Sie Claude Code die folgende Anweisung:

```
Ich habe das npm-Paket cc-viewer installiert, aber nach Ausführung von ccv funktioniert es immer noch nicht richtig. Überprüfen Sie cli.js und findcc.js von cc-viewer und passen Sie sie basierend auf der spezifischen Umgebung an die lokale Claude Code-Bereitstellung an. Halten Sie den Änderungsumfang so weit wie möglich auf findcc.js begrenzt.
```

Claude Code das Problem selbst diagnostizieren zu lassen, ist effektiver, als jemanden zu fragen oder eine Dokumentation zu lesen!

Nachdem die obige Anweisung abgeschlossen ist, wird findcc.js aktualisiert. Wenn Ihr Projekt häufig lokale Bereitstellung erfordert oder geforkter Code häufig Installationsprobleme lösen muss, behalten Sie diese Datei einfach. Beim nächsten Mal kopieren Sie sie direkt. In diesem Stadium werden viele Projekte und Unternehmen, die Claude Code einsetzen, nicht auf Mac bereitgestellt, sondern in serverseitig gehosteten Umgebungen, daher hat der Autor findcc.js separiert, um das Verfolgen von cc-viewer-Quellcode-Updates in Zukunft zu erleichtern.

Hinweis: Diese Anwendung steht in Konflikt mit claude-code-switch und claude-code-router, da es ein Proxy-Wettbewerbsproblem gibt. Stellen Sie daher sicher, dass Sie claude-code-switch und claude-code-router deaktivieren, wenn Sie cc-viewer verwenden — innerhalb von cc-viewer wird eine Proxy-Hot-Update-Funktion als gleichwertiger Ersatz bereitgestellt.

### Weitere Hilfsbefehle

Siehe:

```bash
ccv -h
```

### Silent-Modus (Silent Mode)

Standardmäßig läuft `ccv` im Silent-Modus, wenn es `claude` umhüllt, hält Ihre Terminal-Ausgabe sauber und konsistent mit der nativen Erfahrung. Alle Protokolle werden im Hintergrund erfasst und können unter `http://localhost:7008` angezeigt werden.

Nach der Konfiguration verwenden Sie den Befehl `claude` wie gewohnt. Besuchen Sie `http://localhost:7008`, um auf die Überwachungsoberfläche zuzugreifen.

## Funktionen

### Programmiermodus

Nach dem Start mit ccv sehen Sie:

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

Sie können Code-Diffs direkt nach der Bearbeitung anzeigen:

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Sie können Dateien und Code zwar manuell öffnen, aber manuelles Programmieren wird nicht empfohlen — das ist Old-School-Coding!

### Mobiles Programmieren

Sie können sogar einen QR-Code scannen, um von Ihrem mobilen Gerät aus zu programmieren:

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

Erfüllen Sie Ihre Vorstellung vom mobilen Programmieren. Es gibt auch einen Plugin-Mechanismus — wenn Sie Anpassungen an Ihre Programmiergewohnheiten benötigen, bleiben Sie auf dem Laufenden für Plugin-Hook-Updates.

### Modellspezifische System-Prompts

Das Modal **System-Prompt bearbeiten** (Hamburger-Menü → System-Prompt bearbeiten) ist in Tabs gegliedert:

* Der Tab **Standard** behält das klassische Verhalten bei: Er schreibt `CC_SYSTEM.md` (Überschreiben) oder `CC_APPEND_SYSTEM.md` (Anhängen) in den aktuellen Arbeitsbereich, injiziert als `--system-prompt-file` / `--append-system-prompt-file` beim nächsten ccv-Start.
* **Modell-Tabs**: Klicken Sie auf **+ Modell hinzufügen**, geben Sie einen Namen wie `opus` oder `Gemini3` ein und wählen Sie einen Geltungsbereich — **Global** (`~/.claude/cc-viewer/system_prompt/`, gilt für jeden Arbeitsbereich) oder **Arbeitsbereich** (`<project>/system_prompt/`). Das Namensfeld bietet Eingabevorschläge aus Ihren lokal konfigurierten Modellen (Hot-Reload-Proxy-Profile und `settings.json`); im gewählten Geltungsbereich bereits hinzugefügte Namen werden ausgeblendet, und beliebige frei eingegebene Namen bleiben weiterhin möglich. Jeder Tab hat einen eigenen Anhängen/Überschreiben-Schalter und eine Markdown-Vorschau.
* Einträge werden als großgeschriebene Dateien gespeichert: `OPUS_SYSTEM.md` (Überschreiben) oder `OPUS_APPEND_SYSTEM.md` (Anhängen). Der Abgleich ist unscharf — ein Teilstring der aus der AKTIVEN Konfiguration aufgelösten Modell-ID (Modell-Zuordnung des aktiven Drittanbieter-Proxy-Profils > Umgebungsvariablen `ANTHROPIC_MODEL`/`CLAUDE_MODEL` beim Start > `model` in `settings.json`; ohne Konfigurationssignal wird kein Eintrag injiziert) ohne Beachtung der Groß-/Kleinschreibung, sodass `opus` unabhängig von der Version auf `claude-opus-4-8[1m]` passt. Ein Arbeitsbereich-Treffer schlägt einen globalen; innerhalb eines Geltungsbereichs gewinnt der längste Name; ein passender Eintrag ersetzt für diesen Start die Standard-Dateien vollständig. Bekannte Einschränkungen: Ein Profilwechsel während der Sitzung wird erst nach Neustart der claude-Sitzung neu abgeglichen; ein per Zusatzargument übergebenes `--model` wird nicht ausgewertet.
* **Integrierte Vorgaben sind standardmäßig aktiv:** das Paket enthält abgestimmte Prompts für `deepseek-v4-pro`, `deepseek-v4-flash`, `GLM-5.2`, `Qwen-3.7-Max`, `kimi-k2.7-code` und `kimi-k3` — wenn das aufgelöste Modell einem davon entspricht und kein eigener Eintrag passt, wird der integrierte Prompt automatisch injiziert (Ihre eigenen Dateien gewinnen immer: Arbeitsbereich > Global > integriert). Integrierte Tabs tragen im Modal das Badge **Integriert**: Bearbeiten und Speichern erzeugt Ihren Überschreibungs-Eintrag, oder nutzen Sie das × des Tabs, um eine integrierte Vorgabe zu **deaktivieren** (festgehalten in `<scope>/system_prompt/.builtin-disabled.json`). Eine deaktivierte integrierte Vorgabe fällt auf die Standard-Dateien zurück; der Kopfzeilen-Eintrag bleibt sichtbar und mit „Deaktiviert“ markiert, damit Sie ihn jederzeit wieder aktivieren können.
* Wird ein Tab leer gespeichert, wird der Eintrag gelöscht. Modellwechsel während einer Sitzung greifen beim nächsten Neustart. Setzen Sie `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1`, um jede automatische Injektion zu deaktivieren. Sie können `<project>/system_prompt/` committen, um Prompts mit Ihrem Team zu teilen, oder es zu `.gitignore` hinzufügen, um sie privat zu halten.

### Logger-Modus (Vollständige Claude Code-Sitzungen anzeigen)

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* Erfasst alle API-Anfragen von Claude Code in Echtzeit und stellt Rohtext sicher — keine redigierten Protokolle (das ist wichtig!!!)
* Identifiziert und kennzeichnet automatisch Main Agent- und Sub Agent-Anfragen (Untertypen: Plan, Search, Bash)
* MainAgent-Anfragen unterstützen Body Diff JSON und zeigen eingeklappte Unterschiede zur vorherigen MainAgent-Anfrage (nur geänderte/neue Felder)
* Jede Anfrage zeigt Inline-Token-Nutzungsstatistiken an (Input/Output-Tokens, Cache-Erstellung/-Lesung, Trefferquote)
* Kompatibel mit Claude Code Router (CCR) und anderen Proxy-Szenarien — fällt auf API-Pfadmusterabgleich zurück

<a href="https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&theme=dark&legend=top-left" />

    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left" />

    ![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left)
  </picture>
</a>

## Lizenz

MIT
