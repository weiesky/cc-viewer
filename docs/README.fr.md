# CC-Viewer

Un système de surveillance des requêtes pour Claude Code qui capture et visualise toutes les requêtes et réponses API en temps réel. Aide les développeurs à surveiller leur Context pour la revue et le débogage pendant le Vibe Coding.

[简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Utilisation

```bash
npm install -g cc-viewer
```

Après l'installation, exécutez :

```bash
ccv
```

Cette commande détecte automatiquement la méthode d'installation locale de Claude Code (NPM ou Native Install) et s'adapte.

- **Installation NPM** : Injecte automatiquement le script d'interception dans `cli.js` de Claude Code.
- **Native Install** : Détecte automatiquement le binaire `claude`, configure un proxy transparent local et configure un Hook Shell Zsh pour acheminer automatiquement le trafic.

### Remplacement de configuration (Configuration Override)

Si vous devez utiliser un point de terminaison API personnalisé (par exemple, un proxy d'entreprise), configurez-le simplement dans `~/.claude/settings.json` ou définissez la variable d'environnement `ANTHROPIC_BASE_URL`. `ccv` reconnaîtra automatiquement ces paramètres et transmettra les requêtes correctement.

### Mode silencieux (Silent Mode)

Par défaut, `ccv` s'exécute en mode silencieux lors de l'enveloppement de `claude`, garantissant que votre sortie de terminal reste propre et identique à l'expérience Claude Code d'origine. Tous les journaux sont capturés en arrière-plan et visibles sur `http://localhost:7008`.

Utilisez ensuite Claude Code comme d'habitude et ouvrez `http://localhost:7008` dans votre navigateur pour afficher l'interface de surveillance.

### Dépannage (Troubleshooting)

- **Sortie mixte (Mixed Output)** : Si vous voyez des journaux de débogage `[CC-Viewer]` mélangés à la sortie de Claude, veuillez mettre à jour vers la dernière version (`npm install -g cc-viewer`).
- **Connexion refusée (Connection Refused)** : Assurez-vous que le processus d'arrière-plan `ccv` est en cours d'exécution. L'exécution de `ccv` ou `claude` (après l'installation du hook) devrait le démarrer automatiquement.
- **Corps vide (Empty Body)** : Si vous voyez "No Body" dans le visualiseur, cela peut être dû à des formats SSE non standard. Le visualiseur prend désormais en charge la capture de contenu brut comme solution de repli.

### Vérifier la version (Check Version)

```bash
ccv --version
```

### Désinstallation

```bash
ccv --uninstall
```

## Fonctionnalités

### Surveillance des requêtes (Raw Mode)

- Capture en temps réel de toutes les requêtes API de Claude Code, y compris les réponses en streaming
- Le panneau gauche affiche la méthode de requête, l'URL, la durée et le code de statut
- Identification et étiquetage automatiques des requêtes Main Agent et Sub Agent (sous-types : Bash, Task, Plan, General)
- La liste des requêtes défile automatiquement vers l'élément sélectionné (centré lors du changement de mode, le plus proche lors d'un clic manuel)
- Le panneau droit prend en charge le basculement entre les onglets Request / Response
- Le Request Body déplie `messages`, `system`, `tools` d'un niveau par défaut
- Le Response Body entièrement déplié par défaut
- Basculement entre la vue JSON et la vue texte brut
- Copie du contenu JSON en un clic
- Les requêtes MainAgent prennent en charge Body Diff JSON, affichant en mode replié les différences avec la requête MainAgent précédente (uniquement les champs modifiés/ajoutés)
- La section Diff prend en charge le basculement entre la vue JSON et la vue texte, ainsi que la copie du contenu en un clic
- Paramètre « Expand Diff » : lorsqu'il est activé, les requêtes MainAgent déplient automatiquement la section Diff
- L'infobulle Body Diff JSON peut être fermée ; une fois fermée, la préférence est sauvegardée côté serveur et ne s'affiche plus
- Les en-têtes sensibles (`x-api-key`, `authorization`) sont automatiquement masqués dans les fichiers de log JSONL pour éviter les fuites de credentials
- Statistiques d'utilisation des Token en ligne par requête (tokens d'entrée/sortie, création/lecture de cache, taux de succès)
- Compatible avec Claude Code Router (CCR) et autres configurations proxy — détection des requêtes par motif de chemin API en secours

### Chat Mode

Cliquez sur le bouton « Chat mode » en haut à droite pour analyser l'historique complet de conversation du Main Agent dans une interface de chat :

- Messages utilisateur alignés à droite (bulles bleues), réponses du Main Agent alignées à gauche (bulles sombres) avec rendu Markdown
- Messages `/compact` détectés automatiquement et affichés repliés, cliquez pour déplier le résumé complet
- Résultats des appels d'outils affichés en ligne dans le message Assistant correspondant
- Blocs `thinking` repliés par défaut, rendus en Markdown, cliquez pour déplier ; traduction en un clic prise en charge
- `tool_use` affiché sous forme de cartes compactes d'appel d'outils (Bash, Read, Edit, Write, Glob, Grep, Task ont chacun un affichage dédié)
- Résultats des outils Task (SubAgent) rendus en Markdown
- Messages de sélection utilisateur (AskUserQuestion) affichés au format question-réponse
- Balises système (`<system-reminder>`, `<project-reminder>`, etc.) auto-repliées
- Messages de chargement de Skill détectés automatiquement et repliés, affichant le nom du Skill ; cliquer pour déplier la documentation complète (rendu Markdown)
- Skills reminder détecté automatiquement et replié
- Texte système auto-filtré, affichant uniquement les saisies réelles de l'utilisateur
- Affichage segmenté multi-session (segmentation automatique après `/compact`, `/clear`, etc.)
- Chaque message affiche un horodatage précis à la seconde, dérivé du timing de la requête API
- Chaque message comporte un lien « Voir la requête » pour revenir au mode raw à la requête API correspondante
- Synchronisation bidirectionnelle des modes : le passage au mode chat fait défiler vers la conversation correspondant à la requête sélectionnée ; le retour fait défiler vers la requête sélectionnée
- Panneau de paramètres : basculer l'état de repli par défaut pour les résultats d'outils et les blocs de réflexion
- Paramètres globaux : activer/désactiver le filtrage des requêtes non pertinentes (count_tokens, heartbeat)

### Traduction

- Les blocs thinking et les messages de l'Assistant prennent en charge la traduction en un clic
- Basé sur l'API Claude Haiku, prend en charge l'authentification par API Key (`x-api-key`) et OAuth Bearer Token
- Les résultats de traduction sont mis en cache automatiquement ; cliquez à nouveau pour revenir au texte original
- Animation de chargement rotative affichée pendant la traduction

### Statistiques de Token

Panneau au survol dans la zone d'en-tête :

- Comptage de Token regroupé par modèle (entrée/sortie)
- Compteurs de création/lecture de Cache et taux de succès du Cache
- Statistiques de reconstruction du Cache regroupées par raison (TTL, changement de system/tools/modèle, troncature/modification de messages, changement de clé) avec le nombre d'occurrences et les tokens cache_creation
- Statistiques d'utilisation des outils : nombre d'appels par outil, triés par fréquence
- Statistiques d'utilisation des Skills : fréquence d'appel par Skill, triées par fréquence
- Icônes d'aide conceptuelle (?) : cliquez pour consulter la documentation intégrée de MainAgent, CacheRebuild et chaque outil
- Compte à rebours d'expiration du Cache du Main Agent

### Gestion des Logs

Via le menu déroulant CC-Viewer en haut à gauche :

- Importer des logs locaux : parcourir les fichiers de log historiques, regroupés par projet, s'ouvre dans une nouvelle fenêtre
- Charger un fichier JSONL local : sélectionner et charger directement un fichier `.jsonl` local (jusqu'à 200 Mo)
- Télécharger le log actuel : télécharger le fichier de log JSONL de surveillance actuel
- Fusionner les logs : combiner plusieurs fichiers de log JSONL en une seule session pour une analyse unifiée
- Voir les Prompts utilisateur : extraire et afficher toutes les entrées utilisateur avec trois modes d'affichage — mode Original (contenu brut), mode Contexte (balises système repliables), mode Texte (texte brut uniquement) ; les commandes slash (`/model`, `/context`, etc.) sont affichées comme entrées indépendantes ; les balises liées aux commandes sont automatiquement masquées du contenu du Prompt
- Exporter les prompts en TXT : exporter les prompts utilisateur (texte uniquement, sans balises système) dans un fichier `.txt` local

### Support multilingue

CC-Viewer prend en charge 18 langues, avec basculement automatique selon la langue du système :

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## Licence

MIT
