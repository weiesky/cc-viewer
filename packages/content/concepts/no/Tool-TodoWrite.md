# TodoWrite

Skriver en strukturert todo-liste for gjeldende sesjon, og erstatter den forrige listen. Hvert element bærer sin tekst, en status og en presens partisipp-form vist i fremdriftsindikatorer.

## Når skal den brukes

- En oppgave har flere adskilte trinn, og sporing av dem hjelper deg (og brukeren) å se fremdrift.
- Brukeren ber eksplisitt om en todo-liste.
- Du vil merke nøyaktig ett element som in progress mens resten forblir pending eller completed.

## Aktivering

- Legacy-verktøy: deaktivert som standard i sesjoner som tilbyr oppgaveverktøyene (`TaskCreate`, `TaskUpdate`, `TaskList`).
- Aktiver det på nytt med `CLAUDE_CODE_ENABLE_TASKS=0`.

## Parametere

- `todos` (array, påkrevd): Den komplette oppdaterte todo-listen. Hver oppføring har:
  - `content` (string): Oppgavebeskrivelsen.
  - `status` (string): Én av `pending`, `in_progress`, `completed`.
  - `activeForm` (string): Presens partisipp-tekst vist mens elementet er in progress (f.eks. "Running tests").

## Eksempler

### Eksempel 1: Spor en endring i tre trinn

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

Hele listen skrives om ved hvert kall — inkluder alltid alle elementer, ikke bare de som endret seg.

## Notater

- Listen erstattes i sin helhet ved hvert kall; for å oppdatere ett element, send inn hvert element på nytt med den nye statusen.
- Hold nøyaktig ett element `in_progress` om gangen.
- I sesjoner der de strukturerte oppgaveverktøyene (`TaskCreate`/`TaskUpdate`/`TaskList`) er aktivert, kan rammeverket tilby disse i stedet for `TodoWrite` — foretrekk det verktøysettet som annonseres.
