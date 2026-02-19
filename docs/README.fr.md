# CC-Viewer

Un système de surveillance des requêtes pour Claude Code qui capture et visualise toutes les requêtes et réponses API en temps réel. Aide les développeurs à surveiller leur Context pour la revue et le débogage pendant le Vibe Coding.

[简体中文](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Utilisation

```bash
npm install -g cc-viewer
```

Après l'installation, exécutez :

```bash
ccv
```

Cette commande configure automatiquement votre Claude Code installé localement pour la surveillance et ajoute un hook de réparation automatique dans votre configuration shell (`~/.zshrc` ou `~/.bashrc`). Utilisez ensuite Claude Code comme d'habitude et ouvrez `http://localhost:7008` dans votre navigateur pour afficher l'interface de surveillance.

Après une mise à jour de Claude Code, aucune action manuelle n'est nécessaire — au prochain lancement de `claude`, la détection et la reconfiguration se feront automatiquement.

### Désinstallation

```bash
ccv --uninstall
```

## Fonctionnalités

### Surveillance des requêtes (Raw Mode)

- Capture en temps réel de toutes les requêtes API de Claude Code, y compris les réponses en streaming
- Le panneau gauche affiche la méthode de requête, l'URL, la durée et le code de statut
- Identification et étiquetage automatiques des requêtes Main Agent et Sub Agent
- Le panneau droit prend en charge le basculement entre les onglets Request / Response
- Le Request Body déplie `messages`, `system`, `tools` d'un niveau par défaut
- Le Response Body entièrement déplié par défaut
- Basculement entre la vue JSON et la vue texte brut
- Copie du contenu JSON en un clic
- Les requêtes MainAgent prennent en charge Body Diff JSON, affichant en mode replié les différences avec la requête MainAgent précédente (uniquement les champs modifiés/ajoutés)

### Chat Mode

Cliquez sur le bouton « Chat mode » en haut à droite pour analyser l'historique complet de conversation du Main Agent dans une interface de chat :

- Messages utilisateur alignés à droite (bulles bleues), réponses du Main Agent alignées à gauche (bulles sombres) avec rendu Markdown
- Messages `/compact` détectés automatiquement et affichés repliés, cliquez pour déplier le résumé complet
- Résultats des appels d'outils affichés en ligne dans le message Assistant correspondant
- Blocs `thinking` repliés par défaut, cliquez pour déplier
- `tool_use` affiché sous forme de cartes compactes d'appel d'outils (Bash, Read, Edit, Write, Glob, Grep, Task ont chacun un affichage dédié)
- Messages de sélection utilisateur (AskUserQuestion) affichés au format question-réponse
- Balises système (`<system-reminder>`, `<project-reminder>`, etc.) auto-repliées
- Texte système auto-filtré, affichant uniquement les saisies réelles de l'utilisateur
- Affichage segmenté multi-session (segmentation automatique après `/compact`, `/clear`, etc.)
- Chaque message affiche un horodatage précis à la seconde

### Statistiques de Token

Panneau au survol dans la zone d'en-tête :

- Comptage de Token regroupé par modèle (entrée/sortie)
- Compteurs de création/lecture de Cache et taux de succès du Cache
- Compte à rebours d'expiration du Cache du Main Agent

### Gestion des Logs

Via le menu déroulant CC-Viewer en haut à gauche :

- Importer des logs locaux : parcourir les fichiers de log historiques, regroupés par projet, s'ouvre dans une nouvelle fenêtre
- Charger un fichier JSONL local : sélectionner et charger directement un fichier `.jsonl` local (jusqu'à 200 Mo)
- Télécharger le log actuel : télécharger le fichier de log JSONL de surveillance actuel
- Exporter les prompts utilisateur : extraire et afficher toutes les saisies utilisateur, avec vue repliable des system-reminder
- Exporter les prompts en TXT : exporter les prompts utilisateur dans un fichier `.txt` local

### Support multilingue

CC-Viewer prend en charge 18 langues, avec basculement automatique selon la langue du système :

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## Licence

MIT
