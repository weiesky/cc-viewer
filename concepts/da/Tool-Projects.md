# Projects

Administrerer projektdokumenter i brugerens Claude-projektvidensbase: læs, søg, skriv og slet dokumenter, eller hent projektinfo.

## Hvornår skal den bruges

- Gem et dokument (leverance, noter, referencemateriale) i brugerens projekt, så det overlever sessionen.
- Læs eller søg i eksisterende projektdokumenter for at grundlægge den aktuelle opgave i tidligere kontekst.
- Upload en lokal fil til projektet uden at indlæse dens indhold i kontekst.
- Fjern et forældet projektdokument.

## Parametre

- `method` (string, påkrævet): Én af `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`.
- `path` (string, valgfri): For `project_read`/`project_write`/`project_delete`: dokumentstien. For `project_write`: en eksisterende sti erstattes på stedet; et nyt bart filnavn (uden "/") lægges under navnerummet `claude/<name>`.
- `content` (string, valgfri): For `project_write`: inline-dokumenttekst. Gensidigt udelukkende med `local_path`.
- `local_path` (string, valgfri): For `project_write`: en fil inde i arbejdsmappen, der skal uploades — indholdet kommer aldrig ind i din kontekst. Gensidigt udelukkende med `content`.
- `present_to_user` (boolean, valgfri): For `project_write`: markér dette dokument som den leverance, brugeren skal se. Standard er false; lad være usat ved rutinegemninger og bulk-skrivninger.
- `query` (string, valgfri): For `project_search`: vidensbase-forespørgsel.
- `n` (number, valgfri): For `project_search`: antal hits (standard 5).

## Eksempler

### Eksempel 1: Skriv leverancen ind i projektet

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

Uploader den lokale fil uden at trække dens indhold ind i kontekst og markerer den som brugerens leverance.

### Eksempel 2: Søg i vidensbasen

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## Noter

- `content` er til tekst, du komponerer inline; `local_path` er til alt, der allerede ligger på disken — bland aldrig de to.
- Brug `present_to_user=true` sparsomt: kun til det ene dokument, brugeren bad om eller skal handle på.
