# CC-Viewer

System monitorowania zapytań dla Claude Code, który przechwytuje i wizualizuje wszystkie zapytania i odpowiedzi API w czasie rzeczywistym. Pomaga programistom monitorować ich Context do przeglądania i debugowania podczas Vibe Coding.

[简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Użycie

```bash
npm install -g cc-viewer
```

Po instalacji uruchom:

```bash
ccv
```

Ta komenda automatycznie konfiguruje lokalnie zainstalowane Claude Code do monitorowania i dodaje hook automatycznej naprawy do konfiguracji powłoki (`~/.zshrc` lub `~/.bashrc`). Następnie używaj Claude Code jak zwykle i otwórz `http://localhost:7008` w przeglądarce, aby zobaczyć interfejs monitorowania.

Po aktualizacji Claude Code nie jest wymagane żadne ręczne działanie — przy następnym uruchomieniu `claude` automatycznie wykryje i ponownie skonfiguruje.

### Odinstalowanie

```bash
ccv --uninstall
```

## Funkcje

### Monitorowanie zapytań (Raw Mode)

- Przechwytywanie w czasie rzeczywistym wszystkich zapytań API z Claude Code, w tym odpowiedzi strumieniowych
- Lewy panel pokazuje metodę zapytania, URL, czas trwania i kod statusu
- Automatycznie identyfikuje i oznacza zapytania Main Agent i Sub Agent (podtypy: Bash, Task, Plan, General)
- Prawy panel obsługuje przełączanie zakładek Request / Response
- Request Body domyślnie rozwija `messages`, `system`, `tools` o jeden poziom
- Response Body domyślnie w pełni rozwinięte
- Przełączanie między widokiem JSON a widokiem zwykłego tekstu
- Kopiowanie zawartości JSON jednym kliknięciem
- Żądania MainAgent obsługują Body Diff JSON, wyświetlając zwinięte różnice z poprzednim żądaniem MainAgent (tylko zmienione/dodane pola)
- Podpowiedź Body Diff JSON można zamknąć; po zamknięciu preferencja jest zapisywana po stronie serwera i nigdy więcej nie jest wyświetlana

### Chat Mode

Kliknij przycisk "Chat mode" w prawym górnym rogu, aby przetworzyć pełną historię konwersacji Main Agent na interfejs czatu:

- Wiadomości użytkownika wyrównane do prawej (niebieskie dymki), odpowiedzi Main Agent wyrównane do lewej (ciemne dymki) z renderowaniem Markdown
- Wiadomości `/compact` automatycznie wykrywane i wyświetlane w formie zwiniętej, kliknij aby rozwinąć pełne podsumowanie
- Wyniki wywołań narzędzi wyświetlane inline w odpowiedniej wiadomości Assistant
- Bloki `thinking` domyślnie zwinięte, kliknij aby rozwinąć
- `tool_use` wyświetlane jako kompaktowe karty wywołań narzędzi (Bash, Read, Edit, Write, Glob, Grep, Task mają dedykowane wyświetlanie)
- Wiadomości wyboru użytkownika (AskUserQuestion) wyświetlane w formacie pytanie-odpowiedź
- Tagi systemowe (`<system-reminder>`, `<project-reminder>`, itp.) automatycznie zwinięte
- Tekst systemowy automatycznie filtrowany, pokazuje tylko rzeczywiste dane wejściowe użytkownika
- Wyświetlanie podzielone na wiele sesji (automatycznie segmentowane po `/compact`, `/clear`, itp.)
- Każda wiadomość pokazuje znacznik czasu z dokładnością do sekundy

### Token Stats

Panel po najechaniu w obszarze nagłówka:

- Liczba Token pogrupowana według modelu (wejście/wyjście)
- Liczba tworzenia/odczytów Cache i współczynnik trafień Cache
- Odliczanie wygaśnięcia Cache Main Agent

### Zarządzanie logami

Przez menu rozwijane CC-Viewer w lewym górnym rogu:

- Importuj lokalne logi: przeglądaj historyczne pliki logów, pogrupowane według projektu, otwiera w nowym oknie
- Wczytaj lokalny plik JSONL: bezpośrednio wybierz i wczytaj lokalny plik `.jsonl` (do 200MB)
- Pobierz bieżący log: pobierz bieżący plik logu monitorowania JSONL
- Eksportuj prompty użytkownika: wyodrębnij i wyświetl wszystkie dane wejściowe użytkownika, z tagami XML (system-reminder itp.) zwijanymi; komendy slash (`/model`, `/context` itp.) wyświetlane jako osobne wpisy; tagi związane z komendami automatycznie ukrywane z treści promptu
- Eksportuj prompty do TXT: eksportuj prompty użytkownika (tylko tekst, bez tagów systemowych) do lokalnego pliku `.txt`

### Obsługa wielu języków

CC-Viewer obsługuje 18 języków, automatycznie przełączając się na podstawie ustawień regionalnych systemu:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
