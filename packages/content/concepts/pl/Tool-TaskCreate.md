# TaskCreate

Tworzy nowe zadanie na liście zadań bieżącego zespołu (lub na liście zadań sesji, gdy żaden zespół nie jest aktywny). Użyj, aby uchwycić elementy pracy, które powinny być śledzone, delegowane lub odwiedzane ponownie później.

## Kiedy używać

- Użytkownik opisuje wieloetapowy element pracy, który korzysta z jawnego śledzenia.
- Rozbijasz duże żądanie na mniejsze, oddzielnie ukańczalne jednostki.
- Odkryto kolejny krok w trakcie zadania i nie powinien zostać zapomniany.
- Potrzebujesz trwałego zapisu intencji przed przekazaniem pracy współpracownikowi lub podagentowi.
- Działasz w trybie planowania i chcesz, aby każdy krok planu był reprezentowany jako konkretne zadanie.

Pomiń `TaskCreate` dla trywialnych, jednorazowych akcji, czystych rozmów lub czegokolwiek, co można ukończyć w dwóch lub trzech bezpośrednich wywołaniach narzędzi.

## Aktywacja

- Dostępne domyślnie na większości modeli.
- Niedostępne na rodzinach Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 i nowszych (v2.1.233+), chyba że włączone przez `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` lub `--tools`.
- Cały system zadań jest wyłączony, gdy `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametry

- `subject` (string, wymagany): Krótki tytuł w trybie rozkazującym, np. `Fix login redirect on Safari`. Utrzymuj poniżej około osiemdziesięciu znaków.
- `description` (string, wymagany): Szczegółowy kontekst — problem, ograniczenia, kryteria akceptacji oraz wszelkie pliki lub linki potrzebne przyszłemu czytelnikowi. Pisz tak, jakby współpracownik miał odebrać to na zimno.
- `activeForm` (string, opcjonalny): Tekst wskaźnika w czasie ciągłym teraźniejszym pokazywany, gdy zadanie jest `in_progress`, np. `Fixing login redirect on Safari`. Odzwierciedla `subject`, ale w formie z -ing.
- `metadata` (obiekt, opcjonalny): Dowolne ustrukturyzowane dane dołączone do zadania. Typowe zastosowania: etykiety, wskazówki priorytetowe, ID ticketów zewnętrznych lub konfiguracja specyficzna dla agenta.

Nowo utworzone zadania zawsze zaczynają ze statusem `pending` i bez właściciela. Zależności (`blocks`, `blockedBy`) nie są ustawiane przy tworzeniu — zastosuj je później za pomocą `TaskUpdate`.

## Przykłady

### Przykład 1

Uchwyć raport błędu, który użytkownik właśnie zgłosił.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### Przykład 2

Podziel epik na śledzone jednostki na początku sesji.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## Uwagi

- Pisz `subject` w trybie rozkazującym, a `activeForm` w czasie ciągłym teraźniejszym, aby interfejs brzmiał naturalnie, gdy zadanie przechodzi do `in_progress`.
- Wywołaj `TaskList` przed utworzeniem, aby uniknąć duplikatów — lista zespołu jest współdzielona ze współpracownikami i podagentami.
- Nie umieszczaj sekretów ani poświadczeń w `description` lub `metadata`; rekordy zadań są widoczne dla każdego z dostępem do zespołu.
- Po utworzeniu przesuwaj zadanie przez jego cykl życia za pomocą `TaskUpdate`. Nie pozostawiaj pracy po cichu porzuconej w `in_progress`.
