# ExitPlanMode

Sender inn implementasjonsplanen som ble utarbeidet i planmodus til brukergodkjenning, og — hvis godkjent — overfører sesjonen ut av planmodus slik at redigeringer kan begynne.

## Når skal den brukes

- En plan skrevet under `EnterPlanMode` er fullført og klar til gjennomgang.
- Oppgaven er implementasjonsfokusert (kode- eller konfigurasjonsendringer), ikke ren research, så en eksplisitt plan er hensiktsmessig.
- All forberedende lesing og analyse er gjort; ingen ytterligere undersøkelse er nødvendig før brukeren bestemmer.
- Assistenten har listet opp konkrete filbaner, funksjoner og steg — ikke bare mål.
- Brukeren har bedt om å se planen, eller plan-modus-arbeidsflyten er i ferd med å levere stafettpinnen videre til redigeringsverktøy.

## Parametere

- `allowedPrompts` (array, valgfri): Prompter brukeren kan skrive på godkjenningsskjermen for å auto-godkjenne eller endre planen. Hvert element spesifiserer en avgrenset tillatelse (for eksempel et operasjonsnavn og verktøyet det gjelder for). La stå usatt for å bruke standard godkjenningsflyt.

## Eksempler

### Eksempel 1: Standard innsendelse

Etter å ha undersøkt en autentiseringsrefaktorering inne i planmodus og skrevet planfilen til disk, kaller assistenten `ExitPlanMode` uten argumenter. Rammeverket leser planen fra dens kanoniske plassering, viser den til brukeren og venter på godkjenning eller avslag.

### Eksempel 2: Forhåndsgodkjente hurtighandlinger

```
ExitPlanMode(allowedPrompts=[
  {"tool": "Bash", "prompt": "run tests"},
  {"tool": "Bash", "prompt": "install dependencies"}
])
```

Lar brukeren gi tillatelse på forhånd for rutinemessige oppfølgingskommandoer, slik at assistenten ikke trenger å pause for hver tillatelsesforespørsel under implementering.

## Notater

- `ExitPlanMode` gir kun mening for implementasjonsorientert arbeid. Hvis brukerens forespørsel er en research- eller forklaringsoppgave uten filendringer, svar direkte i stedet — ikke rut gjennom planmodus bare for å avslutte den.
- Planen må allerede være skrevet til disk før dette verktøyet kalles. `ExitPlanMode` aksepterer ikke plankroppen som parameter; den leser fra stien rammeverket forventer.
- Hvis brukeren avviser planen, returnerer du til planmodus. Revider basert på tilbakemeldingene og send inn på nytt; ikke begynn å redigere filer mens planen er ugodkjent.
- Godkjenning gir tillatelse til å forlate planmodus og bruke muterende verktøy (`Edit`, `Write`, `Bash` og så videre) for omfanget beskrevet i planen. Utvidelse av omfang i etterkant krever en ny plan eller eksplisitt brukersamtykke.
- Ikke bruk `AskUserQuestion` for å spørre "ser denne planen bra ut?" før du kaller dette verktøyet — å be om plangodkjenning er nøyaktig det `ExitPlanMode` gjør, og brukeren kan ikke se planen før den sendes inn.
- Hold planen minimal og handlingsrettet. En gjennomgangsperson bør kunne skumlese den på under ett minutt og forstå nøyaktig hva som vil endres.
- Hvis du midt i implementeringen innser at planen var feil, stopp og rapporter tilbake til brukeren i stedet for å avvike i stillhet. Å gå inn i planmodus igjen er et gyldig neste steg.
