# SuggestSkills

Gjengir et kort med frittstående skills brukeren kan legge til (skills som ennå ikke er aktivert), basert på emnenøkkelord.

## Når skal den brukes

- Brukerens forespørsel matcher skills de ikke har aktivert (`trigger="user_asked"` når de ba om det, `trigger="proactive"` når du foreslår uoppfordret).

## Aktivering

- Kun når en Remote Control-klient er tilkoblet, eller sesjonen kjører i et administrert cloud-miljø.
- Deaktivert under HIPAA enterprise-konfigurasjoner.
- Ikke i brief-modus.

## Parametere

- `keywords` (array av strenger, påkrevd): Emnenøkkelord fra brukerens forespørsel. 1–8 elementer, hver 1–64 tegn.
- `contextLabel` (string, valgfri): Kort etikett som knytter forslaget til forespørselen (maks 128 tegn).
- `trigger` (string, valgfri): Hvordan dette forslaget startet — `user_asked` eller `proactive`.

## Eksempler

### Eksempel 1: Foreslå skills etter emne

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

Allerede aktiverte skills filtreres ut av resultatet.

## Notater

- Gjengir kun et forslagskort — å legge til en skill skjer utenfor verktøyet; kall `ListSkills` etterpå for å bekrefte.
