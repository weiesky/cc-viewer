# SendMessage

## Definizione

Invia messaggi tra agent all'interno di un team. Utilizzato per la comunicazione diretta, il broadcast e i messaggi di protocollo (richieste/risposte di arresto, approvazione piani).

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|-----------|------|--------------|-------------|
| `to` | string | Sì | Destinatario: nome del membro, o `"*"` per broadcast a tutti |
| `message` | string / object | Sì | Messaggio di testo o oggetto di protocollo strutturato |
| `summary` | string | No | Anteprima di 5-10 parole mostrata nell'interfaccia |

## Tipi di messaggio

### Testo semplice
Messaggi diretti tra membri del team per coordinamento, aggiornamenti di stato e discussioni sui task.

### Richiesta di arresto
Chiede a un membro di arrestarsi in modo ordinato: `{ type: "shutdown_request", reason: "..." }`

### Risposta di arresto
Il membro approva o rifiuta l'arresto: `{ type: "shutdown_response", approve: true/false }`

### Risposta di approvazione piano
Approva o rifiuta il piano di un membro: `{ type: "plan_approval_response", approve: true/false }`

## Broadcast vs. Diretto

- **Diretto** (`to: "nome-membro"`): Invia a un membro specifico — preferito per la maggior parte delle comunicazioni
- **Broadcast** (`to: "*"`): Invia a tutti i membri — da usare con parsimonia, solo per annunci critici a livello di team

## Strumenti correlati

| Strumento | Scopo |
|-----------|-------|
| `TeamCreate` | Creare un nuovo team |
| `TeamDelete` | Rimuovere il team al completamento |
| `Agent` | Avviare membri che si uniscono al team |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Gestire la lista dei task condivisa |
