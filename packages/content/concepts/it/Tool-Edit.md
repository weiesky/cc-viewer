# Edit

Esegue una sostituzione esatta di stringa all'interno di un file esistente. È il modo preferito per modificare i file perché viene trasmesso solo il diff, mantenendo le modifiche precise e verificabili.

## Quando usare

- Correggere un bug in una singola funzione senza riscrivere il file circostante
- Aggiornare un valore di configurazione, una stringa di versione o un percorso di import
- Rinominare un simbolo all'interno di un file con `replace_all`
- Inserire un blocco vicino a un'àncora (espandi `old_string` per includere contesto circostante, poi fornisci la sostituzione)
- Applicare piccole modifiche ben delimitate come parte di un refactor a più passi

## Parametri

- `file_path` (string, obbligatorio): Percorso assoluto del file da modificare.
- `old_string` (string, obbligatorio): Il testo esatto da cercare. Deve corrispondere carattere per carattere, inclusi spaziatura e indentazione.
- `new_string` (string, obbligatorio): Il testo di sostituzione. Deve differire da `old_string`.
- `replace_all` (boolean, opzionale): Quando `true`, sostituisce ogni occorrenza di `old_string`. Default `false`, che richiede che la corrispondenza sia unica.

## Esempi

### Esempio 1: Correggere un singolo call site
Imposta `old_string` sulla riga esatta `const port = 3000;` e `new_string` su `const port = process.env.PORT ?? 3000;`. La corrispondenza è unica quindi `replace_all` può restare al default.

### Esempio 2: Rinominare un simbolo all'interno di un file
Per rinominare `getUser` in `fetchUser` ovunque in `api.ts`, imposta `old_string: "getUser"`, `new_string: "fetchUser"` e `replace_all: true`.

### Esempio 3: Disambiguare uno snippet ripetuto
Se `return null;` appare in diversi rami, allarga `old_string` per includere contesto circostante (ad esempio la riga `if` precedente) così che la corrispondenza sia unica. Altrimenti il tool darà errore piuttosto che indovinare.

## Note

- Devi chiamare `Read` sul file almeno una volta nella sessione corrente prima che `Edit` accetti modifiche. I prefissi numerici di riga dell'output di `Read` non fanno parte del contenuto del file; non includerli in `old_string` o `new_string`.
- Gli spazi bianchi devono corrispondere esattamente. Presta attenzione a tab contro spazi e spazi finali, specialmente in YAML, Makefile e Python.
- Se `old_string` non è unico e `replace_all` è `false`, l'edit fallisce. O espandi il contesto o abilita `replace_all`.
- Preferisci `Edit` a `Write` ogni volta che il file esiste già; `Write` sovrascrive l'intero file e perde contenuto non correlato se non stai attento.
- Per più modifiche non correlate nello stesso file, emetti più chiamate `Edit` in sequenza piuttosto che una grande e fragile sostituzione.
- Evita di introdurre emoji, testo promozionale o blocchi di documentazione non richiesti quando modifichi file sorgente.
