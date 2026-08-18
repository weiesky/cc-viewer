# REPL

Udfører JavaScript i en vedvarende Node.js vm-kontekst inde i sessionen. Top-niveau `await` understøttes, og variabler/funktioner defineret i ét kald forbliver tilgængelige i senere kald.

## Hvornår skal den bruges

- Hurtig beregning, datatransformation eller JSON-bearbejdning, der er lettere i kode end i shell-one-liners.
- Flertrins-scripting, hvor mellemliggende tilstand skal vedvare mellem kald (tællere, akkumulerede resultater).
- At afprøve et API's eller biblioteks opførsel interaktivt, før du skriver det ind i en fil.

## Aktivering

- Slået fra som standard — sæt `CLAUDE_CODE_REPL=true` for at aktivere det.
- I terminal- (`cli`) og claude.ai-sessioner (`remote`) kan et server-side feature-flag også aktivere det.
- Når det er slået fra, er REPL udeladt af modellens værktøjsliste. Når det er slået til, erstattes `Read`, `Glob`, `Grep`, `Bash`, `PowerShell` og `NotebookEdit` af REPL-forkortelser.

## Parametre

- `code` (string, påkrævet): JavaScript-kode, der skal udføres. Understøtter top-niveau await. Tilstand vedvarer på tværs af kald.
- `description` (string, valgfri): Klar, kortfattet beskrivelse af, hvad dette script gør, i aktiv form (5-10 ord), f.eks. "Trace upgrade message to its GrowthBook flag".
- `timeout` (number, valgfri): Timeout i millisekunder. Standard er 30000; maksimum 600000.

## Eksempler

### Eksempel 1: Beregn og genbrug tilstand

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

Returnerer `2`; `counts` forbliver defineret for efterfølgende REPL-kald i samme session.

### Eksempel 2: Top-niveau await med længere timeout

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## Noter

- Tilstand er pr. session: genstart af sessionen rydder alle definitioner.
- Dette er et JavaScript-miljø (Node) — brug Bash til shell-kommandoer, filsystemtungt arbejde eller ikke-JS-runtimes.
- Langtidskørende kode bør sætte en eksplicit `timeout`; standarden på 30 s dræber alt, der er langsommere.
