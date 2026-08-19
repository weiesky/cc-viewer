# Glob

Abbina i nomi dei file a un pattern glob e restituisce i percorsi ordinati dal più recentemente modificato per primo. Ottimizzato per localizzare rapidamente i file in codebase di qualsiasi dimensione senza chiamare `find` via shell.

## Quando usare

- Enumerare ogni file di una specifica estensione (ad esempio, tutti i file `*.ts` sotto `src`)
- Scoprire file di configurazione o fixture per convenzione di denominazione (`**/jest.config.*`, `**/*.test.tsx`)
- Restringere la superficie di ricerca prima di eseguire un `Grep` mirato
- Verificare se un file esiste già a un pattern noto prima di chiamare `Write`
- Trovare file toccati recentemente affidandosi all'ordinamento per tempo di modifica

## Parametri

- `pattern` (string, obbligatorio): L'espressione glob da abbinare. Supporta `*` per wildcard a segmento singolo, `**` per corrispondenze ricorsive e `{a,b}` per alternative, ad esempio `src/**/*.{ts,tsx}`.
- `path` (string, opzionale): Directory in cui eseguire la ricerca. Deve essere un percorso di directory valido quando fornito. Ometti interamente il campo per cercare nella working directory corrente. Non passare le stringhe `"undefined"` o `"null"`.

## Esempi

### Esempio 1: Ogni file sorgente TypeScript
Chiama `Glob` con `pattern: "src/**/*.ts"`. Il risultato è una lista ordinata per mtime, quindi i file modificati più di recente appaiono per primi, il che è utile per concentrarsi sugli hot spot.

### Esempio 2: Localizzare un candidato di definizione di classe
Quando sospetti che una classe si trovi in un file di cui non conosci il nome, cerca con `pattern: "**/*UserService*"` per restringere i candidati, poi segui con `Read` o `Grep`.

### Esempio 3: Scoperta parallela prima di un compito più grande
In un unico messaggio, emetti più chiamate `Glob` (ad esempio una per `**/*.test.ts` e una per `**/fixtures/**`) così che entrambe vengano eseguite in parallelo e i loro risultati possano essere correlati.

## Note

- I risultati sono ordinati per tempo di modifica del file (più recenti per primi), non alfabeticamente. Ordina a valle se ti serve un ordinamento stabile.
- I pattern sono valutati dal tool, non dalla shell; non devi citarli o farne l'escape come faresti sulla riga di comando.
- Per esplorazione aperta che richiede più cicli di ricerca e ragionamento, delega a un `Agent` con il tipo agente Explore invece di concatenare molte chiamate `Glob`.
- Preferisci `Glob` a invocazioni `Bash` di `find` o `ls` per la scoperta di nomi di file; gestisce i permessi in modo coerente e restituisce output strutturato.
- Quando cerchi contenuti all'interno dei file piuttosto che nomi di file, usa invece `Grep`.
