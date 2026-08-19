# CC-Viewer

🌐 **Strona i przegląd funkcji: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — dostępne w 18 językach.


Zestaw narzędzi Vibe Coding wydestylowany z własnego doświadczenia programistycznego i zbudowany na Claude Code:

1. Podnieś pułap możliwości: uruchamiaj /ultraPlan i /ultraReview lokalnie, dzięki czemu kod twojego projektu nigdy nie jest w pełni eksponowany na chmurę Claude;
2. Wsparcie wieloplatformowe: umożliwia programowanie mobilne (w sieci lokalnej); wersja webowa dostosowuje się do różnych scenariuszy, łatwo osadza się w rozszerzeniach przeglądarek i podzielonym ekranie systemu operacyjnego, oraz dostarcza natywny instalator;
3. Pełne logowanie: zapewnia kompleksowe przechwytywanie i analizę payloadów Claude Code — idealne do logowania, debugowania, nauki, inspiracji i inżynierii wstecznej;
4. Dzielenie się nauką i doświadczeniem: zebrano wiele materiałów dydaktycznych i doświadczeń programistycznych (patrz symbole „?" rozsiane po systemie);
5. Zachowane natywne doświadczenie: jedynie rozszerza możliwości Claude Code bez istotnych modyfikacji jądra — natywne doświadczenie zostaje zachowane;
6. Wsparcie modeli zewnętrznych: kompatybilny z deepseek-v4-\*, GLM 5.1, Kimi K2.6, z wbudowaną funkcją cc-switch umożliwiającą hot-switching pomiędzy narzędziami zewnętrznymi w dowolnym momencie; okno hot-switch obsługuje także źródła per rola — Main Agent, Sub-Agents i Teammates mogą korzystać z różnych profili proxy (domyślnie: podążaj za Main Agent); gdy Main Agent używa wbudowanego Default z oficjalnym endpointem, przypisanie ról pozostaje ukryte i uśpione.

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | Polski | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Użycie

### Wymagania wstępne

* Upewnij się, że masz zainstalowane Node.js 20.0.0+; [Pobierz i zainstaluj](https://nodejs.org)
* Upewnij się, że masz zainstalowane Claude Code; [Instrukcja instalacji](https://github.com/anthropics/claude-code)

### Instalacja ccv

#### Instalacja przez npm

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### Instalacja przez Homebrew (zalecane dla macOS / Linux)

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # użyj tego do aktualizacji — NIE używaj npm install -g do aktualizacji ccv zainstalowanego przez brew
```

#### Instalacja przez pnpm (globalnie)

```bash
pnpm add -g cc-viewer
pnpm add -g cc-viewer@latest   # użyj tego do aktualizacji — NIE używaj npm install -g do aktualizacji ccv zainstalowanego przez pnpm
```

### Jak uruchomić

ccv jest bezpośrednim zamiennikiem claude — wszystkie argumenty są przekazywane do claude, jednocześnie uruchamiając Web Viewer.

```bash
ccv                    # == claude (tryb interaktywny)
```

Komenda, której autor używa najczęściej, to:

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv przekazuje wszystkie parametry startowe Claude Code — możesz dowolnie je łączyć
```

Po uruchomieniu trybu programowania automatycznie otwiera się strona internetowa.

cc-viewer jest również dostarczany jako natywna aplikacja desktopowa: [Strona pobierania](https://github.com/weiesky/cc-viewer/releases)

### Aktualizacja do 1.7.0 (format logów v2)

Od wersji 1.7.0 logi są przechowywane w formacie katalogu na sesję (wire-format v2) zamiast pojedynczych plików `.jsonl` — zajmują około 90% mniej miejsca na dysku. Istniejące pliki `.jsonl` v1 nigdy nie są modyfikowane ani usuwane; okno dialogowe logów domyślnie wyświetla sesje v2, a mały wpis „Pokaż starsze logi (v1)” (widoczny, dopóki istnieją stare pliki) otwiera widok v1, w którym można je przeglądać, migrować lub usuwać. Przy uruchomieniu cc-viewer proponuje migrację jednym kliknięciem, gdy wykryje starsze logi (zdecydowanie zalecane przy kontynuowaniu starej rozmowy poleceniem `claude -c`, której pierwsza połowa znajduje się w starych plikach). Migrację można też przeprowadzić z terminala:

```bash
ccv convert <project>   # migruj jeden projekt
ccv convert --all       # migruj wszystkie projekty
ccv verify <v1-file>    # sprawdź plik v1 względem jego skonwertowanych sesji
```

Jeśli sesja nie przejdzie weryfikacji golden, zostaje wstrzymana w `sessions-quarantine/` do sprawdzenia, zamiast unieważniać całą migrację — pozostałe sesje są migrowane normalnie.

### Tryb loggera

Jeśli nadal wolisz natywne narzędzie claude lub rozszerzenie VS Code, użyj tego trybu.

W tym trybie `claude`

automatycznie uruchamia proces logowania, który zapisuje logi żądań do katalogów na sesję w \~/.claude/cc-viewer/*yourproject*/sessions/ (wire-format v2)

Uruchom tryb loggera:

```bash
ccv -logger
```

Gdy konsola nie może wyświetlić konkretnego portu, domyślnym pierwszym portem jest 127.0.0.1:7008. Przy wielu jednoczesnych instancjach używane są kolejne porty, np. 7009, 7010.

Odinstaluj tryb loggera:

```bash
ccv --uninstall
```

### Rozwiązywanie problemów (Troubleshooting)

Jeśli napotkasz problemy z uruchomieniem, oto ostateczne podejście do rozwiązywania problemów:
Krok 1: Otwórz Claude Code w dowolnym katalogu;
Krok 2: Daj Claude Code następującą instrukcję:

```
Zainstalowałem pakiet npm cc-viewer, ale po uruchomieniu ccv nadal nie działa poprawnie. Sprawdź cli.js i findcc.js z cc-viewer i dostosuj je do lokalnego wdrożenia Claude Code w oparciu o specyficzne środowisko. Utrzymaj zakres zmian jak najbardziej ograniczony do findcc.js.
```

Pozwolenie Claude Code na samodzielne zdiagnozowanie problemu jest bardziej skuteczne niż pytanie kogokolwiek lub czytanie jakiejkolwiek dokumentacji!

Po zakończeniu powyższej instrukcji plik findcc.js zostanie zaktualizowany. Jeśli twój projekt często wymaga lokalnego wdrożenia lub forkowany kod musi często rozwiązywać problemy instalacyjne, po prostu zachowaj ten plik. Następnym razem po prostu go skopiuj. Obecnie wiele projektów i firm korzystających z Claude Code nie wdraża się na Macu, lecz w środowiskach hostowanych na serwerach, dlatego autor wyodrębnił findcc.js, aby ułatwić śledzenie aktualizacji kodu źródłowego cc-viewer w przyszłości.

Uwaga: ta aplikacja jest w konflikcie z claude-code-switch i claude-code-router, ponieważ występuje problem konkurencji proxy, więc upewnij się, że wyłączyłeś claude-code-switch i claude-code-router podczas korzystania z cc-viewer — wewnątrz cc-viewer zapewniona jest funkcja hot-update proxy jako równoważny zamiennik.

### Inne komendy pomocnicze

Sprawdź:

```bash
ccv -h
```

### Tryb cichy (Silent Mode)

Domyślnie `ccv` działa w trybie cichym, gdy opakowuje `claude`, utrzymując czyste wyjście terminala zgodne z natywnym doświadczeniem. Wszystkie logi są przechwytywane w tle i można je przeglądać pod adresem `http://localhost:7008`.

Po konfiguracji używaj komendy `claude` jak zwykle. Odwiedź `http://localhost:7008`, aby uzyskać dostęp do interfejsu monitorowania.

## Funkcje

### Tryb programowania

Po uruchomieniu z ccv możesz zobaczyć:

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

Możesz wyświetlać diffy kodu bezpośrednio po edycji:

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Chociaż możesz ręcznie otwierać pliki i kod, ręczne programowanie nie jest zalecane — to staroszkolne kodowanie!

### Programowanie mobilne

Możesz nawet zeskanować kod QR, aby programować z urządzenia mobilnego:

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

Spełnij swoje wyobrażenie o programowaniu mobilnym. Istnieje również mechanizm wtyczek — jeśli potrzebujesz dostosowań do swoich nawyków programistycznych, śledź nadchodzące aktualizacje hooków wtyczek.

### Prompty systemowe dla poszczególnych modeli

Okno modalne **Edytuj prompt systemowy** (menu hamburger → Edytuj prompt systemowy) jest podzielone na karty:

* Karta **Domyślny** zachowuje klasyczne działanie: zapisuje `CC_SYSTEM.md` (nadpisanie) lub `CC_APPEND_SYSTEM.md` (dołączenie) w bieżącym obszarze roboczym, wstrzykiwane jako `--system-prompt-file` / `--append-system-prompt-file` przy następnym uruchomieniu ccv.
* **Karty modeli**: kliknij **+ Dodaj model**, wpisz nazwę taką jak `opus` lub `Gemini3` i wybierz zakres — **Globalny** (`~/.claude/cc-viewer/system_prompt/`, obowiązuje w każdym obszarze roboczym) lub **Obszar roboczy** (`<project>/system_prompt/`). Pole nazwy oferuje podpowiedzi podczas wpisywania na podstawie lokalnie skonfigurowanych modeli (profili proxy przeładowywanych na gorąco oraz `settings.json`); nazwy już dodane w wybranym zakresie są ukrywane, a dowolne nazwy wpisywane ręcznie pozostają dozwolone. Każda karta ma własny przełącznik Dołącz/Nadpisz i podgląd Markdown.
* Wpisy są przechowywane jako pliki pisane wielkimi literami: `OPUS_SYSTEM.md` (nadpisanie) lub `OPUS_APPEND_SYSTEM.md` (dołączenie). Dopasowanie jest rozmyte — podciąg identyfikatora modelu wyznaczonego z AKTYWNEJ konfiguracji (mapowanie modelu aktywnego zewnętrznego proxy profile > zmienne środowiskowe `ANTHROPIC_MODEL`/`CLAUDE_MODEL` przy starcie > `model` z `settings.json`; bez sygnału konfiguracji żaden wpis nie jest wstrzykiwany), bez rozróżniania wielkości liter, więc `opus` pasuje do `claude-opus-4-8[1m]` niezależnie od wersji. Dopasowanie z obszaru roboczego wygrywa z globalnym; w ramach jednego zakresu wygrywa najdłuższa nazwa; dopasowany wpis całkowicie zastępuje pliki karty Domyślny dla danego uruchomienia. Znane ograniczenia: zmiana proxy profile w trakcie sesji jest ponownie dopasowywana dopiero po restarcie sesji claude; flaga `--model` przekazana w dodatkowych argumentach nie jest uwzględniana.
* Zapisanie pustej karty usuwa wpis. Zmiany modelu dokonane w trakcie sesji zaczynają obowiązywać przy następnym ponownym uruchomieniu. Ustaw `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1`, aby wyłączyć całe automatyczne wstrzykiwanie. Możesz zacommitować `<project>/system_prompt/`, aby udostępnić prompty swojemu zespołowi, lub dodać go do `.gitignore`, aby pozostały prywatne.

### Tryb loggera (Wyświetlanie pełnych sesji Claude Code)

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* Przechwytuje wszystkie żądania API z Claude Code w czasie rzeczywistym, zapewniając tekst surowy — nie zredagowane logi (to jest ważne!!!)
* Automatycznie identyfikuje i oznacza żądania Main Agent i Sub Agent (podtypy: Plan, Search, Bash)
* Żądania MainAgent obsługują Body Diff JSON, pokazując zwinięte różnice w stosunku do poprzedniego żądania MainAgent (tylko zmienione/nowe pola)
* Każde żądanie wyświetla inline statystyki użycia Tokenów (Tokeny wejścia/wyjścia, tworzenie/odczyt cache, współczynnik trafień)
* Kompatybilny z Claude Code Router (CCR) i innymi scenariuszami proxy — wraca do dopasowywania wzorców ścieżek API

<a href="https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&theme=dark&legend=top-left" />

    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left" />

    ![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left)
  </picture>
</a>

## Licencja

MIT
