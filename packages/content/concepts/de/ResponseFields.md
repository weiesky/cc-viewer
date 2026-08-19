# Beschreibung der Response-Body-Felder

Feldbeschreibung des Antwortkörpers der Claude API `/v1/messages`.

## Felder der obersten Ebene

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| **model** | string | Der tatsächlich verwendete Modellname, z. B. `claude-opus-4-6` |
| **id** | string | Eindeutiger Bezeichner dieser Antwort, z. B. `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | Immer `"message"` |
| **role** | string | Immer `"assistant"` |
| **content** | array | Array der vom Modell ausgegebenen Inhaltsblöcke, einschließlich Text, Tool-Aufrufe, Denkprozess usw. |
| **stop_reason** | string | Stoppgrund: `"end_turn"` (normal beendet), `"tool_use"` (Tool-Ausführung erforderlich), `"max_tokens"` (Token-Limit erreicht) |
| **stop_sequence** | string/null | Die auslösende Stoppsequenz, normalerweise `null` |
| **usage** | object | Token-Verbrauchsstatistik (siehe unten) |

## content-Blocktypen

| Typ | Beschreibung |
|-----|--------------|
| **text** | Textantwort des Modells, enthält das Feld `text` |
| **tool_use** | Tool-Aufrufanfrage, enthält `name` (Tool-Name), `input` (Parameter), `id` (Aufruf-ID, zur Zuordnung von tool_result) |
| **thinking** | Erweiterter Denkinhalt (erscheint nur bei aktiviertem Thinking-Modus), enthält das Feld `thinking` |

## usage-Felder im Detail

| Feld | Beschreibung |
|------|--------------|
| **input_tokens** | Anzahl der nicht aus dem Cache gelesenen Eingabe-Token (werden zum vollen Preis berechnet) |
| **cache_creation_input_tokens** | Anzahl der Token, für die in dieser Anfrage ein neuer Cache erstellt wurde (Cache-Schreibvorgang, höhere Kosten als normale Eingabe) |
| **cache_read_input_tokens** | Anzahl der aus dem Cache gelesenen Token (Cache-Lesevorgang, deutlich günstiger als normale Eingabe) |
| **output_tokens** | Anzahl der vom Modell ausgegebenen Token |
| **service_tier** | Servicestufe, z. B. `"standard"` |
| **inference_geo** | Inferenz-Region, z. B. `"not_available"` bedeutet, dass keine Regionsinformation verfügbar ist |

## cache_creation-Unterfelder

| Feld | Beschreibung |
|------|--------------|
| **ephemeral_5m_input_tokens** | Anzahl der Token für kurzlebige Cache-Erstellung mit 5 Minuten TTL |
| **ephemeral_1h_input_tokens** | Anzahl der Token für langlebige Cache-Erstellung mit 1 Stunde TTL |

> **Zur Cache-Berechnung**: Der Einzelpreis von `cache_read_input_tokens` liegt deutlich unter dem von `input_tokens`, während der Einzelpreis von `cache_creation_input_tokens` etwas über dem normaler Eingabe liegt. Daher kann eine hohe Cache-Trefferquote in fortlaufenden Gesprächen die Kosten erheblich senken. Mit der Kennzahl "Trefferquote" in cc-viewer lässt sich dieses Verhältnis anschaulich überwachen.

## Bedeutung von stop_reason

- **end_turn**: Das Modell hat die Antwort normal abgeschlossen
- **tool_use**: Das Modell muss ein Tool aufrufen; content enthält einen `tool_use`-Block. In der nächsten Anfrage muss ein `tool_result` in messages angehängt werden, um das Gespräch fortzusetzen
- **max_tokens**: Das `max_tokens`-Limit wurde erreicht und die Antwort wurde abgeschnitten; die Antwort ist möglicherweise unvollständig
