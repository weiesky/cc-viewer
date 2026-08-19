# Projects

Administrerer prosjektdokumenter i brukerens Claude-prosjektkunnskapsbase: les, søk, skriv og slett dokumenter, eller hent prosjektinformasjon.

## Når skal den brukes

- Vedvare et dokument (leveranse, notater, referansemateriale) inn i brukerens prosjekt slik at det overlever sesjonen.
- Lese eller søke i eksisterende prosjektdokumenter for å forankre gjeldende oppgave i tidligere kontekst.
- Laste opp en lokal fil til prosjektet uten å laste innholdet inn i kontekst.
- Fjerne et utdatert prosjektdokument.

## Parametere

- `method` (string, påkrevd): Én av `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`.
- `path` (string, valgfri): For `project_read`/`project_write`/`project_delete`: dokumentstien. For `project_write`: en eksisterende sti erstattes på stedet; et nytt nakent filnavn (uten "/") navneromssettes til `claude/<name>`.
- `content` (string, valgfri): For `project_write`: inline dokumenttekst. Gjensidig utelukkende med `local_path`.
- `local_path` (string, valgfri): For `project_write`: en fil inne i arbeidskatalogen som skal lastes opp — innholdet kommer aldri inn i konteksten din. Gjensidig utelukkende med `content`.
- `present_to_user` (boolean, valgfri): For `project_write`: merk dette dokumentet som leveransen brukeren trenger å se. Standard er false; la stå usatt for rutinemessige lagringer og bulk-skrivinger.
- `query` (string, valgfri): For `project_search`: kunnskapsbase-spørring.
- `n` (number, valgfri): For `project_search`: antall treff (standard 5).

## Eksempler

### Eksempel 1: Skriv leveransen inn i prosjektet

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

Laster opp den lokale filen uten å trekke innholdet inn i konteksten, og flagger den som brukerens leveranse.

### Eksempel 2: Søk i kunnskapsbasen

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## Notater

- `content` er for tekst du komponerer inline; `local_path` er for alt som allerede ligger på disk — aldri bland de to.
- Bruk `present_to_user=true` sparsomt: kun for det ene dokumentet brukeren ba om eller må handle på.
