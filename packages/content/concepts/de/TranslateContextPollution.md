# Kontextverschmutzung der Übersetzungs-API

## Hintergrund

CC-Viewer enthält eine integrierte Übersetzungsfunktion (`POST /api/translate`), die von der Anthropic Messages API angetrieben wird. In der frühen Implementierung verwendeten Übersetzungsanfragen die zwischengespeicherten Authentifizierungsdaten der Claude Code-Sitzung wieder — einschließlich der Header `x-api-key` und `authorization`. Dies verursachte ein subtiles, aber schwerwiegendes Problem: Übersetzungsergebnisse lieferten häufig irrelevante Inhalte zurück.

## Ursache

### Grundlegender Unterschied zwischen zwei Authentifizierungsmethoden

Die Anthropic API unterstützt zwei Authentifizierungsmethoden:

| Methode | Header | Typische Quelle | Eigenschaften |
|---------|--------|-----------------|---------------|
| API-Schlüssel | `x-api-key: sk-ant-...` | Umgebungsvariable / Console | Zustandslos, jede Anfrage ist unabhängig |
| OAuth-Token | `authorization: Bearer sessionToken` | Claude Code-Abonnement-Login | Sitzungsgebunden, Server pflegt Kontextzuordnung |

Der entscheidende Unterschied: **API-Schlüssel sind zustandslos** — jede Anfrage ist vollständig unabhängig; während **OAuth-Sitzungstoken zustandsbehaftet sind** — der Anthropic-Server ordnet Anfragen mit demselben Token demselben Sitzungskontext zu.

### Verschmutzungskette

Wenn Claude Code die OAuth-Anmeldung über ein Abonnement verwendet, sieht der Authentifizierungsfluss folgendermaßen aus:

```
Claude Code Hauptkonversation ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                          ↑
CC-Viewer Übersetzungsanfrage ──(authorization: Bearer sessionToken)──→ Anthropic API
```

Da Übersetzungsanfragen dasselbe Sitzungstoken wiederverwendeten, konnte der Anthropic-Server Übersetzungsanfragen mit dem Hauptkonversationskontext von Claude Code verknüpfen. Dies führt zu:

1. **Übersetzungsergebnisse werden vom Hauptkonversationskontext beeinflusst**: Der Systemprompt der Übersetzungsanfrage lautet „Du bist ein Übersetzer", aber der Serverkontext enthält weiterhin den Gesprächsverlauf von Claude Code, was das Modell beeinträchtigen kann
2. **Hauptkonversation wird durch Übersetzungsanfragen gestört**: Inhalte der Übersetzungsanfrage (UI-Textfragmente) können in den Hauptkonversationskontext injiziert werden, wodurch die Antworten von Claude Code abweichen
3. **Unvorhersehbares Verhalten**: Da die Kontextverschmutzung serverseitiges Verhalten ist, kann der Client sie weder erkennen noch kontrollieren

## Erkenntnisse

- **OAuth-Sitzungstoken sind nicht „einfach ein weiterer API-Schlüssel"** — sie tragen serverseitigen Zustand, ihre Wiederverwendung bedeutet gemeinsame Nutzung des Kontexts
- **Interne Dienstaufrufe sollten eine unabhängige, zustandslose Authentifizierung verwenden**, um eine Verknüpfung mit Benutzersitzungen zu vermeiden

## Referenzen

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
