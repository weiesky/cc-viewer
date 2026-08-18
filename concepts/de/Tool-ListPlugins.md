# ListPlugins

Listet die aktivierten claude.ai-Plugins des Benutzers auf, optional per Stichwort gefiltert.

## Wann verwenden

- Sie müssen wissen, welche Plugins bereits aktiviert sind – zum Beispiel, um zu bestätigen, was nach einer `SuggestPluginInstall`-Karte installiert wurde.
- Der Benutzer fragt, welche Plugins er hat.

## Aktivierung

- Erfordert die Berechtigung für den Plugin-Registry-Zugriff.
- Die Verfügbarkeit hängt vom Sitzungstyp und Feature-Rollout ab – in HIPAA-Umgebungen deaktiviert, in Remote-Sitzungen immer verfügbar.

## Parameter

- `keywords` (array of strings, optional): Filtert die Liste – bis zu 8 Elemente, jedes 1–64 Zeichen. Weglassen, um alles aufzulisten.

## Beispiele

### Beispiel 1: Aktivierte Plugins auflisten

```
ListPlugins()
```

### Beispiel 2: Nach Stichwort filtern

```
ListPlugins(keywords=["figma"])
```

## Hinweise

- Wenn der Plugin-Katalog nicht erreichbar ist (verboten), stuft das Tool auf eine leere Liste mit einer Warnung herab, statt fehlzuschlagen.