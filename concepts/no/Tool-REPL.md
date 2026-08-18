# REPL

Kjører JavaScript i en persistent Node.js vm-kontekst inne i sesjonen. Top-level `await` støttes, og variabler/funksjoner definert i ett kall forblir tilgjengelige i senere kall.

## Når skal den brukes

- Raske beregninger, datatransformasjon eller JSON-fikling som er enklere i kode enn i shell-énlinjere.
- Flerstegs scripting der mellomtilstand skal vedvare mellom kall (tellere, akkumulerte resultater).
- Utforske en API eller et biblioteks oppførsel interaktivt før du skriver det inn i en fil.

## Parametere

- `code` (string, påkrevd): JavaScript-kode som skal kjøres. Støtter top-level await. Tilstanden vedvarer på tvers av kall.
- `description` (string, valgfri): Klar, konsis beskrivelse av hva dette scriptet gjør i aktiv form (5–10 ord), f.eks. "Spor oppgraderingsmeldingen til GrowthBook-flagget".
- `timeout` (number, valgfri): Tidsavbrudd i millisekunder. Standard er 30000; maksimum 600000.

## Eksempler

### Eksempel 1: Beregn og gjenbruk tilstand

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

Returnerer `2`; `counts` forblir definert for påfølgende REPL-kall i samme sesjon.

### Eksempel 2: Top-level await med lengre tidsavbrudd

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## Notater

- Tilstanden er per sesjon: å starte sesjonen på nytt tømmer alle definisjoner.
- Dette er et JavaScript (Node)-miljø — bruk Bash for shell-kommandoer, filsystemtungt arbeid eller ikke-JS-runtimer.
- Langvarig kode bør sette et eksplisitt `timeout`; standard 30 s avbryter alt som er tregere.
