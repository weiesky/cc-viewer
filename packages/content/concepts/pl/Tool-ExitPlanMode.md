# ExitPlanMode

Przesyła plan wdrożenia sporządzony podczas trybu planowania do zatwierdzenia przez użytkownika i — jeśli zostanie zaakceptowany — wyprowadza sesję z trybu planowania, aby można było rozpocząć edycje.

## Kiedy używać

- Plan napisany w trakcie `EnterPlanMode` jest gotowy i nadaje się do przeglądu.
- Zadanie skupia się na wdrożeniu (zmiany kodu lub konfiguracji), a nie na czystym badaniu, więc wyraźny plan jest odpowiedni.
- Wszystkie wstępne odczyty i analizy zostały wykonane; żadne dalsze dochodzenie nie jest potrzebne, zanim użytkownik zdecyduje.
- Asystent wyliczył konkretne ścieżki plików, funkcje i kroki — nie tylko cele.
- Użytkownik poprosił o zobaczenie planu lub przepływ trybu planowania za chwilę przekaże kontrolę narzędziom edycji.

## Parametry

- `allowedPrompts` (tablica, opcjonalny): Prompty, które użytkownik może wpisać na ekranie zatwierdzania, aby automatycznie zaakceptować lub zmodyfikować plan. Każdy element określa uprawnienie z zakresem (na przykład nazwa operacji i narzędzie, którego dotyczy). Pozostaw niewypełnione, aby użyć domyślnego przepływu zatwierdzania.

## Przykłady

### Przykład 1: Standardowe przesłanie

Po zbadaniu refaktoringu uwierzytelniania wewnątrz trybu planowania i zapisaniu pliku planu na dysku asystent wywołuje `ExitPlanMode` bez argumentów. Środowisko odczytuje plan z jego kanonicznej lokalizacji, wyświetla go użytkownikowi i czeka na akceptację lub odrzucenie.

### Przykład 2: Wstępnie zatwierdzone szybkie akcje

```
ExitPlanMode(allowedPrompts=[
  {"tool": "Bash", "prompt": "run tests"},
  {"tool": "Bash", "prompt": "install dependencies"}
])
```

Pozwala użytkownikowi udzielić z góry uprawnień dla rutynowych poleceń następczych, aby asystent nie musiał zatrzymywać się przy każdym monicie o uprawnienie podczas wdrożenia.

## Uwagi

- `ExitPlanMode` ma sens tylko dla pracy typu wdrożeniowego. Jeśli żądanie użytkownika to zadanie badawcze lub wyjaśniające bez zmian plików, odpowiedz bezpośrednio — nie kieruj przez tryb planowania tylko po to, by z niego wyjść.
- Plan musi być już zapisany na dysku przed wywołaniem tego narzędzia. `ExitPlanMode` nie akceptuje treści planu jako parametru; czyta z ścieżki oczekiwanej przez środowisko.
- Jeśli użytkownik odrzuci plan, wracasz do trybu planowania. Popraw na podstawie opinii i prześlij ponownie; nie zaczynaj edytować plików, gdy plan jest niezatwierdzony.
- Zatwierdzenie daje pozwolenie na opuszczenie trybu planowania i użycie narzędzi mutujących (`Edit`, `Write`, `Bash` itd.) dla zakresu opisanego w planie. Rozszerzenie zakresu później wymaga nowego planu lub wyraźnej zgody użytkownika.
- Nie używaj `AskUserQuestion`, aby pytać "czy ten plan wygląda dobrze?" przed wywołaniem tego narzędzia — prośba o zatwierdzenie planu to dokładnie to, co robi `ExitPlanMode`, a użytkownik nie widzi planu, dopóki nie zostanie przesłany.
- Utrzymuj plan minimalny i wykonalny. Recenzent powinien móc przejrzeć go w mniej niż minutę i dokładnie zrozumieć, co się zmieni.
- Jeśli w trakcie wdrażania zorientujesz się, że plan był błędny, zatrzymaj się i zgłoś to użytkownikowi zamiast cicho odbiegać. Ponowne wejście w tryb planowania to poprawny kolejny krok.
