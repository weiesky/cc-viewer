# SubAgent: Search

## Cel

Podagent Search to lekki agent eksploracji tylko do odczytu. Wysyłaj go, gdy musisz zrozumieć bazę kodu — znaleźć, gdzie coś się znajduje, nauczyć się, jak komponenty do siebie pasują, lub odpowiedzieć na pytania strukturalne — bez zmiany żadnych plików. Jest zoptymalizowany pod wiele małych odczytów w wielu plikach, zwracając zwięzłe podsumowanie zamiast surowego wyjścia wyszukiwania.

Search nie jest ogólnego przeznaczenia asystentem. Nie może edytować kodu, uruchamiać kompilacji, commitować zmian ani otwierać połączeń sieciowych poza pobieraniami tylko do odczytu. Jego wartość polega na tym, że może spalić duży budżet eksploracji równolegle bez zużywania kontekstu głównego agenta, a następnie zwrócić zwartą odpowiedź.

## Kiedy używać

- Musisz odpowiedzieć na pytanie wymagające trzech lub więcej odrębnych wyszukiwań lub odczytów. Przykład: "Jak uwierzytelnianie jest okablowane od trasy logowania aż do magazynu sesji?"
- Cel jest nieznany — jeszcze nie wiesz, na który plik, moduł lub symbol spojrzeć.
- Potrzebujesz przeglądu strukturalnego nieznanego obszaru repozytorium przed wprowadzeniem zmian.
- Chcesz krzyżowo odwoływać się do wielu kandydatów (na przykład, który z kilku podobnie nazwanych helperów jest faktycznie wywoływany na produkcji).
- Potrzebujesz podsumowania w stylu literatury: "wylistuj każde miejsce, które importuje X, i skategoryzuj po miejscu wywołania."

Nie używaj Search, gdy:

- Znasz już dokładny plik i wiersz. Wywołaj `Read` bezpośrednio.
- Pojedyncze `Grep` lub `Glob` odpowie na pytanie. Uruchom je bezpośrednio; wysyłanie podagenta dodaje narzut.
- Zadanie wymaga edycji, uruchamiania poleceń lub jakiegokolwiek efektu ubocznego. Search jest z założenia tylko do odczytu.
- Potrzebujesz dokładnego dosłownego wyjścia wywołania narzędzia. Podagenci podsumowują; nie pośredniczą w surowych wynikach.

## Poziomy dokładności

Wybierz poziom odpowiadający stawce pytania.

- `quick` — kilka ukierunkowanych wyszukiwań, najlepsza możliwa odpowiedź. Użyj, gdy potrzebujesz szybkiej wskazówki (na przykład "gdzie jest logika parsowania zmiennych środowiskowych?") i jesteś gotów iterować, jeśli odpowiedź jest niepełna.
- `medium` — domyślny. Kilka rund wyszukiwania, krzyżowe sprawdzanie kandydatów i czytanie najbardziej istotnych plików w całości. Użyj dla typowych pytań "pomóż mi zrozumieć ten obszar".
- `very thorough` — wyczerpująca eksploracja. Podagent będzie ścigał każdy wiarygodny trop, czytał otaczający kontekst i podwójnie sprawdzał ustalenia przed podsumowaniem. Użyj, gdy poprawność ma znaczenie (na przykład przegląd bezpieczeństwa, planowanie migracji) lub gdy niepełna odpowiedź spowoduje przeróbki.

Wyższa dokładność kosztuje więcej czasu i tokenów wewnątrz podagenta, ale te tokeny zostają wewnątrz podagenta — tylko końcowe podsumowanie wraca do głównego agenta.

## Dostępne narzędzia

Search ma dostęp do wszystkich narzędzi tylko do odczytu, których używa główny agent, i nic więcej:

- `Read` — do czytania konkretnych plików, w tym częściowych zakresów.
- `Grep` — do wyszukiwań zawartości w drzewie.
- `Glob` — do lokalizowania plików po wzorcu nazw.
- `Bash` w trybie tylko do odczytu — do poleceń, które inspekcjonują stan bez mutowania go (na przykład `git log`, `git show`, `ls`, `wc`).
- `WebFetch` i `WebSearch` — do czytania zewnętrznej dokumentacji, gdy ten kontekst jest wymagany.

Narzędzia edycji (`Write`, `Edit`, `NotebookEdit`), polecenia powłoki modyfikujące stan oraz narzędzia grafu zadań (`TaskCreate`, `TaskUpdate` itp.) są celowo niedostępne.

## Uwagi

- Daj podagentowi Search konkretne pytanie, a nie temat. "Wylistuj każdego wywołującego `renderMessage` i zanotuj, którzy przekazują niestandardowy motyw" zwraca przydatną odpowiedź; "opowiedz mi o renderowaniu" — nie.
- Podagent zwraca podsumowanie. Jeśli potrzebujesz dokładnych ścieżek plików, poproś o nie wyraźnie w swoim prompcie.
- Wiele niezależnych pytań najlepiej wysyłać jako równoległych podagentów Search, a nie jeden długi prompt, aby każdy mógł się skupić.
- Ponieważ Search nie może edytować, sparuj go z następczym krokiem edycji w głównym agencie, gdy już wiesz, co zmienić.
- Traktuj wyjście Search jako dowód, a nie prawdę podstawową. Dla wszystkiego niosącego obciążenie otwórz cytowane pliki samodzielnie przed działaniem.
