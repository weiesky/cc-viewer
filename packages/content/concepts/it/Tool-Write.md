# Write

Crea un nuovo file o sostituisce completamente i contenuti di uno esistente sul filesystem locale. Poiché sostituisce tutto al percorso target, dovrebbe essere riservato a creazione autentica o riscritture complete intenzionali.

## Quando usare

- Creare un nuovo file sorgente, test o configurazione che non esiste ancora
- Generare una nuova fixture, snapshot o file di dati da zero
- Eseguire una riscrittura completa dove un `Edit` incrementale sarebbe più complesso che ricominciare
- Emettere un artefatto richiesto come uno schema, migrazione o script di build che l'utente ti ha esplicitamente chiesto di produrre

## Parametri

- `file_path` (string, obbligatorio): Percorso assoluto del file da scrivere. Qualsiasi directory genitore deve esistere già.
- `content` (string, obbligatorio): Il testo completo da scrivere nel file. Diventa l'intero corpo del file.

## Esempi

### Esempio 1: Creare un nuovo modulo helper
Chiama `Write` con `file_path: "/Users/me/app/src/utils/slugify.ts"` e fornisci l'implementazione come `content`. Usa questo solo dopo aver verificato che il file non esista già.

### Esempio 2: Rigenerare un artefatto derivato
Dopo che il sorgente dello schema cambia, riscrivi `/Users/me/app/generated/schema.json` in una chiamata `Write` usando il JSON appena generato come `content`.

### Esempio 3: Sostituire un piccolo file di fixture
Per una fixture di test usa e getta dove ogni riga cambia, `Write` può essere più chiaro di una sequenza di chiamate `Edit`. Leggi prima il file, conferma lo scope, poi sovrascrivi.

## Note

- Prima di sovrascrivere un file esistente, devi chiamare `Read` su di esso nella sessione corrente. `Write` si rifiuta di cancellare contenuto non visto.
- Preferisci `Edit` per qualsiasi modifica che tocchi solo parte di un file. `Edit` invia solo il diff, che è più veloce, più sicuro e più facile da revisionare.
- Non creare proattivamente documentazione Markdown, file `README.md` o changelog a meno che l'utente non li richieda esplicitamente.
- Non aggiungere emoji, testo promozionale o banner decorativi a meno che l'utente non richieda quello stile.
- Verifica prima che la directory genitore esista con una chiamata `Bash` `ls`; `Write` non crea cartelle intermedie.
- Fornisci il contenuto esattamente come vuoi che venga persistito; non c'è templating o post-processing.
