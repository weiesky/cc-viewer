# ListSkills

Lister brugerens aktiverede claude.ai-skills, eventuelt filtreret efter nøgleord.

## Hvornår skal den bruges

- Du har brug for den autoritative liste over skills, der i øjeblikket er aktiveret — før du invokerer én, eller for at bekræfte, hvad et `SuggestSkills`-kort tilføjede.
- Brugeren spørger, hvilke skills de har.

## Parametre

- `keywords` (array af strings, valgfri): Filtrer listen — op til 8 elementer, hver 1-64 tegn. Udelad for at liste alt.

## Eksempler

### Eksempel 1: List aktiverede skills

```
ListSkills()
```

### Eksempel 2: Filtrer efter nøgleord

```
ListSkills(keywords=["review"])
```

## Noter

- Hvis kataloget er uopnåeligt (forbudt), nedgraderer værktøjet til en tom liste med en advarsel i stedet for at fejle.
- Dette lister *aktiverede* skills; brug `SuggestSkills` til at vise skills frem, som brugeren kunne tilføje.
