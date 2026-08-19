# Read

Laster innholdet i én enkelt fil fra det lokale filsystemet. Støtter ren tekst, kildekode, bilder, PDF-er og Jupyter-notebooks, og returnerer resultater med 1-baserte linjenumre i `cat -n`-stil.

## Når skal den brukes

- Lese en kildefil på en kjent sti før redigering eller analyse
- Inspisere konfigurasjonsfiler, lockfiler, logger eller genererte artefakter
- Se på skjermbilder eller diagrammer brukeren har limt inn i samtalen
- Hente ut et spesifikt sideområde fra en lang PDF-manual
- Åpne en `.ipynb`-notebook for å gjennomgå kodeceller, markdown og celleutdata sammen

## Parametere

- `file_path` (string, påkrevd): Absolutt sti til målfilen. Relative stier avvises.
- `offset` (integer, valgfri): 1-basert linjenummer å starte lesingen fra. Nyttig for store filer når den kombineres med `limit`.
- `limit` (integer, valgfri): Maksimalt antall linjer å returnere fra og med `offset`. Standard er 2000 linjer fra toppen av filen når den utelates.
- `pages` (string, valgfri): Sideområde for PDF-filer, for eksempel `"1-5"`, `"3"` eller `"10-20"`. Påkrevd for PDF-er lengre enn 10 sider; maksimalt 20 sider per forespørsel.

## Eksempler

### Eksempel 1: Les en hel liten fil
Kall `Read` med kun `file_path` satt til `/Users/me/project/src/index.ts`. Opptil 2000 linjer returneres med linjenumre, som vanligvis er tilstrekkelig for redigeringskontekst.

### Eksempel 2: Bla gjennom en lang logg
Bruk `offset: 5001` og `limit: 500` på en logg på flere tusen linjer for å hente ut et smalt vindu uten å sløse med kontekstokens.

### Eksempel 3: Hent ut spesifikke PDF-sider
For en 120-siders PDF på `/tmp/spec.pdf`, sett `pages: "8-15"` for å trekke ut kun kapittelet du trenger. Å utelate `pages` på en stor PDF gir en feil.

### Eksempel 4: Vis et bilde
Send den absolutte stien til et PNG- eller JPG-skjermbilde. Bildet rendres visuelt slik at Claude Code kan resonnere over det direkte.

## Notater

- Foretrekk alltid absolutte stier. Hvis brukeren oppgir en, stol på den som den er.
- Linjer lengre enn 2000 tegn trunkeres; behandle det returnerte innholdet som potensielt avklippet for ekstremt brede data.
- Leser du flere uavhengige filer? Send flere `Read`-kall i samme svar slik at de kjører parallelt.
- `Read` kan ikke liste kataloger. Bruk et `Bash` `ls`-kall eller `Glob`-verktøyet i stedet.
- Å lese en eksisterende, men tom fil returnerer en systempåminnelse i stedet for filbytes, så håndter det signalet eksplisitt.
- En vellykket `Read` er påkrevd før du kan bruke `Edit` på samme fil i gjeldende sesjon.
