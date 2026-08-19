# ReadNotifications

Lit les notifications en file d'attente pour l'assistant dans la session courante — activité GitHub sur les PR suivies (`github_webhook`), déclenchements planifiés (`trigger_fire`) et messages provenant d'autres sessions Claude (`mcp_send_message`).

## Quand l'utiliser

- Vous avez été notifié que quelque chose s'est produit — une PR suivie a été mise à jour, un déclencheur planifié s'est déclenché, une autre session vous a envoyé un message — et vous avez besoin de la charge utile réelle.
- Vider un arriéré : les gros lots sont renvoyés en plusieurs parties, continuez donc à appeler jusqu'à ce que le résultat indique 0 `remaining`.

## Paramètres

Cet outil ne prend aucun paramètre.

## Exemples

### Exemple 1 : vider les notifications en attente

```
ReadNotifications()
```

Renvoie les notifications en file d'attente, les plus anciennes d'abord. Le résultat inclut un compte `remaining` des notifications encore en attente après cette lecture — appelez à nouveau l'outil pour les lire.

## Notes

- Les lectures sont limitées en taille : un appel suivant renvoie le reste de la MÊME file (plus tout ce qui est nouvellement arrivé), pas seulement les nouvelles arrivées. Bouclez jusqu'à ce que `remaining` soit 0.
- Les notifications proviennent des webhooks GitHub sur les PR suivies, des déclencheurs planifiés et des messages d'autres sessions Claude ; il n'y a pas de paramètre de filtrage dans la version courante.
