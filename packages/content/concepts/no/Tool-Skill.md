# Skill

Påkaller en navngitt skill i gjeldende samtale. Skills er forhåndspakkede kapabilitetspakker — domenekunnskap, arbeidsflyter og noen ganger verktøytilgang — som rammeverket eksponerer til assistenten gjennom systempåminnelser.

## Når skal den brukes

- Brukeren skriver en slash-kommando som `/review` eller `/init` — slash-kommandoer er skills og må kjøres gjennom dette verktøyet.
- Brukeren beskriver en oppgave som matcher en annonsert skills utløserbetingelser (for eksempel å be om å skanne transkripsjoner for gjentatte tillatelsesspørsmål matcher `fewer-permission-prompts`).
- En skills uttalte formål er et direkte treff for gjeldende fil, forespørsel eller samtalekontekst.
- Spesialiserte, gjentakbare arbeidsflyter er tilgjengelige som skills og den kanoniske prosedyren er å foretrekke fremfor en ad hoc-tilnærming.
- Brukeren spør "hvilke skills er tilgjengelige" — list de annonserte navnene, og påkall kun når de bekrefter.

## Parametere

- `skill` (string, påkrevd): Det eksakte navnet på en skill som er listet i gjeldende available-skills-systempåminnelse. For plugin-navneromsformede skills, bruk den fullt kvalifiserte `plugin:skill`-formen (for eksempel `skill-creator:skill-creator`). Ikke inkluder ledende skråstrek.
- `args` (string, valgfri): Fritekstargumenter som sendes til skillen. Format og semantikk er definert av hver skills egen dokumentasjon.

## Eksempler

### Eksempel 1: Kjør en review-skill på gjeldende branch

```
Skill(skill="review")
```

`review`-skillen pakker trinnene for å gjennomgå en pull request mot gjeldende base-branch. Å påkalle den laster den rammeverks-definerte gjennomgangsprosedyren inn i turen.

### Eksempel 2: Påkall en plugin-navneromsformet skill med argumenter

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Ruter forespørselen gjennom `skill-creator`-pluginens inngangspunkt slik at forfatterarbeidsflyten starter.

## Notater

- Påkall kun skills hvis navn vises ordrett i available-skills-systempåminnelsen, eller skills brukeren skrev direkte som `/name` i meldingen sin. Gjett aldri på eller finn opp skill-navn fra minne eller treningsdata — hvis skillen ikke er annonsert, ikke kall dette verktøyet.
- Når en brukers forespørsel matcher en annonsert skill, er det å kalle `Skill` en blokkerende forutsetning: påkall den før du genererer noe annet svar om oppgaven. Ikke beskriv hva skillen ville gjort — kjør den.
- Nevn aldri en skill ved navn uten faktisk å påkalle den. Å kunngjøre en skill uten å kalle verktøyet er villedende.
- Ikke bruk `Skill` for innebygde CLI-kommandoer som `/help`, `/clear`, `/model` eller `/exit`. Disse håndteres av rammeverket direkte.
- Ikke kall på nytt en skill som allerede kjører i gjeldende tur. Hvis du ser en `<command-name>`-tag i gjeldende tur, har skillen allerede blitt lastet — følg instruksjonene i stedet for å kalle verktøyet på nytt.
- Hvis flere skills kan gjelde, velg den mest spesifikke. For konfigurasjonsendringer som å legge til tillatelser eller hooks, foretrekk `update-config` fremfor en generisk settings-tilnærming.
- Skill-kjøring kan introdusere nye systempåminnelser, verktøy eller begrensninger for resten av turen. Les gjennom samtaletilstanden på nytt etter at en skill fullføres før du fortsetter.
