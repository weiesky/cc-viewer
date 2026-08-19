# Write

Opretter en ny fil eller udskifter fuldt ud indholdet af en eksisterende på det lokale filsystem. Fordi den udskifter alt på målstien, bør den reserveres til ægte oprettelse eller bevidste fulde omskrivninger.

## Hvornår skal den bruges

- Oprette en helt ny kildefil, test eller konfiguration, der ikke eksisterer endnu
- Generere en ny fixture, snapshot eller datafil fra bunden
- Udføre en komplet omskrivning, hvor en inkrementel `Edit` ville være mere kompleks end at starte forfra
- Udsende en anmodet artefakt som et skema, en migration eller et build-script, som brugeren udtrykkeligt bad dig producere

## Parametre

- `file_path` (string, påkrævet): Absolut sti til den fil, der skal skrives. Eventuelle overordnede mapper skal allerede eksistere.
- `content` (string, påkrævet): Den fulde tekst, der skal skrives til filen. Dette bliver hele filens krop.

## Eksempler

### Eksempel 1: Opret et nyt hjælpemodul
Kald `Write` med `file_path: "/Users/me/app/src/utils/slugify.ts"` og angiv implementeringen som `content`. Brug dette kun efter at have verificeret, at filen ikke allerede eksisterer.

### Eksempel 2: Regenerér en afledt artefakt
Efter at skemakilden ændrer sig, omskriv `/Users/me/app/generated/schema.json` i et enkelt `Write`-kald ved hjælp af den nyligt genererede JSON som `content`.

### Eksempel 3: Udskift en lille fixture-fil
For en engangs-testfixture, hvor hver linje ændrer sig, kan `Write` være klarere end en sekvens af `Edit`-kald. Læs filen først, bekræft omfanget, og overskriv derefter.

## Noter

- Før du overskriver en eksisterende fil, skal du kalde `Read` på den i den aktuelle session. `Write` nægter at overskrive usete data.
- Foretræk `Edit` for enhver ændring, der kun rører en del af en fil. `Edit` sender kun diff'en, hvilket er hurtigere, sikrere og nemmere at gennemgå.
- Opret ikke proaktivt Markdown-dokumentation, `README.md` eller changelog-filer, medmindre brugeren udtrykkeligt beder om dem.
- Tilføj ikke emoji, marketingtekst eller dekorative bannere, medmindre brugeren anmoder om den stil.
- Verificér først, at den overordnede mappe eksisterer, med et `Bash` `ls`-kald; `Write` opretter ikke mellemliggende mapper.
- Lever indholdet nøjagtigt, som du ønsker det persisteret; der er ingen templating eller post-processing.
