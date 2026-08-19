# ReadNotifications

Læser notifikationer, der er sat i kø til assistenten i den aktuelle session — GitHub-aktivitet på abonnerede PR'er (`github_webhook`), udløste planlagte triggere (`trigger_fire`) og beskeder, der ankommer fra andre Claude-sessioner (`mcp_send_message`).

## Hvornår skal den bruges

- Du blev notificeret om, at noget skete — en abonneret PR blev opdateret, en planlagt trigger blev udløst, en anden session sendte dig en besked — og har brug for den faktiske nyttelast.
- At tømme en backlog: store partier returneres i dele, så bliv ved med at kalde, indtil resultatet rapporterer 0 `remaining`.

## Parametre

Dette værktøj tager ingen parametre.

## Eksempler

### Eksempel 1: Tøm afventende notifikationer

```
ReadNotifications()
```

Returnerer notifikationer i kø, ældste først. Resultatet inkluderer et `remaining`-antal af notifikationer, der stadig står i kø efter denne tømning — kald værktøjet igen for at læse dem.

## Noter

- Tømninger er størrelsesbudgetterede: et opfølgende kald returnerer resten af den SAMME kø (plus alt, der er ankommet siden), ikke kun nye ankomster. Loop indtil `remaining` er 0.
- Notifikationer stammer fra GitHub-webhooks på abonnerede PR'er, planlagte triggere og beskeder fra andre Claude-sessioner; der er ingen filtreringsparameter i den nuværende version.
