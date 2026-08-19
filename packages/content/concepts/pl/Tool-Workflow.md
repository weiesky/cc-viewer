# Workflow

Uruchamia skrypt, który deterministycznie orkiestruje wielu podagentów — fan-out, potoki, pętle i weryfikację — do pracy zbyt szerokiej, zbyt niepewnej lub zbyt dużej dla pojedynczego kontekstu.

## Kiedy używać

- Rozłożyć duże zadanie i pokryć je równolegle przez wielu agentów
- Skonfrontować ustalenia z niezależną lub adwersaryjną weryfikacją, zanim się na nie zdasz
- Podjąć się skali, której pojedynczy kontekst nie pomieści: migracje, audyty, szerokie przeglądy wielu plików

## Jak to działa

- Działa w tle; otrzymujesz powiadomienie, gdy się zakończy. Śledź postęp na żywo za pomocą `/workflows`.
- Skrypt koordynuje agentów za pomocą `agent()`, `parallel()`, `pipeline()` oraz `phase()`.
- `pipeline()` przepuszcza każdy element przez etapy bez bariery (domyślnie); `parallel()` jest barierą, która czeka na wszystkie wyniki.
- Ze schema każdy `agent()` zwraca zwalidowane dane strukturalne zamiast wolnego tekstu.

## Uwagi

- Uruchamia się tylko wtedy, gdy użytkownik świadomie zgodzi się na orkiestrację wieloagentową; może utworzyć wielu agentów i zużyć znaczącą liczbę tokenów.
- Współbieżność jest ograniczona na workflow; nadmiarowi agenci czekają w kolejce i uruchamiają się w miarę zwalniania miejsc.
- Dla pojedynczego podagenta użyj zamiast tego narzędzia `Agent` — zarezerwuj Workflow do prawdziwego fan-outu.

## Powiązane pojęcia

- Opiera się na narzędziu `Agent`, uruchamiając wielu agentów pod deterministyczną kontrolą przepływu.
