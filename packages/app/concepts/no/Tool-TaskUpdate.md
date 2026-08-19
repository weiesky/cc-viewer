# TaskUpdate

Modifiserer en eksisterende oppgave — dens status, innhold, eierskap, metadata eller avhengighetskanter. Dette er måten oppgaver går gjennom livssyklusen sin og måten arbeid overleveres mellom Claude Code, lagkamerater og underagenter.

## Når skal den brukes

- Overføre en oppgave gjennom statusarbeidsflyten mens du jobber på den.
- Ta en oppgave ved å tildele deg selv (eller en annen agent) som `owner`.
- Raffinere `subject` eller `description` når du lærer mer om problemet.
- Registrere nyoppdagede avhengigheter med `addBlocks` / `addBlockedBy`.
- Legge ved strukturert `metadata` som eksterne ticket-ID-er eller prioritetshint.

## Aktivering

- Tilgjengelig som standard på de fleste modeller.
- Ikke tilgjengelig på Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 og nyere familier (v2.1.233+) med mindre man melder seg på via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` eller `--tools`.
- Hele oppgavesystemet er deaktivert når `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametere

- `taskId` (string, påkrevd): Oppgaven som skal modifiseres. Hent fra `TaskList` eller `TaskCreate`.
- `status` (string, valgfri): En av `pending`, `in_progress`, `completed`, `deleted`.
- `subject` (string, valgfri): Erstatning imperativ tittel.
- `description` (string, valgfri): Erstatning detaljert beskrivelse.
- `activeForm` (string, valgfri): Erstatning presens partisipp spinner-tekst.
- `owner` (string, valgfri): Agent- eller lagkamerathandle som tar ansvar for oppgaven.
- `metadata` (objekt, valgfri): Metadatanøkler som skal slås sammen inn i oppgaven. Sett en nøkkel til `null` for å slette den.
- `addBlocks` (array av strenger, valgfri): Oppgave-ID-er som denne oppgaven blokkerer.
- `addBlockedBy` (array av strenger, valgfri): Oppgave-ID-er som må fullføres før denne.

## Statusarbeidsflyt

Livssyklusen er bevisst lineær: `pending` → `in_progress` → `completed`. `deleted` er terminal og brukes for å trekke tilbake oppgaver som aldri vil bli arbeidet med.

- Sett `in_progress` i det øyeblikket du faktisk begynner arbeidet, ikke før. Kun én oppgave om gangen bør være `in_progress` for en gitt eier.
- Sett `completed` kun når arbeidet er helt ferdig — akseptkriterier oppfylt, tester bestått, utdata skrevet. Hvis en blokker dukker opp, hold oppgaven `in_progress` og legg til en ny oppgave som beskriver hva som må løses.
- Marker aldri en oppgave `completed` når tester feiler, implementeringen er delvis eller du støtte på uløste feil.
- Bruk `deleted` for oppgaver som er kansellert eller duplikat; ikke gjenbruk en oppgave for urelatert arbeid.

## Eksempler

### Eksempel 1

Ta en oppgave og start den.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### Eksempel 2

Avslutt arbeidet og registrer en oppfølgingsavhengighet.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## Notater

- `metadata` slås sammen nøkkel for nøkkel; å sende `null` for en nøkkel fjerner den. Kall `TaskGet` først hvis du er usikker på gjeldende innhold.
- `addBlocks` og `addBlockedBy` legger til kanter; de fjerner ikke eksisterende. Å redigere grafen destruktivt krever en dedikert arbeidsflyt — konsulter team-eieren før du skriver om avhengigheter.
- Hold `activeForm` synkronisert når du endrer `subject` slik at spinner-teksten fortsetter å lese naturlig.
- Ikke marker en oppgave `completed` for å dempe den. Hvis brukeren kansellerte arbeidet, bruk `deleted` med en kort begrunnelse i `description`.
- Les en oppgaves siste tilstand med `TaskGet` før oppdatering — lagkamerater kan ha endret den mellom din siste lesing og din skriving.
