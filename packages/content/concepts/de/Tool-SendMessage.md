# SendMessage

Liefert eine Nachricht von einem Teammitglied an ein anderes innerhalb eines aktiven Teams, oder sendet eine Rundnachricht an alle Teammitglieder gleichzeitig. Dies ist der einzige Kanal, den Teammitglieder hören können – alles, was in normale Textausgabe geschrieben wird, ist für sie unsichtbar.

## Wann verwenden

- Zuweisen einer Aufgabe oder Übergeben eines Teilproblems an ein namentlich bekanntes Teammitglied während der Team-Zusammenarbeit.
- Anfragen nach Status, Zwischenergebnissen oder einer Code-Review von einem anderen Agenten.
- Rundsenden einer Entscheidung, gemeinsamen Einschränkung oder Shutdown-Ankündigung an das gesamte Team per `*`.
- Antworten auf einen Protokoll-Prompt wie eine Shutdown-Anfrage oder eine Plan-Genehmigungsanfrage des Teamleiters.
- Abschließen einer delegierten Aufgabe am Ende, damit der Leiter den Punkt als erledigt markieren kann.

## Aktivierung

- Unterliegt denselben Bedingungen für sitzungsübergreifendes Messaging wie `ListAgents` (serverseitige Feature-Flags, standardmäßig deaktiviert).
- Teammitglieder erfordern zusätzlich, dass experimentelle Agenten-Teams aktiviert sind.

## Parameter

- `to` (string, erforderlich): Der `name` des Zielteammitglieds, wie im Team registriert, oder `*` für eine Rundnachricht an alle Teammitglieder.
- `message` (string oder object, erforderlich): Klartext für normale Kommunikation, oder ein strukturiertes Objekt für Protokoll-Antworten wie `shutdown_response` und `plan_approval_response`.
- `summary` (string, optional): Eine 5–10 Wörter lange Vorschau, die im Team-Aktivitätsprotokoll für Klartextnachrichten angezeigt wird. Erforderlich für lange String-Nachrichten; wird ignoriert, wenn `message` ein Protokoll-Objekt ist.

## Beispiele

### Beispiel 1: Direkte Aufgabenübergabe

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### Beispiel 2: Eine gemeinsame Einschränkung rundsenden

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### Beispiel 3: Protokollantwort

Auf eine Shutdown-Anfrage des Leiters mit einer strukturierten Nachricht antworten:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### Beispiel 4: Plan-Genehmigungsantwort

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## Hinweise

- Ihre reguläre Assistenten-Textausgabe wird NICHT an Teammitglieder übertragen. Wenn ein anderer Agent etwas sehen soll, muss es durch `SendMessage` laufen. Dies ist der häufigste Fehler in Team-Workflows.
- Rundnachricht (`to: "*"`) ist teuer – sie weckt jedes Teammitglied und verbraucht dessen Kontext. Reservieren Sie sie für Ankündigungen, die wirklich alle betreffen. Bevorzugen Sie gezielte Sendungen.
- Halten Sie Nachrichten prägnant und handlungsorientiert. Fügen Sie Dateipfade, Einschränkungen und das erwartete Antwortformat ein, das der Empfänger benötigt; denken Sie daran, dass er keinen gemeinsamen Speicher mit Ihnen hat.
- Protokoll-Nachrichtenobjekte (`shutdown_response`, `plan_approval_response`) haben feste Formen. Mischen Sie keine Protokollfelder in Klartextnachrichten und umgekehrt.
- Nachrichten sind asynchron. Der Empfänger erhält Ihre in seinem nächsten Turn; gehen Sie nicht davon aus, dass er sie gelesen oder darauf reagiert hat, bis er antwortet.
- Eine gut geschriebene `summary` macht das Team-Aktivitätsprotokoll für den Leiter überfliegbar – behandeln Sie sie wie eine Commit-Betreffzeile.
