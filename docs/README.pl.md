# CC-Viewer

System monitorowania żądań Claude Code, który w czasie rzeczywistym przechwytuje i wizualizuje wszystkie żądania API oraz odpowiedzi Claude Code (surowy tekst, bez cenzury). Ułatwia deweloperom monitorowanie własnego kontekstu, aby móc przeglądać i diagnozować problemy podczas Vibe Coding.

[English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | Polski | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Sposób użycia

### Instalacja

```bash
npm install -g cc-viewer
```

### Uruchomienie i automatyczna konfiguracja

```bash
ccv
```

To polecenie automatycznie wykrywa sposób instalacji lokalnego Claude Code (NPM lub Native Install) i odpowiednio się dostosowuje.

- **Instalacja NPM**: Automatycznie wstrzykuje skrypt przechwytujący do `cli.js` Claude Code.
- **Native Install**: Automatycznie wykrywa plik binarny `claude`, konfiguruje lokalny przezroczysty proxy i ustawia Zsh Shell Hook do automatycznego przekierowywania ruchu.

### Nadpisanie konfiguracji (Configuration Override)

Jeśli potrzebujesz użyć niestandardowego punktu końcowego API (np. proxy firmowego), wystarczy skonfigurować go w `~/.claude/settings.json` lub ustawić zmienną środowiskową `ANTHROPIC_BASE_URL`. `ccv` automatycznie to rozpozna i poprawnie przekaże żądania.

### Tryb cichy (Silent Mode)

Domyślnie `ccv` działa w trybie cichym podczas owijania `claude`, zapewniając czysty wynik terminala zgodny z natywnym doświadczeniem. Wszystkie logi są przechwytywane w tle i można je przeglądać pod adresem `http://localhost:7008`.

Po zakończeniu konfiguracji używaj polecenia `claude` normalnie. Odwiedź `http://localhost:7008`, aby zobaczyć interfejs monitorowania.

### Rozwiązywanie problemów (Troubleshooting)

Jeśli napotkasz problemy z uruchomieniem, istnieje ostateczne rozwiązanie diagnostyczne:
Krok 1: Otwórz Claude Code w dowolnym katalogu;
Krok 2: Wydaj Claude Code następujące polecenie:
```
Zainstalowałem pakiet npm cc-viewer, ale po uruchomieniu ccv nadal nie działa prawidłowo. Sprawdź cli.js i findcc.js w cc-viewer, a następnie dostosuj go do lokalnego sposobu wdrożenia Claude Code zgodnie z konkretnym środowiskiem. Staraj się ograniczyć zakres zmian do pliku findcc.js.
```
Pozwolenie Claude Code na samodzielne sprawdzenie błędów jest skuteczniejsze niż pytanie kogokolwiek lub czytanie jakiejkolwiek dokumentacji!

Po wykonaniu powyższego polecenia plik findcc.js zostanie zaktualizowany. Jeśli Twój projekt często wymaga lokalnego wdrożenia lub rozwidlony kod często wymaga rozwiązywania problemów z instalacją, zachowanie tego pliku wystarczy — następnym razem wystarczy go skopiować. Ponieważ wiele projektów i firm używających Claude Code nie wdraża go na Macu, lecz na serwerach, autor wyodrębnił plik findcc.js, aby ułatwić śledzenie aktualizacji kodu źródłowego cc-viewer.

### Odinstalowanie

```bash
ccv --uninstall
```

### Sprawdzanie wersji

```bash
ccv --version
```

## Funkcje

### Monitorowanie żądań (tryb surowego tekstu)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Przechwytuje w czasie rzeczywistym wszystkie żądania API wysyłane przez Claude Code, zapewniając surowy tekst bez cenzury (to jest ważne!!!)
- Automatycznie identyfikuje i oznacza żądania Main Agent i Sub Agent (podtypy: Bash, Task, Plan, General)
- Żądania MainAgent obsługują Body Diff JSON, zwijając i wyświetlając różnice w stosunku do poprzedniego żądania MainAgent (wyświetlane są tylko zmienione/nowe pola)
- Każde żądanie wyświetla statystyki użycia tokenów inline (tokeny wejściowe/wyjściowe, tworzenie/odczyt pamięci podręcznej, współczynnik trafień)
- Kompatybilny z Claude Code Router (CCR) i innymi scenariuszami proxy — dopasowuje żądania na podstawie wzorca ścieżki API

### Tryb konwersacji

Kliknij przycisk „Tryb konwersacji" w prawym górnym rogu, aby przeanalizować pełną historię konwersacji Main Agent jako interfejs czatu:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Wyświetlanie Agent Team nie jest jeszcze obsługiwane
- Wiadomości użytkownika wyrównane do prawej (niebieskie dymki), odpowiedzi Main Agent wyrównane do lewej (ciemne dymki)
- Bloki `thinking` domyślnie zwinięte, renderowane w Markdown, kliknij aby rozwinąć i zobaczyć proces myślenia; obsługuje tłumaczenie jednym kliknięciem (funkcja jeszcze niestabilna)
- Wiadomości z wyborem użytkownika (AskUserQuestion) wyświetlane w formacie pytanie-odpowiedź
- Dwukierunkowa synchronizacja trybów: przełączenie na tryb konwersacji automatycznie lokalizuje konwersację odpowiadającą wybranemu żądaniu; powrót do trybu surowego tekstu automatycznie lokalizuje wybrane żądanie
- Panel ustawień: możliwość przełączania domyślnego stanu zwinięcia wyników narzędzi i bloków myślenia


### Narzędzia statystyczne

Pływający panel „Statystyki danych" w obszarze nagłówka:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Wyświetla liczbę operacji tworzenia/odczytu pamięci podręcznej oraz współczynnik trafień
- Statystyki przebudowy pamięci podręcznej: wyświetla liczbę wystąpień i tokeny cache_creation pogrupowane według przyczyny (TTL, zmiana system/tools/model, obcięcie/modyfikacja wiadomości, zmiana klucza)
- Statystyki użycia narzędzi: wyświetla częstotliwość wywołań każdego narzędzia posortowaną według liczby wywołań
- Statystyki użycia Skill: wyświetla częstotliwość wywołań każdego Skill posortowaną według liczby wywołań
- Ikona pomocy koncepcyjnej (?): kliknij, aby wyświetlić wbudowaną dokumentację dla MainAgent, CacheRebuild i różnych narzędzi

### Zarządzanie logami

Przez menu rozwijane CC-Viewer w lewym górnym rogu:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Importuj lokalne logi: przeglądaj historyczne pliki logów pogrupowane według projektu, otwierane w nowym oknie
- Wczytaj lokalny plik JSONL: bezpośrednio wybierz lokalny plik `.jsonl` do wczytania (obsługuje do 500MB)
- Zapisz bieżący log jako: pobierz bieżący plik logu monitorowania JSONL
- Scalanie logów: łączenie wielu plików logów JSONL w jedną sesję do ujednoliconej analizy
- Przeglądaj Prompty użytkownika: wyodrębnij i wyświetl wszystkie dane wejściowe użytkownika z trzema trybami widoku — tryb Oryginał (surowa treść), tryb Kontekst (tagi systemowe zwijalne), tryb Tekst (tylko czysty tekst); komendy slash (`/model`, `/context` itp.) wyświetlane jako osobne wpisy; tagi związane z komendami automatycznie ukrywane z treści Promptu
- Eksportuj Prompt do TXT: eksportuj prompty użytkownika (czysty tekst, bez tagów systemowych) do lokalnego pliku `.txt`

### Obsługa wielu języków

CC-Viewer obsługuje 18 języków, automatycznie przełączając się na podstawie ustawień regionalnych systemu:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

### Automatyczna aktualizacja

CC-Viewer automatycznie sprawdza aktualizacje przy uruchomieniu (maksymalnie raz na 4 godziny). W ramach tej samej wersji głównej (np. 1.x.x → 1.y.z) aktualizacje są stosowane automatycznie i obowiązują po ponownym uruchomieniu. Zmiany wersji głównej wyświetlają tylko powiadomienie.

Automatyczna aktualizacja podąża za globalną konfiguracją Claude Code w `~/.claude/settings.json`. Jeśli Claude Code ma wyłączone automatyczne aktualizacje (`autoUpdates: false`), CC-Viewer również je pominie.

## License

MIT
