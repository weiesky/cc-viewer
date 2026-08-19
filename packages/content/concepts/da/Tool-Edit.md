# Edit

Udfører en nøjagtig strengudskiftning inden for en eksisterende fil. Det er den foretrukne måde at ændre filer på, fordi kun diff'en sendes, hvilket holder redigeringer præcise og reviderbare.

## Hvornår skal den bruges

- Rette en fejl i en enkelt funktion uden at omskrive den omgivende fil
- Opdatere en konfigurationsværdi, versionsstreng eller importsti
- Omdøbe et symbol på tværs af en fil med `replace_all`
- Indsætte en blok i nærheden af et anker (udvid `old_string` til at inkludere nærliggende kontekst, og angiv derefter erstatningen)
- Anvende små, velafgrænsede redigeringer som led i en refaktorering i flere trin

## Parametre

- `file_path` (string, påkrævet): Absolut sti til den fil, der skal ændres.
- `old_string` (string, påkrævet): Den eksakte tekst, der skal søges efter. Skal matche tegn for tegn, inklusive mellemrum og indrykning.
- `new_string` (string, påkrævet): Erstatningsteksten. Skal afvige fra `old_string`.
- `replace_all` (boolean, valgfri): Når `true`, erstattes hver forekomst af `old_string`. Standard er `false`, hvilket kræver, at matchet er unikt.

## Eksempler

### Eksempel 1: Ret et enkelt kaldssted
Sæt `old_string` til den eksakte linje `const port = 3000;` og `new_string` til `const port = process.env.PORT ?? 3000;`. Matchet er unikt, så `replace_all` kan forblive på standardværdien.

### Eksempel 2: Omdøb et symbol på tværs af en fil
For at omdøbe `getUser` til `fetchUser` overalt i `api.ts` sættes `old_string: "getUser"`, `new_string: "fetchUser"` og `replace_all: true`.

### Eksempel 3: Disambiguér et gentaget uddrag
Hvis `return null;` forekommer i flere grene, udvides `old_string` til at inkludere omgivende kontekst (for eksempel den foregående `if`-linje), så matchet er unikt. Ellers fejler værktøjet i stedet for at gætte.

## Noter

- Du skal kalde `Read` på filen mindst én gang i den aktuelle session, før `Edit` accepterer ændringer. Linjenummer-præfikser fra `Read`-output er ikke en del af filindholdet; inkludér dem ikke i `old_string` eller `new_string`.
- Mellemrum skal matche nøjagtigt. Vær opmærksom på tabulatorer versus mellemrum og efterstillede mellemrum, især i YAML, Makefiles og Python.
- Hvis `old_string` ikke er unik og `replace_all` er `false`, fejler redigeringen. Udvid enten konteksten eller aktivér `replace_all`.
- Foretræk `Edit` frem for `Write`, når filen allerede findes; `Write` overskriver hele filen og mister urelateret indhold, hvis du ikke er forsigtig.
- Til flere urelaterede redigeringer i samme fil skal du udstede flere `Edit`-kald i rækkefølge i stedet for én stor, skrøbelig erstatning.
- Undgå at indføre emoji, marketingtekst eller uanmodede dokumentationsblokke ved redigering af kildefiler.
