# RemoteTrigger

Kalder claude.ai's fjernudløser-API for at administrere planlagte opgaver og on-demand udløsereksekveringer. OAuth-tokenet håndteres internt af værktøjet og eksponeres aldrig for modellen eller shell'en.

## Hvornår skal den bruges

- Administration af fjernagenter (udløsere) på claude.ai, herunder visning, inspektion og opdatering af eksisterende udløsere
- Oprettelse af en ny cron-baseret automatiseret opgave, der kører en Claude-agent efter en tilbagevendende tidsplan
- Udløsning af en eksisterende udløser on-demand uden at vente på dens næste planlagte kørsel
- Visning eller revision af alle aktuelle udløsere for at gennemgå deres konfiguration og status
- Opdatering af udløserindstillinger som tidsplan, nyttelast eller beskrivelse uden at skulle genskabe udløseren

## Aktivering

- Kræver et claude.ai Pro-, Max-, Team- eller Enterprise-abonnement.
- Ikke tilgængelig på Amazon Bedrock, Claude Platform on AWS, Google Cloud eller Microsoft Foundry.
- Kræver server-side feature-flags og policy-indstillingerne `allow_remote_sessions` / `allow_routines`.
- Ikke til brug i selve remote-sessionerne.

## Parametre

- `action` (string, påkrævet): den operation der skal udføres — en af `list`, `get`, `create`, `update` eller `run`
- `trigger_id` (string, påkrævet for `get`, `update` og `run`): identifikatoren for den udløser der skal opereres på; skal matche mønsteret `^[\w-]+$` (kun ordtegn og bindestreger)
- `body` (object, påkrævet for `create` og `update`; valgfri for `run`): anmodningens nyttelast sendt til API'en

## Eksempler

### Eksempel 1: vis alle udløsere

```json
{
  "action": "list"
}
```

Kalder `GET /v1/code/triggers` og returnerer et JSON-array med alle udløsere tilknyttet den godkendte konto.

### Eksempel 2: opret en ny udløser der kører hver hverdagsmorgen

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "Generer et dagligt resumé hver hverdag kl. 08:00 UTC"
  }
}
```

Kalder `POST /v1/code/triggers` med den angivne krop og returnerer det nyoprettede udløserobjekt, inklusive det tildelte `trigger_id`.

### Eksempel 3: udløs en udløser on-demand

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

Kalder øjeblikkeligt `POST /v1/code/triggers/my-report-trigger/run` og omgår det planlagte tidspunkt.

### Eksempel 4: hent en enkelt udløser

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

Kalder `GET /v1/code/triggers/my-report-trigger` og returnerer den fulde udløserkonfiguration.

## Noter

- OAuth-tokenet injiceres in-process af værktøjet — kopier, indsæt eller log aldrig tokens manuelt; dette skaber en sikkerhedsrisiko og er unødvendigt når dette værktøj bruges.
- Foretræk dette værktøj frem for rå `curl` eller andre HTTP-klienter til alle udløser-API-kald; direkte brug af HTTP omgår den sikre tokeninjektion og kan eksponere legitimationsoplysninger.
- Værktøjet returnerer det rå JSON-svar fra API'en; kalderen er ansvarlig for at parse svaret og håndtere fejlstatuskoder.
- Værdien af `trigger_id` skal matche mønsteret `^[\w-]+$` — kun alfanumeriske tegn, understreger og bindestreger er tilladt; mellemrum eller specialtegn vil få anmodningen til at mislykkes.
