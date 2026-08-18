# RemoteTrigger

Wywołuje API zdalnych wyzwalaczy claude.ai w celu zarządzania zaplanowanymi zadaniami i wykonywaniem wyzwalaczy na żądanie. Token OAuth jest obsługiwany wewnętrznie przez narzędzie i nigdy nie jest ujawniany modelowi ani powłoce.

## Kiedy używać

- Zarządzanie zdalnymi agentami (wyzwalaczami) na claude.ai, w tym wyświetlanie listy, inspekcja i aktualizowanie istniejących wyzwalaczy
- Tworzenie nowego zautomatyzowanego zadania opartego na cron, które uruchamia agenta Claude według cyklicznego harmonogramu
- Uruchamianie istniejącego wyzwalacza na żądanie bez oczekiwania na następne zaplanowane uruchomienie
- Wyświetlanie lub audytowanie wszystkich bieżących wyzwalaczy w celu przeglądu ich konfiguracji i stanu
- Aktualizowanie ustawień wyzwalacza, takich jak harmonogram, ładunek lub opis, bez konieczności jego ponownego tworzenia

## Aktywacja

- Wymaga planu claude.ai Pro, Max, Team lub Enterprise.
- Niedostępne na Amazon Bedrock, Claude Platform on AWS, Google Cloud i Microsoft Foundry.
- Wymaga flag funkcji po stronie serwera oraz ustawień polityki `allow_remote_sessions` / `allow_routines`.
- Niedostępne w samych sesjach zdalnych.

## Parametry

- `action` (string, wymagany): operacja do wykonania — jedna z wartości `list`, `get`, `create`, `update` lub `run`
- `trigger_id` (string, wymagany dla `get`, `update` i `run`): identyfikator wyzwalacza, na którym ma być wykonana operacja; musi pasować do wzorca `^[\w-]+$` (tylko znaki słowa i myślniki)
- `body` (object, wymagany dla `create` i `update`; opcjonalny dla `run`): ładunek żądania wysyłany do API

## Przykłady

### Przykład 1: wyświetl listę wszystkich wyzwalaczy

```json
{
  "action": "list"
}
```

Wywołuje `GET /v1/code/triggers` i zwraca tablicę JSON wszystkich wyzwalaczy powiązanych z uwierzytelnionym kontem.

### Przykład 2: utwórz nowy wyzwalacz uruchamiany każdego ranka w dniu roboczym

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "Generuj codzienny podsumowanie każdego dnia roboczego o 08:00 UTC"
  }
}
```

Wywołuje `POST /v1/code/triggers` z podanym treścią i zwraca nowo utworzony obiekt wyzwalacza, w tym przypisany `trigger_id`.

### Przykład 3: uruchom wyzwalacz na żądanie

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

Natychmiast wywołuje `POST /v1/code/triggers/my-report-trigger/run`, omijając zaplanowany czas.

### Przykład 4: pobierz pojedynczy wyzwalacz

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

Wywołuje `GET /v1/code/triggers/my-report-trigger` i zwraca pełną konfigurację wyzwalacza.

## Uwagi

- Token OAuth jest wstrzykiwany w procesie przez narzędzie — nigdy nie kopiuj, nie wklejaj ani nie rejestruj tokenów ręcznie; powoduje to zagrożenie bezpieczeństwa i jest zbędne podczas korzystania z tego narzędzia.
- Preferuj to narzędzie zamiast surowego `curl` lub innych klientów HTTP dla wszystkich wywołań API wyzwalaczy; bezpośrednie użycie HTTP omija bezpieczne wstrzykiwanie tokenów i może ujawnić poświadczenia.
- Narzędzie zwraca surową odpowiedź JSON z API; wywołujący jest odpowiedzialny za parsowanie odpowiedzi i obsługę kodów statusu błędów.
- Wartość `trigger_id` musi pasować do wzorca `^[\w-]+$` — dozwolone są tylko znaki alfanumeryczne, podkreślenia i myślniki; spacje lub znaki specjalne spowodują niepowodzenie żądania.
