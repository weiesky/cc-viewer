# TaskCreate

Crea un nuovo task nella lista dei task del team corrente (o nella lista dei task della sessione quando nessun team è attivo). Usalo per catturare voci di lavoro che dovrebbero essere tracciate, delegate o riconsiderate in seguito.

## Quando usare

- L'utente descrive un pezzo di lavoro a più passi che beneficia di un tracciamento esplicito.
- Stai scomponendo una richiesta grande in unità più piccole, separatamente completabili.
- Un follow-up viene scoperto durante un compito e non dovrebbe essere dimenticato.
- Hai bisogno di un record duraturo di intento prima di passare il lavoro a un teammate o subagente.
- Stai operando in plan mode e vuoi che ogni passo del piano sia rappresentato come un task concreto.

Salta `TaskCreate` per azioni banali one-shot, pura conversazione o qualsiasi cosa completabile in due o tre chiamate tool dirette.

## Attivazione

- Disponibile per default sulla maggior parte dei modelli.
- Non disponibile su Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 e famiglie successive (v2.1.233+), salvo opt-in tramite `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` o `--tools`.
- L'intero sistema dei task è disabilitato quando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametri

- `subject` (string, obbligatorio): Titolo imperativo breve, ad esempio `Fix login redirect on Safari`. Mantienilo sotto circa ottanta caratteri.
- `description` (string, obbligatorio): Contesto dettagliato — il problema, i vincoli, i criteri di accettazione e qualsiasi file o link di cui un futuro lettore avrà bisogno. Scrivi come se un teammate lo raccogliesse a freddo.
- `activeForm` (string, opzionale): Testo spinner al presente continuo mostrato mentre il task è `in_progress`, ad esempio `Fixing login redirect on Safari`. Rispecchia il `subject` ma in forma -ing.
- `metadata` (object, opzionale): Dati strutturati arbitrari allegati al task. Usi comuni: etichette, suggerimenti di priorità, ID di ticket esterni o configurazione specifica dell'agente.

I task appena creati iniziano sempre con stato `pending` e senza proprietario. Le dipendenze (`blocks`, `blockedBy`) non sono impostate al momento della creazione — applicale successivamente con `TaskUpdate`.

## Esempi

### Esempio 1

Cattura una segnalazione bug che l'utente ha appena presentato.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### Esempio 2

Dividi un epic in unità tracciate all'inizio di una sessione.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## Note

- Scrivi il `subject` in voce imperativa e l'`activeForm` al presente continuo così che l'UI si legga naturalmente quando il task transita a `in_progress`.
- Chiama `TaskList` prima di creare per evitare duplicati — la lista del team è condivisa con teammate e subagenti.
- Non includere segreti o credenziali in `description` o `metadata`; i record dei task sono visibili a chiunque abbia accesso al team.
- Dopo la creazione, muovi il task attraverso il suo ciclo di vita con `TaskUpdate`. Non lasciare il lavoro silenziosamente abbandonato in `in_progress`.
