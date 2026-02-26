# CC-Viewer

System monitorowania zapytań dla Claude Code, który przechwytuje i wizualizuje wszystkie zapytania i odpowiedzi API w czasie rzeczywistym. Pomaga programistom monitorować ich Context do przeglądania i debugowania podczas Vibe Coding.

[简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Użycie

### Instalacja

```bash
npm install -g cc-viewer
```

### Uruchomienie i automatyczna konfiguracja

```bash
ccv
```

To polecenie automatycznie wykrywa metodę instalacji lokalnego Claude Code (NPM lub Native Install) i dostosowuje się odpowiednio.

- **NPM Install**: Automatycznie wstrzykuje skrypty przechwytujące do `cli.js` Claude Code.
- **Native Install**: Automatycznie wykrywa plik binarny `claude`, konfiguruje lokalne przezroczyste proxy i ustawia Zsh Shell Hook do automatycznego przekazywania ruchu.

### Nadpisywanie konfiguracji (Configuration Override)

Jeśli musisz użyć niestandardowego punktu końcowego API (np. korporacyjnego proxy), po prostu skonfiguruj go w `~/.claude/settings.json` lub ustaw zmienną środowiskową `ANTHROPIC_BASE_URL`. `ccv` automatycznie to rozpozna i poprawnie przekaże żądania.

### Tryb cichy (Silent Mode)

Domyślnie `ccv` działa w trybie cichym podczas uruchamiania `claude`, zapewniając czystość wyjścia terminala, identyczną z oryginalnym doświadczeniem Claude Code. Wszystkie logi są przechwytywane w tle i dostępne do podglądu na `http://localhost:7008`.

Po konfiguracji używaj polecenia `claude` jak zwykle. Odwiedź `http://localhost:7008`, aby zobaczyć interfejs monitorowania.

### Rozwiązywanie problemów (Troubleshooting)

- **Mieszane wyjście (Mixed Output)**: Jeśli widzisz logi debugowania `[CC-Viewer]` wymieszane z wyjściem Claude, zaktualizuj do najnowszej wersji (`npm install -g cc-viewer`).
- **Odmowa połączenia (Connection Refused)**: Upewnij się, że proces w tle `ccv` jest uruchomiony. Uruchomienie `ccv` lub `claude` (po zainstalowaniu hooka) powinno uruchomić go automatycznie.
- **Puste ciało (Empty Body)**: Jeśli widzisz "No Body" w Viewerze, może to być spowodowane niestandardowymi formatami SSE. Viewer teraz obsługuje przechwytywanie surowej zawartości jako opcję awaryjną.

### Sprawdź wersję (Check Version)

```bash
ccv --version
```

### Odinstalowanie

```bash
ccv --uninstall
```

## Funkcje

### Monitorowanie zapytań (Raw Mode)

- Przechwytywanie w czasie rzeczywistym wszystkich zapytań API z Claude Code, w tym odpowiedzi strumieniowych
- Lewy panel pokazuje metodę zapytania, URL, czas trwania i kod statusu
- Automatycznie identyfikuje i oznacza zapytania Main Agent i Sub Agent (podtypy: Bash, Task, Plan, General)
- Lista zapytań automatycznie przewija się do wybranego elementu (wyśrodkowany przy przełączaniu trybu, najbliższy przy ręcznym kliknięciu)
- Prawy panel obsługuje przełączanie zakładek Request / Response
- Request Body domyślnie rozwija `messages`, `system`, `tools` o jeden poziom
- Response Body domyślnie w pełni rozwinięte
- Przełączanie między widokiem JSON a widokiem zwykłego tekstu
- Kopiowanie zawartości JSON jednym kliknięciem
- Żądania MainAgent obsługują Body Diff JSON, wyświetlając zwinięte różnice z poprzednim żądaniem MainAgent (tylko zmienione/dodane pola)
- Sekcja Diff obsługuje przełączanie widoku JSON/Text oraz kopiowanie jednym kliknięciem
- Ustawienie „Expand Diff": po włączeniu żądania MainAgent automatycznie rozwijają sekcję diff
- Podpowiedź Body Diff JSON można zamknąć; po zamknięciu preferencja jest zapisywana po stronie serwera i nigdy więcej nie jest wyświetlana
- Wrażliwe nagłówki (`x-api-key`, `authorization`) są automatycznie maskowane w plikach logów JSONL, aby zapobiec wyciekowi poświadczeń
- Statystyki zużycia Token inline dla każdego żądania (tokeny wejściowe/wyjściowe, tworzenie/odczyt cache, współczynnik trafień)
- Kompatybilny z Claude Code Router (CCR) i innymi konfiguracjami proxy — żądania są dopasowywane przez wzorzec ścieżki API jako fallback

### Chat Mode

Kliknij przycisk "Chat mode" w prawym górnym rogu, aby przetworzyć pełną historię konwersacji Main Agent na interfejs czatu:

- Wiadomości użytkownika wyrównane do prawej (niebieskie dymki), odpowiedzi Main Agent wyrównane do lewej (ciemne dymki) z renderowaniem Markdown
- Wiadomości `/compact` automatycznie wykrywane i wyświetlane w formie zwiniętej, kliknij aby rozwinąć pełne podsumowanie
- Wyniki wywołań narzędzi wyświetlane inline w odpowiedniej wiadomości Assistant
- Bloki `thinking` domyślnie zwinięte, renderowane jako Markdown, kliknij aby rozwinąć; obsługa tłumaczenia jednym kliknięciem
- `tool_use` wyświetlane jako kompaktowe karty wywołań narzędzi (Bash, Read, Edit, Write, Glob, Grep, Task mają dedykowane wyświetlanie)
- Wyniki narzędzi Task (SubAgent) renderowane jako Markdown
- Wiadomości wyboru użytkownika (AskUserQuestion) wyświetlane w formacie pytanie-odpowiedź
- Tagi systemowe (`<system-reminder>`, `<project-reminder>`, itp.) automatycznie zwinięte
- Wiadomości o załadowaniu Skill automatycznie wykrywane i zwijane, wyświetlając nazwę Skill; kliknij, aby rozwinąć pełną dokumentację (renderowanie Markdown)
- Skills reminder wykrywane automatycznie i zwijane
- Tekst systemowy automatycznie filtrowany, pokazuje tylko rzeczywiste dane wejściowe użytkownika
- Wyświetlanie podzielone na wiele sesji (automatycznie segmentowane po `/compact`, `/clear`, itp.)
- Każda wiadomość pokazuje znacznik czasu z dokładnością do sekundy, wyznaczony na podstawie czasu żądania API
- Każda wiadomość zawiera link „Pokaż żądanie" umożliwiający przejście do trybu raw przy odpowiednim żądaniu API
- Dwukierunkowa synchronizacja trybów: przełączenie na tryb czatu przewija do konwersacji odpowiadającej wybranemu żądaniu; przełączenie z powrotem przewija do wybranego żądania
- Panel ustawień: przełączanie domyślnego stanu zwinięcia wyników narzędzi i bloków myślenia
- Ustawienia globalne: przełączanie filtrowania nieistotnych żądań (count_tokens, heartbeat)

### Tłumaczenie

- Bloki thinking i wiadomości Assistant obsługują tłumaczenie jednym kliknięciem
- Oparte na Claude Haiku API, używa wyłącznie uwierzytelniania `x-api-key` (tokeny sesji OAuth są wykluczone, aby zapobiec zanieczyszczeniu kontekstu)
- Automatycznie przechwytuje nazwę modelu haiku z żądań mainAgent; domyślnie `claude-haiku-4-5-20251001`
- Wyniki tłumaczenia są automatycznie buforowane; kliknij ponownie, aby przełączyć na tekst oryginalny
- Animacja ładowania podczas tłumaczenia
- Ikona (?) obok nagłówka `authorization` w szczegółach żądania prowadzi do dokumentu koncepcyjnego o zanieczyszczeniu kontekstu

### Token Stats

Panel po najechaniu w obszarze nagłówka:

- Liczba Token pogrupowana według modelu (wejście/wyjście)
- Liczba tworzenia/odczytów Cache i współczynnik trafień Cache
- Statystyki przebudowy cache pogrupowane według przyczyny (TTL, zmiana system/tools/model, obcięcie/modyfikacja wiadomości, zmiana klucza) z liczbą wystąpień i tokenami cache_creation
- Statystyki użycia narzędzi: liczba wywołań na narzędzie, posortowane według częstotliwości
- Statystyki użycia Skill: częstotliwość wywołań na Skill, posortowane według częstotliwości
- Ikony pomocy koncepcyjnej (?): kliknij, aby wyświetlić wbudowaną dokumentację MainAgent, CacheRebuild i każdego narzędzia
- Odliczanie wygaśnięcia Cache Main Agent

### Zarządzanie logami

Przez menu rozwijane CC-Viewer w lewym górnym rogu:

- Importuj lokalne logi: przeglądaj historyczne pliki logów, pogrupowane według projektu, otwiera w nowym oknie
- Wczytaj lokalny plik JSONL: bezpośrednio wybierz i wczytaj lokalny plik `.jsonl` (do 500MB)
- Pobierz bieżący log: pobierz bieżący plik logu monitorowania JSONL
- Scalanie logów: łączenie wielu plików logów JSONL w jedną sesję do ujednoliconej analizy
- Przeglądaj Prompty użytkownika: wyodrębnij i wyświetl wszystkie dane wejściowe użytkownika w trzech trybach widoku — tryb Oryginał (surowa treść), tryb Kontekst (tagi systemowe zwijalne), tryb Tekst (tylko czysty tekst); komendy slash (`/model`, `/context` itp.) wyświetlane jako osobne wpisy; tagi związane z komendami automatycznie ukrywane z treści Promptu
- Eksportuj prompty do TXT: eksportuj prompty użytkownika (tylko tekst, bez tagów systemowych) do lokalnego pliku `.txt`

### Obsługa wielu języków

CC-Viewer obsługuje 18 języków, automatycznie przełączając się na podstawie ustawień regionalnych systemu:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
