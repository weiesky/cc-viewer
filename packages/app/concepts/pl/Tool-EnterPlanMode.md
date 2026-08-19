# EnterPlanMode

Przełącza sesję w tryb planowania — fazę eksploracji tylko do odczytu, w której asystent bada bazę kodu i sporządza konkretny plan wdrożenia do zatwierdzenia przez użytkownika przed jakąkolwiek modyfikacją plików.

## Kiedy używać

- Użytkownik prosi o nietrywialną zmianę obejmującą wiele plików lub podsystemów.
- Wymagania są niejednoznaczne i asystent musi przeczytać kod, zanim zdecyduje się na podejście.
- Proponowany jest refaktoring, migracja lub aktualizacja zależności, a zasięg zmian jest niejasny.
- Użytkownik wyraźnie mówi "zaplanuj to", "najpierw zaplanujmy" lub prosi o przegląd projektu.
- Ryzyko jest na tyle wysokie, że przejście bezpośrednio do edycji mogłoby zmarnować pracę lub uszkodzić stan.

## Parametry

Brak. `EnterPlanMode` nie przyjmuje argumentów — wywołaj go z pustym obiektem parametrów.

## Przykłady

### Przykład 1: Duża prośba o funkcję

Użytkownik prosi: "Dodaj SSO przez Okta do panelu administratora." Asystent wywołuje `EnterPlanMode`, a następnie przez kilka tur czyta middleware uwierzytelniania, magazyn sesji, strażników tras i istniejący UI logowania. Pisze plan opisujący wymagane zmiany, kroki migracji i pokrycie testami, a następnie przesyła go przez `ExitPlanMode` do zatwierdzenia.

### Przykład 2: Ryzykowny refaktoring

Użytkownik mówi: "Skonwertuj kontrolery REST na tRPC." Asystent wchodzi w tryb planowania, przegląda każdy kontroler, kataloguje kontrakt publiczny, wymienia fazy wdrożenia (shim, dual-read, cutover) i proponuje plan sekwencji przed dotknięciem jakiegokolwiek pliku.

## Uwagi

- Tryb planowania jest z założenia tylko do odczytu. Będąc w nim, asystent nie może uruchamiać `Edit`, `Write`, `NotebookEdit` ani żadnego mutującego polecenia powłoki. Używaj tylko `Read`, `Grep`, `Glob` i nieniszczących poleceń `Bash`.
- Nie wchodź w tryb planowania dla trywialnych jednowierszowych edycji, czysto badawczych pytań lub zadań, w których użytkownik już w pełni określił zmianę. Narzut bardziej szkodzi niż pomaga.
- W trybie Auto tryb planowania jest odradzany, chyba że użytkownik wyraźnie tego zażąda — tryb Auto preferuje działanie nad planowanie z wyprzedzeniem.
- Używaj trybu planowania, aby ograniczyć korekty kursu przy kosztownej pracy. Pięciominutowy plan często oszczędza godzinę błędnie ukierunkowanych edycji.
- Po wejściu w tryb planowania skup badania na częściach systemu, które faktycznie się zmienią. Unikaj wyczerpujących wycieczek po repozytorium niezwiązanych z bieżącym zadaniem.
- Sam plan powinien zostać zapisany na dysku w ścieżce oczekiwanej przez środowisko, aby `ExitPlanMode` mógł go przesłać. Plan powinien zawierać konkretne ścieżki plików, nazwy funkcji i kroki weryfikacji, a nie niejasne intencje.
- Użytkownik może odrzucić plan i poprosić o poprawki. Iteruj w trybie planowania, dopóki plan nie zostanie zaakceptowany; dopiero wtedy wyjdź.
