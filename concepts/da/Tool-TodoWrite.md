# TodoWrite

Skriver en struktureret to-do-liste for den aktuelle session og erstatter den forrige liste. Hvert element bærer sin tekst, en status og en nutid-continuous-form, der vises i fremskridtsindikatorer.

## Hvornår skal den bruges

- En opgave har flere adskilte trin, og sporing af dem hjælper dig (og brugeren) med at se fremskridt.
- Brugeren beder eksplicit om en to-do-liste.
- Du vil markere præcis ét element som i gang, mens resten forbliver afventende eller fuldførte.

## Aktivering

- Legacy-værktøj: deaktiveret som standard i sessioner, der tilbyder opgaveværktøjerne (`TaskCreate`, `TaskUpdate`, `TaskList`).
- Genaktivér det med `CLAUDE_CODE_ENABLE_TASKS=0`.

## Parametre

- `todos` (array, påkrævet): Den komplette, opdaterede to-do-liste. Hver post har:
  - `content` (string): Opgavebeskrivelsen.
  - `status` (string): Én af `pending`, `in_progress`, `completed`.
  - `activeForm` (string): Nutid-continuous-tekst, der vises, mens elementet er i gang (f.eks. "Running tests").

## Eksempler

### Eksempel 1: Spor en ændring i tre trin

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

Hele listen omskrives ved hvert kald — medtag altid alle elementer, ikke kun dem, der ændrede sig.

## Noter

- Listen erstattes fuldstændigt ved hvert kald; for at opdatere ét element skal du genindsende hvert element med den nye status.
- Hold præcis ét element `in_progress` ad gangen.
- I sessioner, hvor de strukturerede opgaveværktøjer (`TaskCreate`/`TaskUpdate`/`TaskList`) er aktiveret, kan rammen tilbyde dem i stedet for `TodoWrite` — foretræk det værktøjssæt, der annonceres.
