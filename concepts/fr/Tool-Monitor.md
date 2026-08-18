# Monitor

Lance un moniteur en arrière-plan qui diffuse des événements depuis un script de longue durée. Chaque ligne de la sortie standard devient une notification — continuez à travailler pendant que les événements arrivent dans le chat.

## Quand l'utiliser

- Suivre les erreurs, avertissements ou signatures de crash dans un fichier journal pendant qu'un déploiement s'exécute
- Interroger une API distante, une PR ou un pipeline CI toutes les 30 secondes pour détecter de nouveaux événements de statut
- Surveiller les changements dans un répertoire du système de fichiers ou dans la sortie de compilation en temps réel
- Attendre une condition spécifique sur de nombreuses itérations (par exemple un jalon d'étape d'entraînement ou le vidage d'une file d'attente)
- **Pas** pour un simple "attendre jusqu'à la fin" — utiliser `Bash` avec `run_in_background` pour cela ; il émet une notification de fin lorsque le processus se termine

## Activation

- Désactivé par défaut (drapeau de fonctionnalité côté serveur).
- Indisponible sur Amazon Bedrock, Google Cloud et Microsoft Foundry.
- Désactivé lorsque `DISABLE_TELEMETRY` ou `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` est défini.
- La source WebSocket nécessite Claude Code 2.1.195+.

## Paramètres

- `command` (chaîne, obligatoire) : La commande shell ou le script à exécuter. Chaque ligne écrite sur la sortie standard devient un événement de notification distinct. Le moniteur se termine quand le processus se termine.
- `description` (chaîne, obligatoire) : Une courte étiquette lisible affichée dans chaque notification. Être précis — "erreurs dans deploy.log" vaut mieux que "surveillance des logs". Cette étiquette identifie quel moniteur s'est déclenché.
- `timeout_ms` (nombre, défaut `300000`, max `3600000`) : Délai de terminaison forcée en millisecondes. Après cette durée le processus est arrêté. Ignoré quand `persistent: true`.
- `persistent` (booléen, défaut `false`) : Quand `true`, le moniteur s'exécute pendant toute la durée de la session sans délai d'expiration. L'arrêter explicitement avec `TaskStop`.

## Exemples

### Exemple 1 : Suivre un fichier journal pour les erreurs et les crashs

Cet exemple couvre tous les états terminaux : marqueur de succès, traceback, mots-clés d'erreur courants, arrêt OOM et sortie inattendue du processus.

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

Utiliser `grep --line-buffered` dans chaque pipe. Sans cela, le système d'exploitation met en tampon la sortie par blocs de 4 Ko et les événements peuvent être retardés de plusieurs minutes. Le motif d'alternance couvre à la fois le chemin de succès (`deployed`) et les chemins d'échec (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`). Un moniteur qui observe uniquement le marqueur de succès reste silencieux lors d'un crash — le silence est identique à "toujours en cours d'exécution".

### Exemple 2 : Interroger une API distante toutes les 30 secondes

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` empêche une défaillance réseau transitoire de mettre fin à la boucle. Des intervalles d'interrogation de 30 secondes ou plus conviennent aux APIs distantes pour éviter les limites de débit. Ajuster le motif grep pour capturer à la fois les réponses de succès et d'échec afin que les erreurs côté API ne soient pas masquées par le silence.

## Notes

- **Toujours utiliser `grep --line-buffered` dans les pipes.** Sans cela, la mise en tampon des pipes retarde les événements de plusieurs minutes car le système d'exploitation accumule la sortie jusqu'à remplir un bloc de 4 Ko. `--line-buffered` force un vidage après chaque ligne.
- **Le filtre doit couvrir à la fois les signatures de succès et d'échec.** Un moniteur qui observe uniquement le marqueur de succès reste silencieux en cas de crash, de blocage ou de sortie inattendue. Élargir l'alternance : inclure `Error`, `Traceback`, `FAILED`, `Killed`, `OOM` et des marqueurs d'état terminal similaires aux côtés du mot-clé de succès.
- **Intervalles d'interrogation : 30 secondes ou plus pour les APIs distantes.** L'interrogation fréquente de services externes risque des erreurs de limite de débit ou des blocages. Pour les vérifications locales du système de fichiers ou des processus, 0,5–1 seconde est approprié.
- **Utiliser `persistent: true` pour les moniteurs de durée de session.** Le `timeout_ms` par défaut de 300 000 ms (5 minutes) arrête le processus. Pour les moniteurs qui doivent s'exécuter jusqu'à un arrêt explicite, définir `persistent: true` et appeler `TaskStop` quand c'est terminé.
- **Arrêt automatique en cas de flood d'événements.** Chaque ligne de la sortie standard est un message de conversation. Si le filtre est trop large et produit trop d'événements, le moniteur est automatiquement arrêté. Redémarrer avec un motif `grep` plus restrictif. Les lignes arrivant dans les 200 ms sont regroupées en une seule notification.
