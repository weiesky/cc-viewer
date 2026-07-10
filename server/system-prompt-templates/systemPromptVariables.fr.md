# variables de systemPromptModel.md

Ce fichier documente uniquement les variables dans `systemPromptModel.md` qui doivent être résolues au moment de l'exécution. Chaque variable feuille se résout en une chaîne, un nombre ou une chaîne vide `""`; quand une valeur ne peut pas être obtenue, elle revient uniformément à une chaîne vide.

## Espace de travail et environnement utilisateur

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Répertoire de travail principal actuel. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Répertoire de travail d'origine au démarrage du processus/session. | `/Users/sky/claude-code` |
| `${environment.home}` | Répertoire personnel de l'utilisateur, utilisé pour résoudre `~`. | `/Users/sky` |
| `${environment.user}` | Nom d'utilisateur du système actuel. | `sky` |
| `${environment.workspaceRoots}` | Racines d'espace de travail pour la session actuelle; peut être rendu sous la forme d'une chaîne séparée par des sauts de ligne. | `/Users/sky/claude-code` |
| `${environment.path}` | PATH du processus actuel. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Paramètres régionaux actuels ou environnement de langue. | `zh_CN.UTF-8` |

## Système d'exploitation

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Plateforme identifiée par Node.js. | `darwin` |
| `${os.type}` | Type de système d'exploitation. | `Darwin` |
| `${os.arch}` | Architecture du processeur. | `arm64` |
| `${os.shell}` | Shell actuel. | `/bin/zsh` |
| `${os.version}` | Description de la version du système d'exploitation. | `Darwin Kernel Version ...` |
| `${os.release}` | Version du système d'exploitation. | `24.5.0` |
| `${os.hostname}` | Nom d'hôte actuel. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Parallélisme disponible. | `10` |
| `${os.totalMemory}` | Mémoire totale du système, en octets. | `34359738368` |
| `${os.freeMemory}` | Mémoire libre, en octets. | `8589934592` |
| `${os.uptime}` | Temps de fonctionnement du système, en secondes. | `123456` |

## Exécution de Node.js

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Version actuelle de Node.js. | `v24.14.0` |
| `${runtime.execPath}` | Chemin de l'exécutable Node.js actuel. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | ID du processus actuel. | `12345` |
| `${runtime.ppid}` | ID du processus parent. | `1234` |

## Heure

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Chaîne d'heure locale actuelle. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Heure ISO actuelle. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Date locale actuelle. | `2026-07-09` |
| `${time.timezone}` | Fuseau horaire du système actuel. | `Asia/Shanghai` |

## Permissions et sandbox

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Mode de permission de l'outil actuel. | `default` |
| `${permissions.approvalsReviewer}` | Politique d'approbation actuelle ou mode de révision. | `auto_review` |
| `${sandbox.mode}` | Mode de bac à sable du système de fichiers. | `workspace-write` |
| `${sandbox.networkAccess}` | État d'accès au réseau. | `enabled` |
| `${sandbox.writableRoots}` | Répertoires où le bac à sable autorise l'écriture; peut être rendu sous la forme d'une chaîne séparée par des sauts de ligne. | `/Users/sky/Documents/Playground` |

## Terminal

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | TERM actuel. | `xterm-256color` |
| `${terminal.colorTerm}` | COLORTERM actuel. | `truecolor` |
| `${terminal.columns}` | Nombre actuel de colonnes du terminal. | `120` |
| `${terminal.rows}` | Nombre actuel de lignes du terminal. | `40` |

## Système de fichiers

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | Répertoire temporaire du système. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Séparateur de chemin de fichier. | `/` |
| `${filesystem.pathDelimiter}` | Délimiteur d'entrée PATH. | `:` |

## Modèle

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Nom ou ID du modèle actuel. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Limite de connaissances du modèle actuel; cette valeur ne peut pas être dérivée du système d'exploitation et doit être injectée via la configuration externe ou une substitution. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Si le répertoire actuel se trouve dans un référentiel Git, en tant que chaîne. | `true` |
| `${git.root}` | Répertoire racine du référentiel Git. | `/Users/sky/project` |
| `${git.branch}` | Branche Git actuelle ou hachage HEAD court. | `main` |
| `${git.mainBranch}` | Branche principale par défaut, généralement utilisée comme cible de PR ou de fusion. | `main` |
| `${git.userName}` | Élément `user.name` Git actuel. | `Sky` |
| `${git.status}` | Sortie de `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Résumé des commits récents. | `abc1234 Fix prompt builder` |

## Mémoire

Les variables de mémoire décrivent le répertoire de mémoire persistant basé sur des fichiers. `${memory.dir}` est résolu à partir de la substitution `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` lorsqu'elle est définie; sinon, elle est calculée comme `<home>/.claude/projects/<slug>/memory/`, où `<slug>` est le répertoire de travail principal avec chaque caractère non-alphanumérique remplacé par `-`. `${memory.index}` contient le contenu de `MEMORY.md` dans ce répertoire (l'index chargé chaque session), et `${memory.enabled}` indique si la mémoire est disponible. Les sections `# Memory` et `# Memory index` ne sont assemblées que lorsque la mémoire est activée.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Répertoire de mémoire résolu. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Contenu de `MEMORY.md`, ou `""` s'il est absent. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Si la mémoire est disponible, sous forme de chaîne. | `true` |

## Bloc-notes

Le répertoire du bloc-notes est spécifique à la session et ne peut pas être dérivé du système d'exploitation; il doit être injecté via la substitution `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR`. S'il n'est pas défini, il revient à `""`, et la section `# Scratchpad Directory` est omise de l'assemblage.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Répertoire temporaire spécifique à la session. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
