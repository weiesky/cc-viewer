# Body Diff JSON (confronto incrementale del corpo della richiesta)

## Contesto

Il MainAgent di Claude Code utilizza un meccanismo di invio del contesto completo: ogni richiesta include l'intera cronologia della conversazione, il system prompt, le definizioni degli strumenti, ecc. Ciò significa che, man mano che la conversazione procede, il corpo della richiesta diventa sempre più grande, rendendo difficile individuare rapidamente "cosa è stato aggiunto in questo turno" esaminando il Body grezzo.

Body Diff JSON è stato creato proprio per risolvere questo problema: confronta automaticamente i body di due richieste MainAgent consecutive, estraendo la parte incrementale, permettendoti di vedere a colpo d'occhio il contenuto effettivamente aggiunto in questa richiesta.

## Come funziona

1. **Identificazione delle richieste MainAgent consecutive**: la richiesta corrente deve essere di tipo MainAgent e deve esistere una richiesta MainAgent precedente
2. **Confronto campo per campo**: vengono esaminati tutti i campi di primo livello del corpo della richiesta, saltando le proprietà interne con prefisso `_`
3. **Estrazione intelligente delle differenze**:
   - Campi aggiunti: mostrati direttamente
   - Campi rimossi: non mostrati (generalmente non influenzano la comprensione)
   - Campi modificati: viene mostrato il valore corrente
   - Trattamento speciale dell'array `messages`: vengono mostrati solo i messaggi aggiunti (poiché in una conversazione normale i messaggi vengono accodati e il prefisso rimane invariato)
4. **Rilevamento della riduzione del corpo**: se il corpo della richiesta corrente è più piccolo del precedente, significa che si è verificato un troncamento del contesto o un reset della sessione; in tal caso viene mostrato un messaggio informativo anziché il diff

## Scenari tipici

In un turno di conversazione normale, il Body Diff JSON contiene solitamente solo:
- `messages`: 1~2 messaggi aggiunti (l'input dell'utente + la risposta dell'assistente del turno precedente)

Se nel diff compaiono modifiche a campi come `system`, `tools`, `model`, significa che in questo turno si è verificata una modifica della configurazione, che spesso è anche la causa della ricostruzione della cache.

## Modalità d'uso

- Il Body Diff JSON viene mostrato nel pannello dei dettagli della richiesta MainAgent
- Clicca sul titolo per espandere/comprimere
- Supporta due modalità di visualizzazione, JSON e Text, oltre alla copia con un clic
- In alto a sinistra, in **CC-Viewer → Impostazioni globali**, puoi impostare "Espandi Body Diff JSON per impostazione predefinita"
