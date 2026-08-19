# TaskOutput

Recupera l'output accumulato di un task in background in esecuzione o completato — un comando shell in background, un agente locale o una sessione remota. Usalo quando devi ispezionare ciò che un task a lunga esecuzione ha prodotto finora.

## Quando usare

- Una sessione remota (ad esempio una sandbox cloud) è in esecuzione e ti serve il suo stdout.
- Un agente locale è stato inviato in background e vuoi progressi parziali prima che ritorni.
- Un comando shell in background è in esecuzione da abbastanza tempo che vuoi controllarlo senza fermarlo.
- Devi confermare che un task in background stia effettivamente facendo progressi prima di aspettare ulteriormente o chiamare `TaskStop`.

Non ricorrere a `TaskOutput` riflessivamente. Per la maggior parte del lavoro in background c'è un percorso più diretto — vedi le note sotto.

## Parametri

- `task_id` (string, obbligatorio): L'identificatore del task restituito quando il lavoro in background è stato avviato. Non è lo stesso di un `taskId` della task-list; questo è l'handle di runtime per l'esecuzione specifica.
- `block` (boolean, opzionale): Quando `true` (default), attende che il task produca nuovo output o termini prima di restituire. Quando `false`, restituisce immediatamente con qualsiasi cosa sia bufferizzata.
- `timeout` (number, opzionale): Millisecondi massimi da bloccare prima di restituire. Significativo solo quando `block` è `true`. Default `30000`, massimo `600000`.

## Esempi

### Esempio 1

Sbircia una sessione remota senza bloccare.

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

Restituisce qualsiasi stdout/stderr prodotto da quando il task è iniziato (o dalla tua ultima chiamata `TaskOutput`, a seconda del runtime).

### Esempio 2

Aspetta brevemente che un agente locale emetta più output.

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## Note

- Comandi bash in background: `TaskOutput` è di fatto deprecato per questo caso d'uso. Quando avvii un task shell in background il risultato include già il percorso al suo file di output — leggi quel percorso direttamente con il tool `Read`. `Read` ti dà accesso casuale, offset di riga e una vista stabile; `TaskOutput` no.
- Agenti locali (il tool `Agent` inviato in background): quando l'agente finisce, il risultato del tool `Agent` contiene già la sua risposta finale. Usalo direttamente. Non fare `Read` sul file transcript simlinkato — contiene l'intero flusso di tool-call e farà overflow della finestra di contesto.
- Sessioni remote: `TaskOutput` è il modo corretto e spesso unico per fare streaming dell'output. Preferisci `block: true` con un `timeout` modesto a loop di polling stretti.
- Un `task_id` sconosciuto, o un task il cui output è stato garbage-collectato, restituisce un errore. Ri-invia il lavoro se ne hai ancora bisogno.
- `TaskOutput` non ferma il task. Usa `TaskStop` per terminare.
