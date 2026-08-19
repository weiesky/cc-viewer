# TodoWrite

Scrive una lista todo strutturata per la sessione corrente, sostituendo la lista precedente. Ogni voce contiene il suo testo, uno stato e una forma al presente continuo mostrata negli indicatori di progresso.

## Quando usare

- Un compito ha diversi passi distinti e tracciarli aiuta te (e l'utente) a vedere il progresso.
- L'utente chiede esplicitamente una lista todo.
- Vuoi marcare esattamente una voce come in corso mentre le altre restano in attesa o completate.

## Attivazione

- Strumento legacy: disabilitato per default nelle sessioni che offrono gli strumenti Task (`TaskCreate`, `TaskUpdate`, `TaskList`).
- Riabilitalo con `CLAUDE_CODE_ENABLE_TASKS=0`.

## Parametri

- `todos` (array, obbligatorio): La lista todo completa aggiornata. Ogni voce contiene:
  - `content` (string): La descrizione del compito.
  - `status` (string): Uno tra `pending`, `in_progress`, `completed`.
  - `activeForm` (string): Testo al presente continuo mostrato mentre la voce è in corso (ad esempio "Running tests").

## Esempi

### Esempio 1: Tracciare una modifica in tre passi

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

L'intera lista viene riscritta a ogni chiamata — includi sempre tutte le voci, non solo quelle che sono cambiate.

## Note

- La lista viene sostituita integralmente a ogni chiamata; per aggiornare una voce, reinvia ogni voce con il nuovo stato.
- Mantieni esattamente una voce `in_progress` alla volta.
- Nelle sessioni in cui gli strumenti di task strutturati (`TaskCreate`/`TaskUpdate`/`TaskList`) sono abilitati, l'harness può offrire quelli al posto di `TodoWrite` — preferisci qualunque set di strumenti sia pubblicizzato.
