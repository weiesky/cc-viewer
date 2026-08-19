# SubAgent: Search

## Zweck

Der Search-Subagent ist ein leichtgewichtiger, schreibgeschützter Explorations-Agent. Entsenden Sie ihn, wenn Sie einen Codebase verstehen müssen – herauszufinden, wo etwas lebt, zu lernen, wie Komponenten zusammenpassen, oder strukturelle Fragen zu beantworten – ohne Dateien zu ändern. Er ist für viele kleine Lesevorgänge über viele Dateien optimiert und liefert eine prägnante Zusammenfassung statt rohe Suchausgabe.

Search ist kein Universal-Assistent. Er kann keinen Code bearbeiten, keine Builds ausführen, keine Änderungen committen oder Netzwerkverbindungen über schreibgeschützte Abrufe hinaus öffnen. Sein Wert liegt darin, dass er ein großes Explorationsbudget parallel verbrennen kann, ohne den Kontext des Hauptagenten zu verbrauchen, und dann eine kompakte Antwort zurückgibt.

## Wann verwenden

- Sie müssen eine Frage beantworten, die drei oder mehr distinkte Suchen oder Lesevorgänge erfordert. Beispiel: "Wie ist die Authentifizierung vom Login-Route bis zum Session-Store verdrahtet?"
- Das Ziel ist unbekannt – Sie wissen noch nicht, welche Datei, welches Modul oder Symbol zu betrachten ist.
- Sie brauchen eine strukturelle Übersicht über einen unbekannten Bereich des Repos, bevor Sie Änderungen vornehmen.
- Sie möchten mehrere Kandidaten gegenprüfen (zum Beispiel, welcher von mehreren ähnlich benannten Helpern tatsächlich in der Produktion aufgerufen wird).
- Sie benötigen eine literaturartige Zusammenfassung: "liste jede Stelle auf, die X importiert, und kategorisiere nach Aufrufort."

Nicht verwenden bei:

- Sie kennen bereits die exakte Datei und Zeile. Rufen Sie `Read` direkt auf.
- Ein einzelnes `Grep` oder `Glob` beantwortet die Frage. Führen Sie es direkt aus; das Entsenden eines Subagenten erhöht den Overhead.
- Die Aufgabe erfordert Bearbeitung, Ausführung von Befehlen oder irgendeinen Seiteneffekt. Search ist konstruktionsbedingt schreibgeschützt.
- Sie benötigen exakte wörtliche Ausgabe eines Tool-Aufrufs. Subagenten fassen zusammen; sie proxieren keine Rohergebnisse.

## Gründlichkeitsstufen

Wählen Sie die Stufe, die dem Einsatz der Frage entspricht.

- `quick` – ein paar gezielte Suchen, Best-Effort-Antwort. Verwenden, wenn Sie einen schnellen Hinweis brauchen (zum Beispiel "wo ist die env-var-Parsing-Logik?") und mit Iterieren einverstanden sind, falls die Antwort unvollständig ist.
- `medium` – der Standard. Mehrere Suchrunden, Gegenchecken von Kandidaten und vollständiges Lesen der relevantesten Dateien. Verwenden für typische "hilf mir diesen Bereich verstehen"-Fragen.
- `very thorough` – erschöpfende Exploration. Der Subagent verfolgt jede plausible Spur, liest umgebenden Kontext und überprüft Befunde doppelt, bevor er zusammenfasst. Verwenden, wenn Korrektheit zählt (zum Beispiel Sicherheits-Review, Migrationsplanung) oder eine unvollständige Antwort Nacharbeit verursacht.

Höhere Gründlichkeit kostet mehr Zeit und Token innerhalb des Subagenten, aber diese Token bleiben im Subagenten – nur die endgültige Zusammenfassung kehrt zum Hauptagenten zurück.

## Verfügbare Tools

Search hat Zugriff auf alle schreibgeschützten Tools, die der Hauptagent verwendet, und nichts anderes:

- `Read` – zum Lesen bestimmter Dateien, einschließlich Teilbereiche.
- `Grep` – für Inhaltssuchen über den Baum.
- `Glob` – zum Auffinden von Dateien nach Namensmuster.
- `Bash` im schreibgeschützten Modus – für Befehle, die Zustand inspizieren, ohne ihn zu mutieren (zum Beispiel `git log`, `git show`, `ls`, `wc`).
- `WebFetch` und `WebSearch` – zum Lesen externer Dokumentation, wenn dieser Kontext erforderlich ist.

Edit-Tools (`Write`, `Edit`, `NotebookEdit`), Shell-Befehle, die Zustand verändern, und Task-Graph-Tools (`TaskCreate`, `TaskUpdate` usw.) sind bewusst nicht verfügbar.

## Hinweise

- Geben Sie dem Search-Subagenten eine konkrete Frage, kein Thema. "Liste jeden Aufrufer von `renderMessage` und vermerke, welche ein benutzerdefiniertes Theme übergeben" gibt eine nützliche Antwort zurück; "erzähl mir über Rendering" nicht.
- Der Subagent gibt eine Zusammenfassung zurück. Wenn Sie exakte Dateipfade benötigen, fordern Sie sie ausdrücklich im Prompt an.
- Mehrere unabhängige Fragen werden am besten als parallele Search-Subagenten entsandt statt als ein langer Prompt, damit sich jeder fokussieren kann.
- Da Search nicht bearbeiten kann, koppeln Sie ihn mit einem Folge-Edit-Schritt im Hauptagenten, sobald Sie wissen, was geändert werden soll.
- Behandeln Sie die Ausgabe von Search als Evidenz, nicht als Grundwahrheit. Für alles Tragende öffnen Sie die zitierten Dateien selbst, bevor Sie handeln.
