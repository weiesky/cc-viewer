# ListSkills

Listet die aktivierten claude.ai-Skills des Benutzers auf, optional per Stichwort gefiltert.

## Wann verwenden

- Sie benötigen die maßgebliche Liste der derzeit aktivierten Skills – bevor Sie einen aufrufen oder um zu bestätigen, was eine `SuggestSkills`-Karte hinzugefügt hat.
- Der Benutzer fragt, welche Skills er hat.

## Aktivierung

- Erfordert die Berechtigung für den Plugin-Registry-Zugriff.
- In HIPAA-Umgebungen deaktiviert.
- In Remote-Sitzungen immer verfügbar.

## Parameter

- `keywords` (array of strings, optional): Filtert die Liste – bis zu 8 Elemente, jedes 1–64 Zeichen. Weglassen, um alles aufzulisten.

## Beispiele

### Beispiel 1: Aktivierte Skills auflisten

```
ListSkills()
```

### Beispiel 2: Nach Stichwort filtern

```
ListSkills(keywords=["review"])
```

## Hinweise

- Wenn der Katalog nicht erreichbar ist (verboten), stuft das Tool auf eine leere Liste mit einer Warnung herab, statt fehlzuschlagen.
- Dies listet *aktivierte* Skills auf; verwenden Sie `SuggestSkills`, um Skills in den Vordergrund zu rücken, die der Benutzer hinzufügen könnte.
