# Agent

Tworzy autonomicznego podagenta Claude Code z własnym oknem kontekstu, aby obsłużyć wydzielone zadanie i zwrócić pojedynczy skonsolidowany wynik. Jest to kanoniczny mechanizm delegowania otwartych zadań badawczych, pracy równoległej lub współpracy zespołowej.

## Kiedy używać

- Otwarte wyszukiwania, gdy jeszcze nie wiesz, które pliki są istotne, i spodziewasz się wielu rund `Glob`, `Grep` oraz `Read`.
- Równoległa, niezależna praca — uruchom kilku agentów w jednej wiadomości, aby równocześnie zbadać różne obszary.
- Izolowanie głośnej eksploracji od głównej rozmowy, aby kontekst rodzica pozostał zwięzły.
- Delegowanie do wyspecjalizowanego typu podagenta, takiego jak `Explore`, `Plan`, `claude-code-guide` czy `statusline-setup`.
- Tworzenie nazwanego współpracownika w aktywnym zespole do skoordynowanej pracy wieloagentowej.

NIE używaj, gdy docelowy plik lub symbol jest już znany — użyj bezpośrednio `Read`, `Grep` lub `Glob`. Jednoetapowe wyszukiwanie przez `Agent` marnuje pełne okno kontekstu i dodaje opóźnienie.

## Parametry

- `description` (string, wymagany): Krótka 3–5-wyrazowa etykieta opisująca zadanie; wyświetlana w UI i logach.
- `prompt` (string, wymagany): Kompletny, samodzielny opis, który agent wykona. Musi zawierać cały niezbędny kontekst, ograniczenia i oczekiwany format odpowiedzi.
- `subagent_type` (string, opcjonalny): Predefiniowana persona, taka jak `general-purpose`, `Explore`, `Plan`, `claude-code-guide` lub `statusline-setup`. Domyślnie `general-purpose`.
- `run_in_background` (boolean, opcjonalny): Jeśli `true`, agent działa asynchronicznie, a rodzic może kontynuować pracę; wyniki pobierane są później.
- `model` (string, opcjonalny): Nadpisuje model dla tego agenta — `opus`, `sonnet` lub `haiku`. Domyślnie model sesji rodzica.
- `isolation` (string, opcjonalny): Ustaw na `worktree`, aby agent działał w izolowanym worktree git, dzięki czemu jego zapisy w systemie plików nie kolidują z rodzicem.
- `team_name` (string, opcjonalny): Podczas tworzenia w istniejącym zespole identyfikator zespołu, do którego agent dołączy.
- `name` (string, opcjonalny): Adresowalna nazwa współpracownika w zespole, używana jako cel `to` dla `SendMessage`.

## Przykłady

### Przykład 1: Otwarte wyszukiwanie kodu

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### Przykład 2: Równoległe niezależne dochodzenia

Uruchom dwóch agentów w tej samej wiadomości — jeden bada potok kompilacji, drugi przegląda infrastrukturę testową. Każdy ma własne okno kontekstu i zwraca podsumowanie. Grupowanie w jednym bloku wywołań narzędzi uruchamia ich równolegle.

### Przykład 3: Utworzenie współpracownika w działającym zespole

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## Uwagi

- Agenci nie pamiętają wcześniejszych uruchomień. Każde wywołanie zaczyna się od zera, więc `prompt` musi być w pełni samodzielny — uwzględnij ścieżki plików, konwencje, pytanie i dokładny kształt oczekiwanej odpowiedzi.
- Agent zwraca dokładnie jedną końcową wiadomość. Nie może zadawać pytań wyjaśniających w trakcie, więc niejednoznaczność w prompcie przekłada się na zgadywanie w wyniku.
- Uruchamianie wielu agentów równolegle jest znacznie szybsze niż wywołania sekwencyjne, gdy podzadania są niezależne. Grupuj je w jednym bloku wywołań narzędzi.
- Używaj `isolation: "worktree"`, gdy agent ma zapisywać pliki i chcesz przejrzeć zmiany przed scaleniem z głównym drzewem roboczym.
- Preferuj `subagent_type: "Explore"` do rekonesansu tylko do odczytu i `Plan` do prac projektowych; `general-purpose` to wartość domyślna dla zadań mieszanych (odczyt/zapis).
- Agenci w tle (`run_in_background: true`) nadają się do długo trwających zadań; unikaj pollingu w pętli sleep — rodzic jest powiadamiany po zakończeniu.
