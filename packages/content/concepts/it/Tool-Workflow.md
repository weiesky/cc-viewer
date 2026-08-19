# Workflow

Esegue uno script che orchestra molti subagenti in modo deterministico — fan-out, pipeline, loop e verifica — per lavoro troppo ampio, troppo incerto o troppo grande per un singolo contesto.

## Quando usare

- Scomporre un compito grande e coprirlo in parallelo su molti agenti
- Verificare i risultati con una verifica indipendente o avversaria prima di farli propri
- Affrontare una scala che un singolo contesto non può contenere: migrazioni, audit, ampie scansioni multi-file

## Come funziona

- Viene eseguito in background; ricevi una notifica al termine. Osserva il progresso in tempo reale con `/workflows`.
- Lo script coordina gli agenti con `agent()`, `parallel()`, `pipeline()` e `phase()`.
- `pipeline()` fa scorrere ogni elemento attraverso gli stadi senza barriera (default); `parallel()` è una barriera che attende tutti i risultati.
- Con uno schema, ogni `agent()` restituisce dati strutturati validati anziché testo libero.

## Note

- Viene eseguito solo quando l'utente sceglie esplicitamente l'orchestrazione multi-agente; può generare molti agenti e consumare un numero significativo di token.
- La concorrenza è limitata per ciascun workflow; gli agenti in eccesso si accodano e vengono eseguiti man mano che si liberano slot.
- Per un singolo subagente, usa invece il tool `Agent` — riserva Workflow per un vero fan-out.

## Concetti correlati

- Si basa sul tool `Agent`, eseguendo molti agenti sotto un flusso di controllo deterministico.
