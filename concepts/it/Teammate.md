# Teammate

## Definizione

Un Teammate e un agent collaborativo nella modalita Team di Claude Code Agent. Quando l'agent principale crea un team con `TeamCreate` e genera i teammate utilizzando lo strumento `Agent`, ogni teammate viene eseguito come processo agent indipendente, con la propria finestra di contesto e il proprio set di strumenti, comunicando con i membri del team tramite `SendMessage`.

## Differenze rispetto a SubAgent

| Caratteristica | Teammate | SubAgent |
|----------------|----------|----------|
| Ciclo di vita | Persiste, puo ricevere piu messaggi | Attivita singola, distrutto al completamento |
| Comunicazione | SendMessage messaggi bidirezionali | Chiamata unidirezionale genitore->figlio, restituisce risultato |
| Contesto | Contesto completo indipendente, mantenuto tra i turni | Contesto di attivita isolato |
| Modalita di collaborazione | Collaborazione di team, comunicazione reciproca possibile | Struttura gerarchica, interazione solo con l'agent genitore |
| Tipo di attivita | Attivita complesse a piu fasi | Attivita singole come ricerca, esplorazione |

## Comportamento

- Creato dall'agent principale (team lead) tramite lo strumento `Agent` e assegnato a un `team_name`
- Condivide la lista delle attivita tramite `TaskList` / `TaskGet` / `TaskUpdate`
- Entra in stato idle dopo ogni turno di esecuzione, in attesa di nuovi messaggi per la riattivazione
- Puo essere terminato in modo ordinato tramite `shutdown_request`

## Descrizione del pannello statistiche

Il pannello statistiche dei Teammate mostra il numero di chiamate API per ogni teammate. La colonna `Name` contiene il nome del teammate (ad es. `reviewer-security`, `reviewer-pipeline`), la colonna `Conteggio` indica il numero totale di richieste API generate da quel teammate.
