# SuggestSkills

Gengiver et kort med selvstændige skills, brugeren kan tilføje (skills, der endnu ikke er aktiveret), baseret på emnenøgleord.

## Hvornår skal den bruges

- Brugerens anmodning matcher skills, de ikke har aktiveret (`trigger="user_asked"`, når de spurgte, `trigger="proactive"`, når du foreslår uopfordret).

## Parametre

- `keywords` (array af strings, påkrævet): Emnenøgleord fra brugerens anmodning. 1-8 elementer, hver 1-64 tegn.
- `contextLabel` (string, valgfri): Kort etiket, der knytter forslaget til anmodningen (maks. 128 tegn).
- `trigger` (string, valgfri): Hvordan dette forslag startede — `user_asked` eller `proactive`.

## Eksempler

### Eksempel 1: Foreslå skills efter emne

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

Allerede-aktiverede skills filtreres ud af resultatet.

## Noter

- Gengiver kun et forslagskort — tilføjelse af en skill sker uden for værktøjet; kald `ListSkills` bagefter for at bekræfte.
- Deaktiveret under HIPAA enterprise-konfigurationer.
