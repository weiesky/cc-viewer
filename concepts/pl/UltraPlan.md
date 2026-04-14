# UltraPlan — Najlepsza Maszyna Spełniająca Życzenia

## Czym jest UltraPlan

UltraPlan to **zlokalizowana implementacja** natywnego polecenia `/ultraplan` Claude Code przez cc-viewer. Pozwala na korzystanie z pełnych możliwości `/ultraplan` w lokalnym środowisku **bez konieczności uruchamiania oficjalnej zdalnej usługi Claude**, kierując Claude Code do realizacji złożonych zadań planowania i implementacji przy użyciu **współpracy wielu agentów**.

W porównaniu ze zwykłym trybem Plan lub Agent Team, UltraPlan potrafi:
- Oferuje role **Ekspert kodu** i **Ekspert badawczy** dostosowane do różnych typów zadań
- Wysyłanie wielu równoległych agentów do eksploracji bazy kodu lub prowadzenia badań z różnych perspektyw
- Włączać badania zewnętrzne (webSearch) w celu poznania najlepszych praktyk branżowych
- Automatycznie tworzyć Zespół Code Review po wykonaniu planu w celu przeglądu kodu
- Tworzyć kompletną zamkniętą pętlę **Plan → Wykonanie → Przegląd → Naprawa**

---

## Ważne uwagi

### 1. UltraPlan nie jest wszechmocny
UltraPlan to potężniejsza maszyna spełniająca życzenia, ale to nie znaczy, że każde życzenie może być spełnione. Jest potężniejszy niż Plan i Agent Team, ale nie może bezpośrednio „zarabiać pieniędzy". Rozważ rozsądną granulację zadań — dziel duże cele na wykonalne średniej wielkości zadania zamiast próbować osiągnąć wszystko za jednym razem.

### 2. Obecnie najskuteczniejszy dla projektów programistycznych
Szablony i przepływy pracy UltraPlan są głęboko zoptymalizowane dla projektów programistycznych. Inne scenariusze (dokumentacja, analiza danych itp.) można wypróbować, ale warto poczekać na przyszłe wersje z odpowiednimi adaptacjami.

### 3. Czas wykonania i wymagania okna kontekstu
- Pomyślne uruchomienie UltraPlan zazwyczaj trwa **30 minut lub więcej**
- Wymaga, aby MainAgent posiadał duże okno kontekstu (zalecany model Opus z kontekstem 1M)
- Jeśli masz tylko model 200K, **upewnij się, że wykonasz `/clear` kontekstu przed uruchomieniem**
- Polecenie `/compact` Claude Code działa słabo, gdy okno kontekstu jest niewystarczające — unikaj wyczerpania miejsca
- Utrzymanie wystarczającej przestrzeni kontekstu jest kluczowym warunkiem pomyślnego wykonania UltraPlan

Jeśli masz jakiekolwiek pytania lub sugestie dotyczące zlokalizowanego UltraPlan, zapraszamy do otwarcia [Issues na GitHub](https://github.com/anthropics/claude-code/issues), aby dyskutować i współpracować.

---

## Jak to działa

UltraPlan oferuje dwie role ekspertów, dostosowane do różnych typów zadań:

### Ekspert kodu
Wieloagentowy przepływ pracy zaprojektowany dla projektów programistycznych:
1. Wysłanie do 5 równoległych agentów do jednoczesnej eksploracji bazy kodu (architektura, identyfikacja plików, ocena ryzyka itp.)
2. Opcjonalne wysłanie agenta badawczego do zbadania rozwiązań branżowych przez webSearch
3. Synteza wszystkich odkryć agentów w szczegółowy plan implementacji
4. Wysłanie agenta recenzenta do zbadania planu z wielu perspektyw
5. Realizacja planu po zatwierdzeniu
6. Automatyczne utworzenie Code Review Team do walidacji jakości kodu po implementacji

### Ekspert badawczy
Wieloagentowy przepływ pracy zaprojektowany dla zadań badawczych i analitycznych:
1. Wysłanie wielu równoległych agentów do badań z różnych wymiarów (badania branżowe, artykuły naukowe, wiadomości, analiza konkurencji itp.)
2. Przypisanie agenta do syntezy docelowego rozwiązania przy jednoczesnej weryfikacji rzetelności i wiarygodności zebranych źródeł
3. Opcjonalne wysłanie agenta do stworzenia demo produktu (HTML, Markdown itp.)
4. Synteza wszystkich odkryć w kompleksowy plan implementacji
5. Wysłanie wielu agentów recenzentów do zbadania planu z różnych ról i perspektyw
6. Realizacja planu po zatwierdzeniu
