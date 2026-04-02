# CC-Viewer

System monitorowania żądań Claude Code — przechwytuje i wizualizuje w czasie rzeczywistym wszystkie żądania i odpowiedzi API Claude Code (oryginalny tekst, bez cenzury). Pomaga programistom monitorować własny Context, ułatwiając przegląd i diagnozowanie problemów podczas Vibe Coding.
Najnowsza wersja CC-Viewer oferuje również rozwiązanie do programowania webowego na serwerze oraz narzędzia do programowania mobilnego. Zapraszamy do stosowania w swoich projektach — w przyszłości zostanie udostępnionych więcej funkcji wtyczek z obsługą wdrożeń w chmurze.

Zacznijmy od ciekawej części — oto co możesz zobaczyć na urządzeniu mobilnym:

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | Polski | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Użycie

### Instalacja

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Tryb programowania

ccv jest bezpośrednim zamiennikiem claude — wszystkie argumenty są przekazywane do claude, a jednocześnie uruchamiany jest Web Viewer.

```bash
ccv                    # == claude (tryb interaktywny)
ccv -c                 # == claude --continue (kontynuuj ostatnią rozmowę)
ccv -r                 # == claude --resume (wznów rozmowę)
ccv -p "hello"         # == claude --print "hello" (tryb drukowania)
ccv --d                # == claude --dangerously-skip-permissions (skrót)
ccv --model opus       # == claude --model opus
```

Najczęściej używana komenda autora to
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

Po uruchomieniu trybu programowania strona internetowa otwiera się automatycznie.

Możesz używać claude bezpośrednio w przeglądarce, przeglądać pełne treści żądań oraz sprawdzać zmiany w kodzie.

A co najlepsze — możesz nawet programować na urządzeniu mobilnym!


### Tryb logowania

⚠️ Jeśli nadal wolisz używać natywnych narzędzi claude lub wtyczki VS Code, skorzystaj z tego trybu.

W tym trybie uruchom ```claude``` lub ```claude --dangerously-skip-permissions```

Automatycznie zostanie uruchomiony proces logowania, który zapisuje logi żądań do ~/.claude/cc-viewer/*twojprojekt*/date.jsonl

Uruchomienie trybu logowania:
```bash
ccv -logger
```

Gdy konsola nie może wydrukować konkretnego portu, domyślny pierwszy port to 127.0.0.1:7008. Przy wielu instancjach kolejne porty to 7009, 7010 itd.

Polecenie automatycznie wykrywa sposób instalacji Claude Code (NPM lub Native Install) i odpowiednio się dostosowuje.

- **Wersja NPM claude code**: automatycznie wstrzykuje skrypt przechwytujący do `cli.js` Claude Code.
- **Natywna wersja claude code**: automatycznie wykrywa plik binarny `claude`, konfiguruje lokalny przezroczysty proxy i ustawia Zsh Shell Hook do automatycznego przekierowania ruchu.
- Projekt zaleca instalację claude code przez npm.

Odinstalowanie trybu logowania:
```bash
ccv --uninstall
```

### Rozwiązywanie problemów (Troubleshooting)

Jeśli napotkasz problemy z uruchomieniem, oto ostateczne rozwiązanie:
Krok 1: Otwórz claude code w dowolnym katalogu;
Krok 2: Wydaj claude code następujące polecenie:
```
Zainstalowałem pakiet npm cc-viewer, ale po uruchomieniu ccv nadal nie działa poprawnie. Sprawdź cli.js i findcc.js w cc-viewer i dostosuj je do lokalnego sposobu wdrożenia claude code w tym środowisku. Ogranicz zakres zmian do pliku findcc.js.
```
Pozwolenie Claude Code na samodzielne sprawdzenie błędów jest skuteczniejsze niż konsultowanie się z kimkolwiek lub czytanie dokumentacji!

Po wykonaniu powyższego polecenia plik findcc.js zostanie zaktualizowany. Jeśli Twój projekt często wymaga lokalnego wdrożenia lub rozwidlony kod często wymaga rozwiązywania problemów instalacyjnych, zachowaj ten plik — następnym razem wystarczy go skopiować. Ponieważ wiele projektów i firm używa claude code na serwerach, a nie na Macu, autor wyodrębnił plik findcc.js, aby ułatwić śledzenie aktualizacji kodu źródłowego cc-viewer.

### Inne polecenia pomocnicze

Pomoc:
```bash
ccv -h
```

### Nadpisanie konfiguracji (Configuration Override)

Jeśli potrzebujesz użyć niestandardowego punktu końcowego API (np. proxy firmowego), skonfiguruj go w `~/.claude/settings.json` lub ustaw zmienną środowiskową `ANTHROPIC_BASE_URL`. `ccv` automatycznie to rozpozna i poprawnie przekaże żądania.

### Tryb cichy (Silent Mode)

Domyślnie `ccv` działa w trybie cichym podczas owijania `claude`, zapewniając czysty wynik terminala zgodny z natywnym doświadczeniem. Wszystkie logi są przechwytywane w tle i dostępne pod adresem `http://localhost:7008`.

Po konfiguracji używaj normalnie polecenia `claude`. Odwiedź `http://localhost:7008`, aby zobaczyć interfejs monitorowania.


## Funkcje


### Tryb programowania

Po uruchomieniu za pomocą ccv zobaczysz:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


Możesz bezpośrednio przeglądać diff kodu po zakończeniu edycji:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Choć możesz otwierać pliki i programować ręcznie, nie jest to zalecane — to metoda z poprzedniej epoki!

### Programowanie mobilne

Możesz nawet zeskanować kod QR i programować na urządzeniu mobilnym:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

Spełnia Twoje wyobrażenia o programowaniu mobilnym. Dostępny jest również mechanizm wtyczek — jeśli chcesz dostosować go do swoich nawyków programistycznych, możesz śledzić aktualizacje hooków wtyczek.

### Tryb logowania (przeglądanie pełnej sesji claude code)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Przechwytuje w czasie rzeczywistym wszystkie żądania API wysyłane przez Claude Code — zapewnia oryginalny tekst, a nie ocenzurowane logi (to bardzo ważne!!!)
- Automatycznie identyfikuje i oznacza żądania Main Agent i Sub Agent (podtypy: Plan, Search, Bash)
- Żądania MainAgent obsługują Body Diff JSON — zwinięty widok różnic względem poprzedniego żądania MainAgent (wyświetla tylko zmienione/nowe pola)
- Statystyki użycia Token wyświetlane inline przy każdym żądaniu (Token wejściowe/wyjściowe, tworzenie/odczyt cache, współczynnik trafień)
- Kompatybilny z Claude Code Router (CCR) i innymi scenariuszami proxy — dopasowuje żądania na podstawie wzorca ścieżki API

### Tryb rozmowy

Kliknij przycisk "Tryb rozmowy" w prawym górnym rogu, aby przetworzyć pełną historię rozmów Main Agent w interfejs czatu:

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Wyświetlanie Agent Team nie jest jeszcze obsługiwane
- Wiadomości użytkownika wyrównane do prawej (niebieskie dymki), odpowiedzi Main Agent wyrównane do lewej (ciemne dymki)
- Bloki `thinking` domyślnie zwinięte, renderowane w Markdown — kliknij, aby rozwinąć i zobaczyć proces myślenia; obsługuje tłumaczenie jednym kliknięciem (funkcja niestabilna)
- Wiadomości z wyborem użytkownika (AskUserQuestion) wyświetlane w formacie pytanie-odpowiedź
- Dwukierunkowa synchronizacja trybów: przełączenie na tryb rozmowy automatycznie lokalizuje rozmowę odpowiadającą wybranemu żądaniu; powrót do trybu oryginalnego automatycznie lokalizuje wybrane żądanie
- Panel ustawień: możliwość przełączania domyślnego stanu zwinięcia wyników narzędzi i bloków myślenia
- Przeglądanie rozmów na telefonie: w trybie CLI na telefonie kliknij przycisk "Przeglądanie rozmów" na górnym pasku, aby wysunąć widok rozmowy tylko do odczytu i przeglądać pełną historię rozmów na telefonie

### Narzędzia statystyczne

Pływający panel "Statystyki danych" w obszarze nagłówka:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- Wyświetla liczbę operacji cache creation/read oraz współczynnik trafień cache
- Statystyki przebudowy cache: pogrupowane według przyczyny (TTL, zmiany system/tools/model, obcięcie/modyfikacja wiadomości, zmiana klucza) — liczba wystąpień i tokeny cache_creation
- Statystyki użycia narzędzi: częstotliwość wywołań poszczególnych narzędzi posortowana według liczby wywołań
- Statystyki użycia Skill: częstotliwość wywołań poszczególnych Skill posortowana według liczby wywołań
- Obsługa statystyk teammate
- Ikona pomocy kontekstowej (?): kliknij, aby zobaczyć wbudowaną dokumentację MainAgent, CacheRebuild i poszczególnych narzędzi

### Zarządzanie logami

Przez menu rozwijane CC-Viewer w lewym górnym rogu:
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**Kompresja logów**
W kwestii logów autor chciałby podkreślić, że oficjalne definicje Anthropic nie zostały w żaden sposób zmienione, co gwarantuje integralność logów.
Jednakże, ponieważ pojedyncze logi z 1M opus w późniejszych fazach stają się niezwykle duże, dzięki optymalizacjom logów MainAgent zastosowanym przez autora, rozmiar został zredukowany o co najmniej 66% bez użycia gzip.
Metodę parsowania tych skompresowanych logów można wyciągnąć z bieżącego repozytorium.

### Więcej praktycznych i przydatnych funkcji

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

Możesz szybko znaleźć swoje prompty za pomocą narzędzi w panelu bocznym

--- 

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

Ciekawy KV-Cache-Text pozwala zobaczyć, co widzi Claude

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

Możesz przesyłać obrazy i opisywać swoje potrzeby. Claude ma niezwykle silne możliwości rozumienia obrazów. Co więcej, możesz zrobić zrzut ekranu i wkleić go bezpośrednio za pomocą Ctrl + V, a rozmowa wyświetli pełną treść

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

Możesz bezpośrednio dostosowywać wtyczki, zarządzać wszystkimi procesami CC-Viewer, a CC-Viewer oferuje możliwość hot-swap interfejsów firm trzecich (tak, możesz używać GLM, Kimi, MiniMax, Qwen, DeepSeek — choć autor uważa, że obecnie są one dość słabe)

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

Więcej funkcji czeka na odkrycie... np.: System obsługuje Agent Team i ma wbudowany Code Reviewer. Integracja z Codex Code Reviewer jest tuż za rogiem (autor gorąco poleca używanie Codex do code review kodu Claude Code)


### Automatyczne aktualizacje

CC-Viewer automatycznie sprawdza aktualizacje przy uruchomieniu (maksymalnie raz na 4 godziny). W ramach tej samej głównej wersji (np. 1.x.x → 1.y.z) aktualizacje są stosowane automatycznie i wchodzą w życie przy następnym uruchomieniu. Aktualizacje między głównymi wersjami wyświetlają tylko powiadomienie.

Automatyczne aktualizacje są zgodne z globalną konfiguracją Claude Code `~/.claude/settings.json`. Jeśli Claude Code ma wyłączone automatyczne aktualizacje (`autoUpdates: false`), CC-Viewer również pominie automatyczne aktualizacje.

### Obsługa wielu języków

CC-Viewer obsługuje 18 języków i automatycznie przełącza się na podstawie języka systemu:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## Licencja

MIT
