# Projects

Gestisce i documenti di progetto nella knowledge base del progetto Claude dell'utente: leggere, cercare, scrivere ed eliminare documenti, oppure ottenere informazioni sul progetto.

## Quando usare

- Persistire un documento (deliverable, note, materiale di riferimento) nel progetto dell'utente affinché sopravviva alla sessione.
- Leggere o cercare documenti di progetto esistenti per fondare il compito corrente su contesto precedente.
- Caricare un file locale nel progetto senza caricarne il contenuto nel contesto.
- Rimuovere un documento di progetto obsoleto.

## Parametri

- `method` (string, obbligatorio): Uno tra `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`.
- `path` (string, opzionale): Per `project_read`/`project_write`/`project_delete`: il percorso del documento. Per `project_write`: un percorso esistente viene sostituito in loco; un nuovo semplice nome file (senza "/") viene collocato nel namespace `claude/<name>`.
- `content` (string, opzionale): Per `project_write`: testo del documento inline. Mutuamente esclusivo con `local_path`.
- `local_path` (string, opzionale): Per `project_write`: un file all'interno della directory di lavoro da caricare — il contenuto non entra mai nel tuo contesto. Mutuamente esclusivo con `content`.
- `present_to_user` (boolean, opzionale): Per `project_write`: marca questo documento come il deliverable che l'utente deve vedere. Default: false; lascia non impostato per salvataggi di routine e scritture in blocco.
- `query` (string, opzionale): Per `project_search`: query sulla knowledge base.
- `n` (number, opzionale): Per `project_search`: numero di risultati (default 5).

## Esempi

### Esempio 1: Scrivere il deliverable nel progetto

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

Carica il file locale senza portarne il contenuto nel contesto, e lo marca come deliverable dell'utente.

### Esempio 2: Cercare nella knowledge base

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## Note

- `content` è per testo che componi inline; `local_path` è per qualsiasi cosa già su disco — non mescolare mai i due.
- Usa `present_to_user=true` con parsimonia: solo per l'unico documento che l'utente ha chiesto o su cui deve agire.
