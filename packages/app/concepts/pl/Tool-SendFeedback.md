# SendFeedback

Wysyła ustrukturyzowaną opinię o Claude Code do Anthropic — zgłoszenia błędów, pomysły na funkcje lub brakujące możliwości — bez opuszczania sesji.

## Kiedy używać

- Użytkownik prosi o zgłoszenie błędu lub wysłanie opinii o samym Claude Code.
- Natrafiasz na wyraźny defekt produktu (uszkodzona komenda, błędne zachowanie, awaria) wart zgłoszenia.
- Użytkownik opisuje funkcję, którą chciałby, żeby istniała (pomysł lub brakująca możliwość).

## Parametry

- `type` (string, wymagany): Jedna z wartości `bug`, `idea`, `missing_capability`.
- `title` (string, wymagany): Krótkie, konkretne jednowierszowe podsumowanie problemu.
- `details` (string, wymagany): Oznakowane punktorami, w kolejności: **What happened:** (zaobserwowane vs oczekiwane, dokładny tekst błędu, jeśli jest krótki); **What the user said:** (cytat lub "User didn't comment; observed by the model."); **Repro:** (minimalne kroki); **Evidence:** (identyfikatory żądań, znaczniki czasu, ścieżki, wersje — pomiń, jeśli brak); opcjonalnie na końcu **Cause:** tylko jeśli zweryfikowane w trakcie sesji. Od jednej do trzech linii na punktor; bez akapitów narracyjnych, bez spekulacji, bez sekretów.
- `area` (string, opcjonalny): Krótki tag nazywający część Claude Code, której dotyczy zgłoszenie (np. "hooks config", "/help", "file editing"). Pozostaw puste, jeśli niejasne.
- `failure_mode` (string, opcjonalny): Dla raportów o zachowaniu modelu najbliższy tryb awarii (np. `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short` lub `other`). Pomiń tylko wtedy, gdy raport dotyczy czysto produktowego błędu narzędzia.
- `task_category` (string, opcjonalny): Co robiła sesja, gdy wystąpił problem: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review` lub `other`.

## Przykłady

### Przykład 1: Zgłoszenie błędu produktu

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## Uwagi

- Nigdy nie umieszczaj w `details` sekretów, tokenów ani prywatnych danych użytkownika.
- Cytuj słowa użytkownika, gdy są dostępne; w przeciwnym razie wskaż, że problem zaobserwował model.
- Utrzymuj raport rzeczowy — spekulacje na temat przyczyny źródłowej należą do `**Cause:**` tylko wtedy, gdy zostały zweryfikowane w trakcie sesji.
