# EnterPlanMode

Versetzt die Sitzung in den Planmodus, eine Nur-Lese-Explorationsphase, in der der Assistent den Codebase untersucht und einen konkreten Implementierungsplan entwirft, den der Benutzer freigeben muss, bevor Dateien geändert werden.

## Wann verwenden

- Der Benutzer fordert eine nicht triviale Änderung, die mehrere Dateien oder Subsysteme umfasst.
- Die Anforderungen sind mehrdeutig und der Assistent muss Code lesen, bevor er sich auf einen Ansatz festlegt.
- Ein Refactoring, eine Migration oder ein Abhängigkeits-Upgrade wird vorgeschlagen und der Wirkungsradius ist unklar.
- Der Benutzer sagt ausdrücklich "plan dies", "lass uns erst planen" oder bittet um eine Design-Review.
- Das Risiko ist hoch genug, dass ein direktes Bearbeiten Arbeit verschwenden oder den Zustand beschädigen könnte.

## Parameter

Keine. `EnterPlanMode` nimmt keine Argumente entgegen – rufen Sie es mit einem leeren Parameterobjekt auf.

## Beispiele

### Beispiel 1: Große Feature-Anfrage

Der Benutzer fragt: "SSO über Okta zum Admin-Panel hinzufügen." Der Assistent ruft `EnterPlanMode` auf und verbringt dann mehrere Turns mit dem Lesen von Auth-Middleware, Session-Speicher, Route-Guards und der bestehenden Login-UI. Er schreibt einen Plan, der die erforderlichen Änderungen, Migrationsschritte und Testabdeckung beschreibt, und reicht ihn über `ExitPlanMode` zur Freigabe ein.

### Beispiel 2: Riskantes Refactoring

Der Benutzer sagt: "Konvertiere die REST-Controller zu tRPC." Der Assistent betritt den Planmodus, untersucht jeden Controller, katalogisiert den öffentlichen Vertrag, listet Rollout-Phasen (Shim, Dual-Read, Cutover) auf und schlägt einen Sequenzplan vor, bevor irgendeine Datei angefasst wird.

## Hinweise

- Der Planmodus ist vertraglich schreibgeschützt. Während er aktiv ist, darf der Assistent weder `Edit`, `Write`, `NotebookEdit` noch irgendeinen verändernden Shell-Befehl ausführen. Nur `Read`, `Grep`, `Glob` und nicht-destruktive `Bash`-Befehle verwenden.
- Planmodus nicht für triviale Einzeiler-Edits, reine Recherchefragen oder Aufgaben einsetzen, bei denen der Benutzer die Änderung bereits vollständig detailliert hat. Der Overhead schadet dort mehr, als er nützt.
- Im Auto-Modus wird der Planmodus abgeraten, sofern der Benutzer ihn nicht ausdrücklich anfordert – Auto-Modus bevorzugt Aktion vor vorgelagerter Planung.
- Planmodus einsetzen, um Kurskorrekturen bei aufwendiger Arbeit zu reduzieren. Ein fünfminütiger Plan spart oft eine Stunde fehlgeleiteter Edits.
- Einmal im Planmodus die Untersuchung auf die Teile des Systems fokussieren, die sich tatsächlich ändern werden. Erschöpfende Rundgänge durch das Repository vermeiden, die mit der aktuellen Aufgabe nichts zu tun haben.
- Der Plan selbst muss an dem vom Harness erwarteten Pfad auf die Festplatte geschrieben werden, damit `ExitPlanMode` ihn einreichen kann. Der Plan muss konkrete Dateipfade, Funktionsnamen und Verifikationsschritte enthalten, nicht vage Absichten.
- Der Benutzer kann den Plan ablehnen und Überarbeitungen anfordern. Im Planmodus iterieren, bis der Plan akzeptiert wird; erst dann verlassen.
