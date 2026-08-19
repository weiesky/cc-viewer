# Skill

Ruft einen benannten Skill innerhalb der aktuellen Unterhaltung auf. Skills sind vorgefertigte Fähigkeitsbündel – Fachwissen, Workflows und mitunter Tool-Zugriff –, die der Harness dem Assistenten über System-Erinnerungen freigibt.

## Wann verwenden

- Der Benutzer tippt einen Slash-Befehl wie `/review` oder `/init` – Slash-Befehle sind Skills und müssen über dieses Tool ausgeführt werden.
- Der Benutzer beschreibt eine Aufgabe, die den angekündigten Auslösebedingungen eines Skills entspricht (zum Beispiel passt die Bitte, Transkripte nach wiederholten Berechtigungsaufforderungen zu scannen, zu `fewer-permission-prompts`).
- Der angegebene Zweck eines Skills passt direkt zur aktuellen Datei, Anfrage oder zum Unterhaltungskontext.
- Spezialisierte, wiederholbare Workflows sind als Skills verfügbar und das kanonische Verfahren ist einem improvisierten Ansatz vorzuziehen.
- Der Benutzer fragt "welche Skills sind verfügbar" – die angekündigten Namen auflisten und erst aufrufen, wenn er bestätigt.

## Parameter

- `skill` (string, erforderlich): Der exakte Name eines Skills, der in der aktuellen System-Erinnerung zu verfügbaren Skills aufgeführt ist. Für Plugin-namensräumliche Skills die voll qualifizierte `plugin:skill`-Form verwenden (zum Beispiel `skill-creator:skill-creator`). Keinen führenden Slash einschließen.
- `args` (string, optional): Freiformargumente, die an den Skill übergeben werden. Format und Semantik werden von der Dokumentation des jeweiligen Skills definiert.

## Beispiele

### Beispiel 1: Einen Review-Skill auf dem aktuellen Branch ausführen

```
Skill(skill="review")
```

Der `review`-Skill bündelt die Schritte für die Überprüfung eines Pull Requests gegen den aktuellen Base-Branch. Der Aufruf lädt die vom Harness definierte Review-Prozedur in den Turn.

### Beispiel 2: Einen Plugin-namensräumlichen Skill mit Argumenten aufrufen

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Leitet die Anfrage über den Einstiegspunkt des `skill-creator`-Plugins, sodass der Autoren-Workflow anläuft.

## Hinweise

- Rufen Sie nur Skills auf, deren Namen wörtlich in der System-Erinnerung zu verfügbaren Skills erscheinen, oder Skills, die der Benutzer direkt als `/name` in seiner Nachricht getippt hat. Erraten oder erfinden Sie niemals Skill-Namen aus Erinnerung oder Trainingsdaten – wenn der Skill nicht angekündigt ist, rufen Sie dieses Tool nicht auf.
- Wenn die Anfrage eines Benutzers zu einem angekündigten Skill passt, ist der Aufruf von `Skill` eine blockierende Voraussetzung: Rufen Sie ihn auf, bevor Sie irgendeine andere Antwort zur Aufgabe generieren. Beschreiben Sie nicht, was der Skill tun würde – führen Sie ihn aus.
- Erwähnen Sie niemals einen Skill namentlich, ohne ihn tatsächlich aufzurufen. Einen Skill anzukündigen, ohne das Tool aufzurufen, ist irreführend.
- Verwenden Sie `Skill` nicht für eingebaute CLI-Befehle wie `/help`, `/clear`, `/model` oder `/exit`. Diese werden direkt vom Harness behandelt.
- Rufen Sie einen Skill nicht erneut auf, der bereits im aktuellen Turn läuft. Wenn Sie ein `<command-name>`-Tag im aktuellen Turn sehen, wurde der Skill bereits geladen – folgen Sie seinen Anweisungen direkt, statt das Tool erneut aufzurufen.
- Wenn mehrere Skills in Frage kommen, wählen Sie den spezifischsten. Für Konfigurationsänderungen wie das Hinzufügen von Berechtigungen oder Hooks bevorzugen Sie `update-config` gegenüber einem generischen Einstellungsansatz.
- Die Skill-Ausführung kann für den Rest des Turns neue System-Erinnerungen, Tools oder Einschränkungen einführen. Lesen Sie den Unterhaltungszustand nach Abschluss eines Skills erneut, bevor Sie fortfahren.
