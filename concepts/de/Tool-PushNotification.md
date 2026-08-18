# PushNotification

Sendet eine Desktop-Benachrichtigung aus der aktuellen Claude Code-Sitzung. Wenn Remote Control verbunden ist, wird die Benachrichtigung auch auf das Smartphone des Benutzers übertragen und lenkt dessen Aufmerksamkeit von der aktuellen Tätigkeit zurück zur Sitzung.

## Wann verwenden

- Eine lang laufende Aufgabe wurde abgeschlossen, während der Benutzer wahrscheinlich nicht am Terminal war
- Ein Build, Testlauf oder Deployment wurde abgeschlossen und das Ergebnis kann überprüft werden
- Es wurde ein Entscheidungspunkt erreicht, an dem Benutzereingaben erforderlich sind, bevor die Arbeit fortgesetzt werden kann
- Ein Fehler oder Blocker ist aufgetreten, der nicht autonom gelöst werden kann
- Der Benutzer hat ausdrücklich darum gebeten, benachrichtigt zu werden, wenn eine bestimmte Aufgabe oder Bedingung erfüllt ist

## Wann nicht verwenden

Senden Sie keine Benachrichtigung für routinemäßige Fortschrittsaktualisierungen während einer Aufgabe oder um zu bestätigen, dass eine Frage beantwortet wurde, auf die der Benutzer gerade wartet. Bei kurzen Aufgaben ist keine Benachrichtigung notwendig — wenn der Benutzer die Aufgabe gerade eingereicht hat und wartet, bietet eine Benachrichtigung keinen Mehrwert und mindert das Vertrauen in künftige Benachrichtigungen. Tendenziell sollte keine Benachrichtigung gesendet werden.

## Aktivierung

- Standardmäßig deaktiviert (serverseitiges Feature-Flag).
- Die Zustellung läuft über die von Anthropic gehostete Infrastruktur – nicht verfügbar auf Amazon Bedrock, Claude Platform on AWS, Google Cloud oder Microsoft Foundry.
- Der Telefon-Push erfordert zusätzlich einen verbundenen Remote-Control-Client.

## Parameter

- `message` (Zeichenkette, erforderlich): Der Benachrichtigungstext. Unter 200 Zeichen halten; mobile Betriebssysteme kürzen längere Zeichenketten. Mit handlungsrelevantem Inhalt beginnen: "build failed: 2 auth tests" ist aussagekräftiger als "task complete".
- `status` (Zeichenkette, erforderlich): Immer auf `"proactive"` setzen. Dies ist ein fester Marker und wird nicht geändert.

## Beispiele

### Beispiel 1: Benachrichtigung nach Abschluss einer langen Analyse

Eine repository-weite Abhängigkeitsprüfung wurde angefordert und dauerte mehrere Minuten. Der Benutzer hat den Arbeitsplatz verlassen. Wenn der Bericht fertig ist:

```
message: "Dependency-Audit abgeschlossen: 3 kritische CVEs in lodash, axios, jsonwebtoken. Bericht: audit-report.txt"
status: "proactive"
```

### Beispiel 2: Entscheidungspunkt bei autonomer Arbeit markieren

Während eines mehrstufigen Refactorings wird festgestellt, dass zwei Module inkompatible Schnittstellen haben und ohne eine Designentscheidung nicht zusammengeführt werden können:

```
message: "Refactoring pausiert: AuthService und UserService haben konflikthafte Token-Schnittstellen. Ihre Entscheidung wird benötigt."
status: "proactive"
```

## Hinweise

- Tendieren Sie stark dazu, **keine** Benachrichtigung zu senden. Die Benachrichtigung unterbricht den Benutzer unabhängig davon, was er gerade tut. Behandeln Sie sie als Kosten, die durch den Informationswert gerechtfertigt werden müssen.
- Mit handlungsrelevantem Inhalt beginnen. Die ersten Wörter sollten mitteilen, was passiert ist und was, falls überhaupt etwas, zu tun ist — kein generisches Statuslabel.
- `message` unter 200 Zeichen halten. Mobile Betriebssysteme kürzen längere Zeichenketten, wodurch der wichtigste Teil am Ende verloren gehen kann.
- Wenn das Ergebnis anzeigt, dass der Push nicht gesendet wurde, weil Remote Control nicht verbunden ist, ist das erwartetes Verhalten. Kein Neuversuch oder weitere Maßnahmen erforderlich; die lokale Desktop-Benachrichtigung wird dennoch ausgelöst.
- Benachrichtigungs-Spam vermeiden. Wenn häufig für Kleinigkeiten Benachrichtigungen gesendet werden, beginnt der Benutzer, diese zu ignorieren. Dieses Tool sollte für Momente reserviert werden, in denen der Benutzer sehr wahrscheinlich nicht anwesend ist und das Ergebnis sofort wissen möchte.
