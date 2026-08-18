# RemoteTrigger

Kaller claude.ai's fjernutløser-API for å administrere planlagte oppgaver og on-demand utløsereksekveringer. OAuth-tokenet håndteres internt av verktøyet og eksponeres aldri for modellen eller skallet.

## Når skal den brukes

- Administrasjon av fjernagenter (utløsere) på claude.ai, inkludert oppføring, inspeksjon og oppdatering av eksisterende utløsere
- Oppretting av en ny cron-basert automatisert oppgave som kjører en Claude-agent etter en tilbakevendende plan
- Kjøring av en eksisterende utløser on-demand uten å vente på neste planlagte kjøring
- Visning eller revisjon av alle gjeldende utløsere for å gjennomgå konfigurasjon og status
- Oppdatering av utløserinnstillinger som plan, nyttelast eller beskrivelse uten å måtte gjenskape utløseren

## Aktivering

- Krever en claude.ai Pro-, Max-, Team- eller Enterprise-plan.
- Ikke tilgjengelig på Amazon Bedrock, Claude Platform on AWS, Google Cloud eller Microsoft Foundry.
- Krever server-side feature-flags og policy-innstillingene `allow_remote_sessions` / `allow_routines`.
- Ikke for fjernsesjonene selv.

## Parametere

- `action` (string, påkrevd): operasjonen som skal utføres — en av `list`, `get`, `create`, `update` eller `run`
- `trigger_id` (string, påkrevd for `get`, `update` og `run`): identifikatoren til utløseren det skal opereres på; må samsvare med mønsteret `^[\w-]+$` (bare ordtegn og bindestreker)
- `body` (object, påkrevd for `create` og `update`; valgfri for `run`): forespørselsnyttelast sendt til API-en

## Eksempler

### Eksempel 1: vis alle utløsere

```json
{
  "action": "list"
}
```

Kaller `GET /v1/code/triggers` og returnerer en JSON-matrise med alle utløsere knyttet til den autentiserte kontoen.

### Eksempel 2: opprett en ny utløser som kjører hver hverdagsmorgen

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "Generer et daglig sammendrag hver hverdag kl. 08:00 UTC"
  }
}
```

Kaller `POST /v1/code/triggers` med den angitte kroppen og returnerer det nyopprettede utløserobjektet, inkludert den tildelte `trigger_id`.

### Eksempel 3: kjør en utløser on-demand

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

Kaller umiddelbart `POST /v1/code/triggers/my-report-trigger/run` og omgår det planlagte tidspunktet.

### Eksempel 4: hent en enkelt utløser

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

Kaller `GET /v1/code/triggers/my-report-trigger` og returnerer den fullstendige utløserkonfigurasjonen.

## Notater

- OAuth-tokenet injiseres in-process av verktøyet — kopier, lim inn eller logg aldri tokens manuelt; dette skaper en sikkerhetsrisiko og er unødvendig når dette verktøyet brukes.
- Foretrekk dette verktøyet fremfor rå `curl` eller andre HTTP-klienter for alle utløser-API-kall; direkte bruk av HTTP omgår sikker tokeninjeksjon og kan eksponere legitimasjon.
- Verktøyet returnerer det rå JSON-svaret fra API-en; kalleren er ansvarlig for å analysere svaret og håndtere feilstatuskoder.
- Verdien av `trigger_id` må samsvare med mønsteret `^[\w-]+$` — bare alfanumeriske tegn, understreker og bindestreker er tillatt; mellomrom eller spesialtegn vil få forespørselen til å mislykkes.
