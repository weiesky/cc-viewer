# SendFile

Sender en eller flere filer til en anden Claude Code-session — en peer, der er listet af `ListAgents`, eller en eksplicit sessionsadresse.

## Hvornår skal den bruges

- En peer-session har brug for en fil fra din arbejdsmappe (en rapport, en patch, en fixture) for at fortsætte sin egen opgave.
- Du koordinerer arbejde på tværs af sessioner og vil overdrage artefakter, ikke bare tekst (brug `SendMessage` til tekst).

## Aktivering

- Filoverførsel på tværs af sessioner skal være tilgængelig i sessionen; når den ikke er, fejler valideringen med "Cross-session file transfer is not available in this session."
- Gated af de samme betingelser for beskeder på tværs af sessioner som `ListAgents` (server-side feature-flags, slået fra som standard).

## Parametre

- `to` (string, påkrævet): Modtager — et peer-sessionsnavn fra `ListAgents` eller en eksplicit `uds:<socket>` / `bridge:<session id>`-adresse.
- `files` (array af strings, påkrævet): Filstier (absolutte eller relative i forhold til cwd), der skal sendes. Send altid et array, selv for en enkelt fil. 1-16 filer, højst 30 MiB hver.
- `message` (string, valgfri): Kort besked leveret sammen med filerne.

## Eksempler

### Eksempel 1: Send en rapport til en peer-session

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## Noter

- Overførsler til fjerne maskiner kan kræve yderligere godkendelse.
- At læse filindholdet er en del af afsendelsen — afvist, hvis fillæsning er deaktiveret af tilladelsesregler.
