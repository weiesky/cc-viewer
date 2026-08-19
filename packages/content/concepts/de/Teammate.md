# Teammate

## Definition

Ein Teammate ist ein kollaborativer Agent im Team-Modus von Claude Code Agent. Wenn der Haupt-Agent ein Team mit `TeamCreate` erstellt und Teammates mit dem `Agent`-Tool erzeugt, lauft jeder Teammate als unabhangiger Agent-Prozess mit eigenem Kontextfenster und Toolset und kommuniziert uber `SendMessage` mit den Teammitgliedern.

## Unterschied zu SubAgent

| Merkmal | Teammate | SubAgent |
|---------|----------|----------|
| Lebenszyklus | Bleibt bestehen, kann mehrfach Nachrichten empfangen | Einmalige Aufgabe, wird nach Abschluss zerstort |
| Kommunikation | SendMessage bidirektionale Nachrichten | Eltern->Kind unidirektionaler Aufruf, Ergebnis zuruckgeben |
| Kontext | Unabhangiger vollstandiger Kontext, bleibt uber Runden hinweg erhalten | Isolierter Aufgabenkontext |
| Zusammenarbeit | Teamarbeit, gegenseitige Kommunikation moglich | Hierarchische Struktur, Interaktion nur mit dem ubergeordneten Agent |
| Aufgabentyp | Komplexe mehrstufige Aufgaben | Einzelaufgaben wie Suche, Erkundung |

## Verhalten

- Wird vom Haupt-Agent (Team Lead) uber das `Agent`-Tool erstellt und einem `team_name` zugewiesen
- Teilt die Aufgabenliste uber `TaskList` / `TaskGet` / `TaskUpdate`
- Wechselt nach jeder Ausfuhrungsrunde in den Idle-Zustand und wartet auf neue Nachrichten zur Aktivierung
- Kann uber `shutdown_request` ordnungsgemas beendet werden

## Erlauterung zum Statistik-Panel

Das Teammate-Statistik-Panel zeigt die Anzahl der API-Aufrufe fur jeden Teammate an. Die Spalte `Name` enthalt den Teammate-Namen (z. B. `reviewer-security`, `reviewer-pipeline`), die Spalte `Anzahl` die Gesamtzahl der API-Anfragen dieses Teammates.
