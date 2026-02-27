# CC-Viewer

System monitorowania zapytań Claude Code, który przechwytuje i wizualnie wyświetla wszystkie zapytania i odpowiedzi API Claude Code w czasie rzeczywistym (oryginalny tekst, bez przycinania). Ułatwia programistom monitorowanie ich Context w celu przeglądania i rozwiązywania problemów podczas Vibe Coding.

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | Polski | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

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

- **Instalacja NPM**: Automatycznie wstrzykuje skrypty przechwytujące do `cli.js` Claude Code.
- **Native Install**: Automatycznie wykrywa plik binarny `claude`, konfiguruje lokalne przezroczyste proxy i ustawia Zsh Shell Hook do automatycznego przekazywania ruchu.

### Nadpisywanie konfiguracji (Configuration Override)

Jeśli musisz użyć niestandardowego punktu końcowego API (np. korporacyjnego proxy), po prostu skonfiguruj go w `~/.claude/settings.json` lub ustaw zmienną środowiskową `ANTHROPIC_BASE_URL`. `ccv` automatycznie to rozpozna i poprawnie przekaże żądania.

### Tryb cichy (Silent Mode)

Domyślnie `ccv` działa w trybie cichym podczas opakowywania `claude`, zapewniając czystość wyjścia terminala, identyczną z oryginalnym doświadczeniem. Wszystkie logi są przechwytywane w tle i dostępne do podglądu na `http://localhost:7008`.

Po konfiguracji używaj polecenia `claude` jak zwykle. Odwiedź `http://localhost:7008`, aby zobaczyć interfejs monitorowania.

### Rozwiązywanie problemów (Troubleshooting)

- **Mieszane wyjście (Mixed Output)**: Jeśli widzisz logi debugowania `[CC-Viewer]` wymieszane z wyjściem Claude, zaktualizuj do najnowszej wersji (`npm install -g cc-viewer`).
- **Odmowa połączenia (Connection Refused)**: Upewnij się, że proces w tle `ccv` jest uruchomiony. Uruchomienie `ccv` lub `claude` (po zainstalowaniu hooka) powinno uruchomić go automatycznie.
- **Puste ciało (Empty Body)**: Jeśli widzisz "No Body" w Viewerze, może to być spowodowane niestandardowymi formatami SSE. Viewer teraz obsługuje przechwytywanie surowej zawartości jako opcję awaryjną.

### Odinstalowanie

```bash
ccv --uninstall
```

### Sprawdź wersję

```bash
ccv --version
```

## Funkcje

### Monitorowanie zapytań (tryb oryginalnego tekstu)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Przechwytywanie w czasie rzeczywistym wszystkich zapytań API z Claude Code, zapewniając oryginalny tekst, a nie przycięte logi (to jest ważne!!!)
- Automatycznie identyfikuje i oznacza zapytania Main Agent i Sub Agent (podtypy: Bash, Task, Plan, General)
- Żądania MainAgent obsługują Body Diff JSON, wyświetlając zwinięte różnice z poprzednim żądaniem MainAgent (tylko zmienione/dodane pola)
- Statystyki zużycia Token inline dla każdego żądania (tokeny wejściowe/wyjściowe, tworzenie/odczyt cache, współczynnik trafień)
- Kompatybilny z Claude Code Router (CCR) i innymi scenariuszami proxy — żądania są dopasowywane przez wzorzec ścieżki API jako fallback

### Tryb konwersacji

Kliknij przycisk „Tryb konwersacji" w prawym górnym rogu, aby przetworzyć pełną historię konwersacji Main Agent na interfejs czatu:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Nie obsługuje jeszcze wyświetlania Agent Team
- Wiadomości użytkownika wyrównane do prawej (niebieskie dymki), odpowiedzi Main Agent wyrównane do lewej (ciemne dymki)
- Bloki `thinking` domyślnie zwinięte, renderowane w Markdown, kliknij aby rozwinąć i zobaczyć proces myślenia; obsługuje tłumaczenie jednym kliknięciem (funkcja wciąż niestabilna)
- Wiadomości wyboru użytkownika (AskUserQuestion) wyświetlane w formacie pytanie-odpowiedź
- Dwukierunkowa synchronizacja trybów: przełączenie na tryb konwersacji automatycznie lokalizuje odpowiednią konwersację wybranego żądania; przełączenie z powrotem na tryb oryginalnego tekstu automatycznie lokalizuje wybrane żądanie
- Panel ustawień: przełączanie domyślnego stanu zwinięcia wyników narzędzi i bloków myślenia


### Narzędzia statystyczne

Panel „Statystyki danych" wyświetlany po najechaniu w obszarze nagłówka:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Wyświetla liczbę cache creation/read i współczynnik trafień cache
- Statystyki przebudowy cache: pogrupowane według przyczyny (TTL, zmiana system/tools/model, obcięcie/modyfikacja wiadomości, zmiana klucza) z liczbą wystąpień i tokenami cache_creation
- Statystyki użycia narzędzi: wyświetla częstotliwość wywołań każdego narzędzia, posortowane według liczby wywołań
- Statystyki użycia Skill: wyświetla częstotliwość wywołań każdego Skill, posortowane według liczby wywołań
- Ikona pomocy koncepcyjnej (?): kliknij, aby wyświetlić wbudowaną dokumentację MainAgent, CacheRebuild i różnych narzędzi

### Zarządzanie logami

Przez menu rozwijane CC-Viewer w lewym górnym rogu:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Importuj lokalne logi: przeglądaj historyczne pliki logów, pogrupowane według projektu, otwiera w nowym oknie
- Wczytaj lokalny plik JSONL: bezpośrednio wybierz lokalny plik `.jsonl` do wczytania (obsługuje do 500MB)
- Zapisz bieżący log jako: pobierz bieżący plik logu monitorowania JSONL
- Scalanie logów: łączenie wielu plików logów JSONL w jedną sesję do ujednoliconej analizy
- Przeglądaj Prompty użytkownika: wyodrębnij i wyświetl wszystkie dane wejściowe użytkownika z trzema trybami widoku — tryb Oryginał (surowa treść), tryb Kontekst (tagi systemowe zwijalne), tryb Tekst (tylko czysty tekst); komendy slash (`/model`, `/context` itp.) wyświetlane jako osobne wpisy; tagi związane z komendami automatycznie ukrywane z treści Promptu
- Eksportuj Prompt do TXT: eksportuj prompty użytkownika (czysty tekst, bez tagów systemowych) do lokalnego pliku `.txt`

### Obsługa wielu języków

CC-Viewer obsługuje 18 języków, automatycznie przełączając się na podstawie ustawień regionalnych systemu:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
