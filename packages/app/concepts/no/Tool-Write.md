# Write

Oppretter en ny fil eller erstatter fullstendig innholdet i en eksisterende på det lokale filsystemet. Fordi det erstatter alt på målstien, bør det reserveres for ekte opprettelse eller bevisste fullstendige omskrivinger.

## Når skal den brukes

- Opprette en helt ny kildefil, test eller konfigurasjon som ennå ikke finnes
- Generere en fersk fixtur, snapshot eller datafil fra bunnen av
- Utføre en fullstendig omskriving der en inkrementell `Edit` ville vært mer kompleks enn å starte på nytt
- Produsere en forespurt artefakt som et skjema, migrasjon eller byggeskript som brukeren eksplisitt har bedt deg produsere

## Parametere

- `file_path` (string, påkrevd): Absolutt sti til filen som skal skrives. Alle overordnede kataloger må allerede finnes.
- `content` (string, påkrevd): Den fulle teksten som skal skrives til filen. Dette blir hele filkroppen.

## Eksempler

### Eksempel 1: Opprett en ny hjelpemodul
Kall `Write` med `file_path: "/Users/me/app/src/utils/slugify.ts"` og oppgi implementasjonen som `content`. Bruk dette kun etter å ha verifisert at filen ikke allerede eksisterer.

### Eksempel 2: Regenerer en avledet artefakt
Etter at skjemakilden endres, skriv om `/Users/me/app/generated/schema.json` i ett `Write`-kall med den nygenererte JSON-en som `content`.

### Eksempel 3: Erstatt en liten fixturfil
For en engangs testfixtur der hver linje endres, kan `Write` være klarere enn en sekvens med `Edit`-kall. Les filen først, bekreft omfanget, og overskriv deretter.

## Notater

- Før du overskriver en eksisterende fil, må du kalle `Read` på den i gjeldende sesjon. `Write` nekter å overskrive usett innhold.
- Foretrekk `Edit` for enhver endring som kun berører en del av en fil. `Edit` sender kun diffen, som er raskere, tryggere og enklere å gjennomgå.
- Ikke proaktivt opprett Markdown-dokumentasjon, `README.md` eller changelog-filer med mindre brukeren eksplisitt ber om dem.
- Ikke legg til emoji, markedsføringstekst eller dekorative bannere med mindre brukeren ber om den stilen.
- Verifiser at overordnet katalog finnes først med et `Bash` `ls`-kall; `Write` oppretter ikke mellomliggende mapper.
- Oppgi innholdet nøyaktig som du vil ha det lagret; det er ingen maling eller etterbehandling.
