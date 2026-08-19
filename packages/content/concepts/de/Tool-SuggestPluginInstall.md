# SuggestPluginInstall

Rendert eine Inline-Pluginkarte zur Installation aus `SearchPlugins`-Ergebnissen und knüpft Plugin-Vorschläge an die Anfrage des Benutzers.

## Wann verwenden

- Eine Plugin-Suche hat Plugins zutage gefördert, die zu dem passen, was der Benutzer vorhat, und Sie möchten sie zur Installation anbieten.

## Aktivierung

- Nur wenn ein Remote-Control-Client verbunden ist oder die Sitzung in einer verwalteten Cloud-Umgebung läuft.
- Unter HIPAA-Enterprise-Konfigurationen deaktiviert.
- Nicht im Brief-Modus.

## Parameter

- `contextLabel` (string, erforderlich): Kurze Überschrift, die den Vorschlag mit der Benutzeranfrage verknüpft (maximal 128 Zeichen).
- `plugins` (array, erforderlich): Plugins aus `SearchPlugins`-Ergebnissen – 1–16 Einträge, jeder mit:
  - `pluginId` (string, erforderlich)
  - `pluginName` (string, erforderlich)
  - `description` (string, erforderlich)
  - `skills` (array, optional): Bis zu 32 `{name, description?}`-Einträge, die die Skills des Plugins beschreiben.

## Beispiele

### Beispiel 1: Ein passendes Plugin anbieten

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

Die Karte wird für den Benutzer gerendert; das Aktivieren des Plugins erfolgt separat. Rufen Sie zur Nachverfolgung `ListPlugins` auf, um herauszufinden, was tatsächlich installiert wurde.

## Hinweise

- Nehmen Sie nur Plugins auf, die aus Suchergebnissen stammen – erfinden Sie niemals Plugin-Einträge.