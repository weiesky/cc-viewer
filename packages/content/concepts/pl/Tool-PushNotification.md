# PushNotification

Wysyła powiadomienie pulpitu z bieżącej sesji Claude Code. Jeśli Remote Control jest podłączony, powiadomienie trafia również na telefon użytkownika, przyciągając jego uwagę z powrotem do sesji — bez względu na to, czym się zajmuje.

## Kiedy używać

- Długotrwałe zadanie zakończyło się, gdy użytkownik prawdopodobnie był z dala od terminala
- Kompilacja, uruchomienie testów lub wdrożenie zostało ukończone i wynik jest gotowy do przeglądu
- Osiągnięto punkt decyzyjny wymagający danych wejściowych od użytkownika przed kontynuowaniem pracy
- Wystąpił błąd lub blokada, której nie można rozwiązać autonomicznie
- Użytkownik wyraźnie poprosił o powiadomienie, gdy określone zadanie lub warunek zostanie spełniony

## Kiedy nie używać

Nie wysyłaj powiadomień o rutynowych aktualizacjach postępu w trakcie zadania ani w odpowiedzi na pytanie, które użytkownik właśnie zadał i wyraźnie czeka na odpowiedź. Nie powiadamiaj o zakończeniu krótkich zadań — jeśli użytkownik dopiero je zlecił i czeka, powiadomienie nie ma żadnej wartości i podważa zaufanie do przyszłych powiadomień. Mocno skłaniaj się ku niewysy&#322;aniu.

## Aktywacja

- Domyślnie wyłączone (flaga funkcji po stronie serwera).
- Dostarczanie działa przez infrastrukturę hostowaną przez Anthropic — niedostępne na Amazon Bedrock, Claude Platform on AWS, Google Cloud i Microsoft Foundry.
- Push na telefon dodatkowo wymaga podłączonego klienta Remote Control.

## Parametry

- `message` (ciąg znaków, wymagany): treść powiadomienia. Utrzymuj poniżej 200 znaków; mobilne systemy operacyjne obcinają dłuższe ciągi. Zacznij od tego, na co użytkownik będzie reagował: "build failed: 2 auth tests" jest bardziej przydatne niż "task complete".
- `status` (ciąg znaków, wymagany): zawsze ustawiaj na `"proactive"`. Jest to stały znacznik i nie zmienia się.

## Przykłady

### Przykład 1: powiadomienie po zakończeniu długiej analizy

Zażądano audytu zależności obejmującego całe repozytorium, który trwał kilka minut. Użytkownik odszedł od stanowiska. Gdy raport jest gotowy:

```
message: "Audyt zależności gotowy: 3 krytyczne CVE w lodash, axios, jsonwebtoken. Raport: audit-report.txt"
status: "proactive"
```

### Przykład 2: oznaczenie punktu decyzyjnego podczas autonomicznej pracy

Podczas wieloetapowego refaktoringu odkryto, że dwa moduły mają sprzeczne interfejsy i nie można ich scalić bez decyzji projektowej:

```
message: "Refaktoring wstrzymany: AuthService i UserService mają sprzeczne interfejsy tokenów. Wymagana decyzja przed kontynuacją."
status: "proactive"
```

## Uwagi

- Mocno skłaniaj się ku **niewysyłaniu**. Powiadomienie przerywa użytkownikowi bez względu na to, co robi. Traktuj je jako koszt, który musi być uzasadniony wartością informacji.
- Zacznij od treści, na którą można zareagować. Pierwsze słowa powinny informować użytkownika, co się stało i co ewentualnie należy zrobić — nie ogólna etykieta statusu.
- Utrzymuj `message` poniżej 200 znaków. Mobilne systemy operacyjne obetną dłuższe ciągi, usuwając najważniejszą część, jeśli pojawia się na końcu.
- Jeśli wynik wskazuje, że push nie został wysłany z powodu braku połączenia Remote Control, jest to oczekiwane zachowanie. Nie jest potrzebna ponowna próba ani żadne dalsze działanie; lokalne powiadomienie pulpitu i tak zostaje wyświetlone.
- Unikaj spamu powiadomień. Jeśli powiadomienia są wysyłane często przy drobnych zdarzeniach, użytkownik zacznie je ignorować. Rezerwuj to narzędzie na momenty, gdy jest realna szansa, że użytkownik odszedł i będzie chciał teraz poznać wynik.
