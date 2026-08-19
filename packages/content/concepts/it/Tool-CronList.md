# CronList

Elenca tutti i job cron pianificati tramite `CronCreate` nella sessione corrente. Restituisce un riepilogo di ogni cron attivo che include `id`, espressione cron, `prompt` abbreviato, flag `recurring`, flag `durable` e il prossimo orario di esecuzione.

## Quando usare

- Per verificare tutti i job attualmente pianificati prima di apportare modifiche o terminare una sessione.
- Per trovare il corretto `id` di un job prima di chiamare `CronDelete` per eliminarlo.
- Per diagnosticare perche un job atteso non si e mai avviato, confermandone l'esistenza e verificando il prossimo orario di esecuzione.
- Per confermare che un job a esecuzione unica (non ricorrente) non si sia ancora attivato e sia ancora in attesa.

## Parametri

Nessuno.

## Esempi

### Esempio 1: verificare tutti i job pianificati

Invocare `CronList` senza argomenti per ottenere l'elenco completo di tutti i job cron attivi. La risposta include per ogni job il suo `id`, l'espressione cron che ne definisce la pianificazione, una versione troncata del `prompt` che eseguira, se e `recurring` (ricorrente), se e `durable` (persistente tra i riavvii) e il prossimo orario di esecuzione previsto.

### Esempio 2: individuare l'id di un task ricorrente specifico

Se sono stati creati piu job cron e occorre eliminarne uno in particolare, invocare prima `CronList`. Scorrere l'elenco restituito per trovare il job il cui riepilogo del `prompt` e la cui espressione cron corrispondono al task da eliminare. Copiare il suo `id` e passarlo a `CronDelete`.

## Note

- Vengono elencati solo i job creati nella sessione corrente, a meno che non siano stati creati con `durable: true`, che ne consente la persistenza tra i riavvii di sessione.
- Il campo `prompt` nel riepilogo e troncato; mostra solo l'inizio del testo completo del prompt, non il contenuto integrale.
- I job a esecuzione unica (in cui `recurring` e `false`) che si sono gia attivati vengono eliminati automaticamente e non compaiono piu nell'elenco.
