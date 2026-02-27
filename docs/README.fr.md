# CC-Viewer

Système de surveillance des requêtes pour Claude Code, capturant et visualisant en temps réel toutes les requêtes et réponses API (texte original, sans troncature). Permet aux développeurs de surveiller leur Context afin de revoir et diagnostiquer les problèmes lors du Vibe Coding.

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | Français | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Utilisation

### Installation

```bash
npm install -g cc-viewer
```

### Exécution et configuration automatique

```bash
ccv
```

Cette commande détecte automatiquement la méthode d'installation locale de Claude Code (NPM ou Native Install) et s'adapte en conséquence.

- **Installation NPM** : Injecte automatiquement le script d'interception dans `cli.js` de Claude Code.
- **Native Install** : Détecte automatiquement le binaire `claude`, configure un proxy transparent local et met en place un Zsh Shell Hook pour acheminer automatiquement le trafic.

### Remplacement de configuration (Configuration Override)

Si vous devez utiliser un point de terminaison API personnalisé (par exemple, un proxy d'entreprise), configurez-le simplement dans `~/.claude/settings.json` ou définissez la variable d'environnement `ANTHROPIC_BASE_URL`. `ccv` reconnaîtra automatiquement ces paramètres et transmettra les requêtes correctement.

### Mode silencieux (Silent Mode)

Par défaut, `ccv` s'exécute en mode silencieux lors de l'enveloppement de `claude`, garantissant que votre sortie de terminal reste propre et identique à l'expérience native. Tous les journaux sont capturés en arrière-plan et visibles sur `http://localhost:7008`.

Une fois la configuration terminée, utilisez la commande `claude` comme d'habitude. Ouvrez `http://localhost:7008` pour afficher l'interface de surveillance.

### Dépannage (Troubleshooting)

- **Sortie mixte (Mixed Output)** : Si vous voyez des journaux de débogage `[CC-Viewer]` mélangés à la sortie de Claude, veuillez mettre à jour vers la dernière version (`npm install -g cc-viewer`).
- **Connexion refusée (Connection Refused)** : Assurez-vous que le processus d'arrière-plan `ccv` est en cours d'exécution. L'exécution de `ccv` ou `claude` (après l'installation du hook) devrait le démarrer automatiquement.
- **Pas de Body (Empty Body)** : Si vous voyez « No Body » dans le visualiseur, cela peut être dû à des formats SSE non standard. Le visualiseur prend désormais en charge la capture de contenu brut comme solution de repli.

### Désinstallation

```bash
ccv --uninstall
```

### Vérifier la version

```bash
ccv --version
```

## Fonctionnalités

### Surveillance des requêtes (mode texte original)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Capture en temps réel de toutes les requêtes API de Claude Code — texte original, pas des logs tronqués (c'est important !!!)
- Identification et étiquetage automatiques des requêtes Main Agent et Sub Agent (sous-types : Bash, Task, Plan, General)
- Les requêtes MainAgent prennent en charge Body Diff JSON, affichant en mode replié les différences avec la requête MainAgent précédente (uniquement les champs modifiés/ajoutés)
- Statistiques d'utilisation des Token en ligne par requête (tokens d'entrée/sortie, création/lecture de cache, taux de succès)
- Compatible avec Claude Code Router (CCR) et autres scénarios de proxy — détection des requêtes par motif de chemin API en secours

### Mode conversation

Cliquez sur le bouton « Mode conversation » en haut à droite pour analyser l'historique complet de conversation du Main Agent sous forme d'interface de chat :
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- L'affichage des Agent Teams n'est pas encore pris en charge
- Messages utilisateur alignés à droite (bulles bleues), réponses du Main Agent alignées à gauche (bulles sombres)
- Les blocs `thinking` sont repliés par défaut, rendus en Markdown, cliquez pour déplier et voir le processus de réflexion ; traduction en un clic prise en charge (fonctionnalité encore instable)
- Les messages de sélection utilisateur (AskUserQuestion) sont affichés au format question-réponse
- Synchronisation bidirectionnelle des modes : le passage au mode conversation navigue automatiquement vers la conversation de la requête sélectionnée ; le retour au mode texte original navigue automatiquement vers la requête sélectionnée
- Panneau de paramètres : possibilité de basculer l'état de repli par défaut des résultats d'outils et des blocs de réflexion


### Outils de statistiques

Panneau flottant « Statistiques de données » dans la zone d'en-tête :
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Affichage des compteurs de cache creation/read et du taux de succès du cache
- Statistiques de reconstruction du cache : regroupées par raison (TTL, changement de system/tools/model, troncature/modification de messages, changement de key) avec le nombre d'occurrences et les tokens cache_creation
- Statistiques d'utilisation des outils : fréquence d'appel par outil, triées par nombre d'appels
- Statistiques d'utilisation des Skills : fréquence d'appel par Skill, triées par nombre d'appels
- Icônes d'aide conceptuelle (?) : cliquez pour consulter la documentation intégrée de MainAgent, CacheRebuild et chaque outil

### Gestion des logs

Via le menu déroulant CC-Viewer en haut à gauche :
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Importer des logs locaux : parcourir les fichiers de log historiques, regroupés par projet, s'ouvre dans une nouvelle fenêtre
- Charger un fichier JSONL local : sélectionner et charger directement un fichier `.jsonl` local (jusqu'à 500 Mo)
- Enregistrer le log actuel sous : télécharger le fichier de log JSONL de surveillance actuel
- Fusionner les logs : combiner plusieurs fichiers de log JSONL en une seule session pour une analyse unifiée
- Voir les Prompts utilisateur : extraire et afficher toutes les entrées utilisateur, avec trois modes de vue — mode Original (contenu brut), mode Contexte (étiquettes système repliables), mode Texte (texte brut) ; les commandes slash (`/model`, `/context`, etc.) sont affichées comme entrées indépendantes ; les étiquettes liées aux commandes sont automatiquement masquées du contenu du Prompt
- Exporter les Prompts en TXT : exporter les Prompts utilisateur (texte brut, sans étiquettes système) dans un fichier `.txt` local

### Support multilingue

CC-Viewer prend en charge 18 langues et bascule automatiquement en fonction de la langue du système :

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
