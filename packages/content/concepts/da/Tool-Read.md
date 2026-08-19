# Read

Indlæser indholdet af en enkelt fil fra det lokale filsystem. Understøtter almindelig tekst, kildekode, billeder, PDF'er og Jupyter-notebooks og returnerer resultater med 1-baserede linjenumre i `cat -n`-stil.

## Hvornår skal den bruges

- Læse en kildefil ved en kendt sti før redigering eller analyse
- Inspicere konfigurationsfiler, lockfiles, logs eller genererede artefakter
- Se screenshots eller diagrammer, brugeren har indsat i samtalen
- Udtrække et specifikt sideinterval fra en lang PDF-manual
- Åbne en `.ipynb`-notebook for at gennemgå kodeceller, markdown og celleoutput sammen

## Parametre

- `file_path` (string, påkrævet): Absolut sti til målfilen. Relative stier afvises.
- `offset` (integer, valgfri): 1-baseret linjenummer at starte læsningen fra. Nyttigt for store filer i kombination med `limit`.
- `limit` (integer, valgfri): Maksimalt antal linjer, der returneres fra `offset`. Standard er 2000 linjer fra toppen af filen, når det udelades.
- `pages` (string, valgfri): Sideinterval for PDF-filer, for eksempel `"1-5"`, `"3"` eller `"10-20"`. Påkrævet for PDF'er længere end 10 sider; maksimalt 20 sider pr. anmodning.

## Eksempler

### Eksempel 1: Læs en hel lille fil
Kald `Read` med kun `file_path` sat til `/Users/me/project/src/index.ts`. Op til 2000 linjer returneres med linjenumre, hvilket normalt er tilstrækkelig redigeringskontekst.

### Eksempel 2: Bladr gennem en lang log
Brug `offset: 5001` og `limit: 500` på en log-fil med flere tusinde linjer for at hente et smalt vindue uden at spilde kontekst-tokens.

### Eksempel 3: Udtræk specifikke PDF-sider
For en PDF på 120 sider ved `/tmp/spec.pdf`, sæt `pages: "8-15"` for kun at hente det kapitel, du har brug for. Udeladelse af `pages` på en stor PDF giver en fejl.

### Eksempel 4: Vis et billede
Send den absolutte sti til et PNG- eller JPG-screenshot. Billedet gengives visuelt, så Claude Code kan ræsonnere direkte om det.

## Noter

- Foretræk altid absolutte stier. Hvis brugeren angiver en, skal du stole på den som den er.
- Linjer længere end 2000 tegn afkortes; behandl det returnerede indhold som muligvis klippet for ekstremt brede data.
- Læser du flere uafhængige filer? Udsted flere `Read`-kald i samme svar, så de kører parallelt.
- `Read` kan ikke liste mapper. Brug et `Bash` `ls`-kald eller `Glob`-værktøjet i stedet.
- Læsning af en eksisterende, men tom fil returnerer en system-påmindelse i stedet for filbytes, så håndtér det signal eksplicit.
- En vellykket `Read` er påkrævet, før du kan bruge `Edit` på den samme fil i den aktuelle session.
