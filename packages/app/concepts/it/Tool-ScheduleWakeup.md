# ScheduleWakeup

Pianifica quando riprendere il lavoro in modalità dinamica `/loop`. Lo strumento consente a Claude di autogestire il ritmo delle iterazioni di un'attività, dormendo per l'intervallo scelto e poi attivandosi nuovamente con lo stesso prompt del loop.

## Quando usare

- Per autogestire il ritmo di un'attività dinamica `/loop` dove l'intervallo di iterazione dipende dallo stato del lavoro anziché da un orologio fisso
- Per attendere il completamento di una lunga compilazione, distribuzione o esecuzione di test prima di controllare i risultati
- Per inserire tick di inattività tra le iterazioni quando non c'è un segnale specifico da monitorare in questo momento
- Per eseguire un loop autonomo senza prompt dell'utente — passare il sentinel letterale `<<autonomous-loop-dynamic>>` come `prompt`
- Per interrogare un processo il cui stato sta per cambiare (usare un breve ritardo per mantenere la cache calda)

## Attivazione

- Non disponibile su Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform o Microsoft Foundry.
- Disattivato anche quando il recupero dei feature flag è disabilitato (variabili d'ambiente di telemetria/traffico).

## Parametri

- `delaySeconds` (numero, obbligatorio): Secondi fino alla ripresa. Il runtime limita automaticamente il valore a `[60, 3600]`, quindi non è necessario limitarlo manualmente.
- `reason` (stringa, obbligatoria): Una breve frase che spiega il ritardo scelto. Mostrata all'utente e registrata nella telemetria. Essere specifici — "controllo della lunga compilazione bun" è più utile di "in attesa."
- `prompt` (stringa, obbligatoria): L'input `/loop` da attivare al risveglio. Passare la stessa stringa ad ogni turno in modo che il prossimo trigger ripeta l'attività. Per un loop autonomo senza prompt dell'utente, passare il sentinel letterale `<<autonomous-loop-dynamic>>`.

## Esempi

### Esempio 1: breve ritardo per ricontrollare un segnale che cambia rapidamente (mantenere la cache calda)

Una compilazione è appena stata avviata e di solito termina in due o tre minuti.

```json
{
  "delaySeconds": 120,
  "reason": "controllo compilazione bun prevista in ~2 min",
  "prompt": "controllare lo stato della compilazione e segnalare eventuali errori"
}
```

120 secondi mantiene il contesto della conversazione nella cache dei prompt Anthropic (TTL 5 min), quindi il prossimo risveglio è più veloce ed economico.

### Esempio 2: lungo tick di inattività (accettare il cache miss, ammortizzare su un'attesa più lunga)

Una migrazione del database è in esecuzione e di solito richiede 20–40 minuti.

```json
{
  "delaySeconds": 1200,
  "reason": "la migrazione richiede solitamente 20–40 min; ricontrollo in 20 min",
  "prompt": "controllare lo stato della migrazione e continuare se completata"
}
```

La cache sarà fredda al risveglio, ma l'attesa di 20 minuti ammortizza ampiamente il costo del singolo cache miss. Interrogare ogni 5 minuti pagherebbe lo stesso costo di miss 4 volte senza alcun beneficio.

## Note

- **TTL della cache di 5 minuti**: La cache dei prompt Anthropic scade dopo 300 secondi. I ritardi inferiori a 300 s mantengono il contesto caldo; i ritardi superiori a 300 s comportano un cache miss al prossimo risveglio.
- **Evitare esattamente 300 s**: È il peggio di entrambi i mondi — si paga il cache miss senza ottenere un'attesa significativamente più lunga. Ridurre a 270 s (mantenere la cache calda) o impegnarsi con 1200 s o più (un miss acquista un'attesa molto più lunga).
- **Valore predefinito per i tick di inattività**: Quando non c'è un segnale specifico da monitorare, usare **1200–1800 s** (20–30 min). Questo consente al loop di controllare periodicamente senza bruciare la cache 12 volte all'ora inutilmente.
- **Limitazione automatica**: Il runtime limita `delaySeconds` a `[60, 3600]`. I valori inferiori a 60 diventano 60; i valori superiori a 3600 diventano 3600. Non è necessario gestire questi limiti manualmente.
- **Omettere la chiamata per terminare il loop**: Se si intende interrompere le iterazioni, non chiamare ScheduleWakeup. Semplicemente omettere la chiamata termina il loop.
- **Passare lo stesso `prompt` ad ogni turno**: Il campo `prompt` deve contenere l'istruzione `/loop` originale ad ogni invocazione affinché il prossimo risveglio sappia quale attività riprendere.
