# ReportFindings

Raportuj ustalenia przeglądu kodu jako typizowaną, strukturalną listę, którą interfejs użytkownika hosta renderuje natywnie — zamiast drukować je jako tekst czatu.

## Kiedy używać

- Zakończenie przeglądu kodu, którego aktywne instrukcje wyraźnie mówią o raportowaniu ustaleń za pomocą tego narzędzia
- Ponowne raportowanie po zastosowaniu poprawek, gdy instrukcje zastosowania przeglądu o to proszą (każde ustalenie nosi wtedy `outcome`)
- **Nie** do ad hoc opinii, zwykłych odpowiedzi lub przeglądów, których instrukcje określają inny format wyjścia — i nigdy razem z duplikacją tekstową tych samych ustaleń

## Parametry

- `findings` (tablica, wymagane, maks 32): Zweryfikowane ustalenia, uporządkowane od najpoważniejszych — pusta tablica, jeśli żadne nie przeszły weryfikacji. Każde ustalenie:
  - `file` (ciąg znaków, wymagane): Ścieżka względna repozytorium.
  - `line` (liczba, opcjonalnie): Linia kotwicy 1-indeksowana.
  - `summary` (ciąg znaków, wymagane): Jedno-zdaniowe stwierdzenie defektu.
  - `failure_scenario` (ciąg znaków, wymagane): Konkretne wejście/stan → nieprawidłowe wyjście lub awaria.
  - `category` (ciąg znaków, opcjonalnie): Krótki slug w stylu kebab-case, np. `correctness`, `simplification`, `efficiency`, `test-coverage`.
  - `verdict` (ciąg znaków, opcjonalnie): `CONFIRMED` lub `PLAUSIBLE` — ustawione po uruchomieniu przejścia weryfikacji; nieobecne w przeglądach tylko wbudowanych.
  - `outcome` (ciąg znaków, opcjonalnie): TYLKO podczas ponownego raportowania po poprawkach — `fixed`, `skipped`, lub `no_change_needed`.
- `level` (ciąg znaków, opcjonalnie): Poziom wysiłku, na którym przegląd był uruchamiany — `low`, `medium`, `high`, `xhigh`, lub `max`.

## Uwagi

- **Zadzwoń raz.** Jedno wywołanie z kompletną, zweryfikowaną, upriorytyzowaną listą — nie jedno wywołanie na ustalenie.
- **Pusta jest prawidłowym wynikiem.** Jeśli żadne ustalenie nie przeszło weryfikacji, zaraportuj pustą tablicę zamiast wypełniać słabymi ustaleniami.
- **Nie powielaj w tekście.** Kiedy to narzędzie raportuje wyniki, ustalenia nie mogą być również drukowane jako wiadomość czatu.
- **`outcome` tylko do ponownego raportowania.** Przy pierwszym raporcie pozostawić go nieustawiony; po przejściu zastosowania ustaw, co faktycznie się stało z każdym ustaleniem.
