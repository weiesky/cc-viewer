# CC-Viewer

🌐 **Site web et visite des fonctionnalités: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — disponible en 18 langues.


Une boîte à outils Vibe Coding distillée à partir de l'expérience de développement personnelle, construite sur Claude Code :

1. Élever le plafond des capacités : exécutez /ultraPlan et /ultraReview localement, afin que le code de votre projet n'ait jamais besoin d'être entièrement exposé au cloud de Claude ;
2. Compatibilité multiplateforme : permet la programmation mobile (au sein du LAN) ; la version web s'adapte à divers scénarios, facile à intégrer aux extensions de navigateur et aux vues partagées du système d'exploitation, et fournit un installateur natif ;
3. Journalisation complète : offre des capacités complètes d'interception et d'analyse de la charge utile de Claude Code, idéal pour la journalisation, l'analyse des problèmes, l'apprentissage, l'inspiration et le rétro-ingénierie ;
4. Partage d'apprentissage et d'expérience : de nombreux supports d'apprentissage et expériences de développement ont été accumulés (voir les icônes « ? » dans tout le système) ;
5. Expérience native préservée : étend uniquement les capacités de Claude Code, sans modifications substantielles du noyau, préservant l'expérience native ;
6. Prise en charge des modèles tiers : compatible avec deepseek-v4-\*, GLM 5.1, Kimi K2.6, avec la capacité cc-switch intégrée pour commuter à chaud entre les outils tiers à tout moment. La boîte de dialogue de commutation à chaud prend également en charge des sources par rôle — Main Agent, Sub-Agents et Teammates peuvent chacun utiliser un profil de proxy différent (par défaut : suivre le Main Agent) ; lorsque le Main Agent utilise le Default intégré avec l'endpoint officiel, l'attribution des rôles reste masquée et dormante.

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | Français | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Utilisation

### Prérequis

* Assurez-vous d'avoir Node.js 20.0.0+ installé ; [Télécharger et installer](https://nodejs.org)
* Assurez-vous d'avoir Claude Code installé ; [Tutoriel d'installation](https://github.com/anthropics/claude-code)

### Installer ccv

#### Installation via npm

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### Installation via Homebrew (recommandé pour macOS / Linux)

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # pour les mises à jour — n'utilisez PAS npm install -g avec les installations brew
```

#### Installation via pnpm (global)

```bash
pnpm add -g cc-viewer
pnpm add -g cc-viewer@latest   # pour les mises à jour — n'utilisez PAS npm install -g avec les installations pnpm
```

### Lancement

ccv est un remplacement direct de claude — tous les arguments sont transmis à claude tout en lançant le Web Viewer.

```bash
ccv                    # == claude (mode interactif)
```

La commande que l'auteur lui-même utilise le plus souvent est :

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv transmet tous les paramètres de démarrage de Claude Code — vous pouvez les combiner comme vous le souhaitez
```

Après le démarrage en mode programmation, une page web s'ouvrira automatiquement.

cc-viewer est également distribué en tant qu'application de bureau native : [Page de téléchargement](https://github.com/weiesky/cc-viewer/releases)

### Mise à niveau vers 1.7.0 (format de log v2)

Depuis la version 1.7.0, les logs sont stockés dans un format de répertoire par session (wire-format v2) au lieu de fichiers `.jsonl` uniques — environ 90 % d'espace disque en moins. Les fichiers `.jsonl` v1 existants ne sont jamais modifiés ni supprimés ; la boîte de dialogue des logs affiche par défaut les sessions v2, et une petite entrée « Afficher les logs hérités (v1) » (visible tant que d'anciens fichiers existent) ouvre une vue v1 où ils peuvent être consultés, migrés ou supprimés. Au démarrage, cc-viewer propose une migration en un clic lorsque des logs hérités sont détectés (fortement recommandée lorsque vous poursuivez une ancienne conversation avec `claude -c`, dont la première moitié réside dans les anciens fichiers). Vous pouvez également migrer depuis le terminal :

```bash
ccv convert <project>   # migrer un projet
ccv convert --all       # migrer tous les projets
ccv verify <v1-file>    # vérifier un fichier v1 par rapport à ses sessions converties
```

Si une session échoue à la vérification golden, elle est mise de côté dans `sessions-quarantine/` pour inspection au lieu de faire échouer toute la migration — les autres sessions sont tout de même migrées.

### Mode Logger

Si vous préférez toujours l'outil natif claude ou l'extension VS Code, utilisez ce mode.

Dans ce mode, le démarrage de `claude`

lancera automatiquement un processus de journalisation qui enregistre les journaux de requêtes dans des répertoires par session sous \~/.claude/cc-viewer/*yourproject*/sessions/ (wire-format v2)

Activer le mode logger :

```bash
ccv -logger
```

Lorsque la console ne peut pas imprimer le port spécifique, le premier port par défaut est 127.0.0.1:7008. Les instances multiples utilisent des ports séquentiels comme 7009, 7010.

Désinstaller le mode logger :

```bash
ccv --uninstall
```

### Dépannage (Troubleshooting)

Si vous rencontrez des problèmes au démarrage de cc-viewer, voici l'approche ultime pour le dépannage :
Étape 1 : Ouvrez Claude Code dans n'importe quel répertoire.
Étape 2 : Donnez à Claude Code l'instruction suivante :

```
J'ai installé le package npm cc-viewer, mais après avoir exécuté ccv, il ne fonctionne toujours pas correctement. Veuillez consulter cli.js et findcc.js de cc-viewer, et les adapter au déploiement local de Claude Code en fonction de l'environnement spécifique. Limitez autant que possible la portée des modifications à findcc.js.
```

Laisser Claude Code diagnostiquer lui-même le problème est plus efficace que de demander à quiconque ou de lire n'importe quelle documentation !

Une fois l'instruction ci-dessus terminée, findcc.js sera mis à jour. Si votre projet nécessite fréquemment un déploiement local, ou si le code forké doit souvent résoudre des problèmes d'installation, conserver ce fichier vous permet simplement de le copier la prochaine fois. À l'heure actuelle, de nombreux projets et entreprises utilisant Claude Code ne déploient pas sur Mac mais dans des environnements hébergés côté serveur, c'est pourquoi l'auteur a séparé le fichier findcc.js pour faciliter le suivi des mises à jour du code source de cc-viewer à l'avenir.

Remarque : cette application est en conflit avec claude-code-switch et claude-code-router en raison de la concurrence de proxy, donc lors de son utilisation, assurez-vous de fermer claude-code-switch et claude-code-router. cc-viewer inclut une capacité de mise à jour à chaud du proxy en remplacement équivalent.

### Autres commandes auxiliaires

Consultez :

```bash
ccv -h
```

### Mode silencieux (Silent Mode)

Par défaut, `ccv` s'exécute en mode silencieux lorsqu'il enveloppe `claude`, gardant la sortie du terminal propre et cohérente avec l'expérience native. Tous les journaux sont capturés en arrière-plan et peuvent être consultés sur `http://localhost:7008`.

Une fois configuré, utilisez la commande `claude` normalement. Visitez `http://localhost:7008` pour accéder à l'interface de surveillance.

## Fonctionnalités

### Mode Programmation

Après le démarrage avec ccv, vous pouvez voir :

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

Vous pouvez voir les différences de code directement après l'édition :

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Bien que vous puissiez ouvrir des fichiers et coder manuellement, la programmation manuelle n'est pas recommandée — c'est une programmation à l'ancienne !

### Programmation mobile

Vous pouvez même scanner un code QR pour programmer depuis votre appareil mobile :

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

Réalisez votre imagination de la programmation mobile. Il existe également un mécanisme de plugins — si vous avez besoin de personnaliser selon vos habitudes de codage, surveillez les mises à jour des hooks de plugins.

### Prompts système par modèle

La fenêtre modale **Modifier le prompt système** (menu hamburger → Modifier le prompt système) est organisée en onglets :

* L'onglet **Défaut** conserve le comportement classique : il écrit `CC_SYSTEM.md` (remplacer) ou `CC_APPEND_SYSTEM.md` (ajouter) dans l'espace de travail courant, injecté via `--system-prompt-file` / `--append-system-prompt-file` au prochain lancement de ccv.
* **Onglets de modèle** : cliquez sur **+ Ajouter un modèle**, saisissez un nom comme `opus` ou `Gemini3`, puis choisissez une portée — **Global** (`~/.claude/cc-viewer/system_prompt/`, s'applique à tous les espaces de travail) ou **Espace de travail** (`<project>/system_prompt/`). Le champ de nom propose des suggestions de saisie à partir de vos modèles configurés localement (profils proxy rechargés à chaud et `settings.json`) ; les noms déjà ajoutés dans la portée choisie sont masqués, et les noms libres arbitraires restent autorisés. Chaque onglet possède son propre commutateur Ajouter/Remplacer et son aperçu Markdown.
* Les entrées sont stockées sous forme de fichiers en majuscules : `OPUS_SYSTEM.md` (remplacer) ou `OPUS_APPEND_SYSTEM.md` (ajouter). La correspondance est approximative — une sous-chaîne insensible à la casse de l'ID de modèle résolu à partir de la configuration ACTIVE (mappage de modèle du proxy profile tiers actif > variables d'environnement `ANTHROPIC_MODEL`/`CLAUDE_MODEL` au lancement > `model` de `settings.json` ; sans signal de configuration, aucune entrée n'est injectée), de sorte que `opus` correspond à `claude-opus-4-8[1m]` quelle que soit la version. Une correspondance au niveau de l'espace de travail l'emporte sur une correspondance globale ; au sein d'une même portée, le nom le plus long gagne ; une entrée correspondante remplace entièrement les fichiers de l'onglet Défaut pour ce lancement. Limitations connues : un changement de proxy profile en cours de session n'est re-mis en correspondance qu'après redémarrage de la session claude ; un indicateur `--model` transmis via des arguments supplémentaires n'est pas pris en compte.
* Enregistrer un onglet vide supprime l'entrée. Les changements de modèle effectués en cours de session s'appliquent au prochain relancement. Définissez `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1` pour désactiver toute injection automatique. Vous pouvez committer `<project>/system_prompt/` pour partager les prompts avec votre équipe, ou l'ajouter à `.gitignore` pour les garder privés.

### Mode Logger (Visualiser les sessions complètes de Claude Code)

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* Capture toutes les requêtes API de Claude Code en temps réel, garantissant le texte brut — pas de journaux censurés (c'est important !!!)
* Identifie et étiquette automatiquement les requêtes Main Agent et Sub Agent (sous-types : Plan, Search, Bash)
* Les requêtes MainAgent prennent en charge Body Diff JSON, affichant les différences pliées par rapport à la requête MainAgent précédente (uniquement les champs modifiés/nouveaux)
* Chaque requête affiche les statistiques d'utilisation des Token en ligne (Tokens d'entrée/sortie, création/lecture de cache, taux de succès)
* Compatible avec Claude Code Router (CCR) et autres scénarios de proxy — recourt au modèle de chemin API

<a href="https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&theme=dark&legend=top-left" />

    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left" />

    ![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left)
  </picture>
</a>

## License

MIT
