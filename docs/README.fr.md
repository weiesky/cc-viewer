# CC-Viewer

Systeme de surveillance des requetes Claude Code, capturant et visualisant en temps reel toutes les requetes et reponses API (texte brut, sans troncature). Permet aux developpeurs de surveiller leur Context afin de faciliter la revue et le diagnostic lors du Vibe Coding.
La derniere version de CC-Viewer propose egalement des solutions de deploiement serveur pour la programmation web, ainsi que des outils de programmation mobile. N'hesitez pas a l'utiliser dans vos projets ; davantage de fonctionnalites de plugins seront disponibles a l'avenir, avec prise en charge du deploiement cloud.

Commencons par la partie interessante -- voici ce que ca donne sur mobile :

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | Français | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Utilisation

### Installation

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Mode programmation

ccv est un substitut direct de claude -- tous les parametres sont transmis a claude, tout en demarrant le Web Viewer.

```bash
ccv                    # == claude (mode interactif)
ccv -c                 # == claude --continue (continuer la derniere conversation)
ccv -r                 # == claude --resume (reprendre la conversation)
ccv -p "hello"         # == claude --print "hello" (mode impression)
ccv --d                # == claude --dangerously-skip-permissions (raccourci)
ccv --model opus       # == claude --model opus
```

La commande que l'auteur utilise le plus souvent :
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

Une fois le mode programmation lance, la page web s'ouvre automatiquement.

Vous pouvez utiliser Claude directement depuis la page web, tout en consultant les requetes completes et les modifications de code.

Et encore mieux : vous pouvez meme programmer depuis un appareil mobile !


### Mode journal

⚠️ Si vous preferez toujours utiliser l'outil natif claude ou le plugin VS Code, utilisez ce mode.

Dans ce mode, lancer ```claude``` ou ```claude --dangerously-skip-permissions```

demarre automatiquement un processus de journalisation qui enregistre les journaux de requetes dans ~/.claude/cc-viewer/*votreprojet*/date.jsonl

Demarrer le mode journal :
```bash
ccv -logger
```

Lorsque le port specifique ne peut pas etre affiche dans la console, le premier port de demarrage par defaut est 127.0.0.1:7008. S'il y a plusieurs instances simultanees, les ports s'incrementent : 7009, 7010, etc.

Cette commande detecte automatiquement le mode d'installation local de Claude Code (NPM ou Native Install) et s'adapte en consequence.

- **Version NPM de Claude Code** : injecte automatiquement un script d'interception dans le fichier `cli.js` de Claude Code.
- **Version Native de Claude Code** : detecte automatiquement le binaire `claude`, configure un proxy transparent local et met en place un Zsh Shell Hook pour rediriger le trafic automatiquement.
- Ce projet recommande l'utilisation de Claude Code installe via NPM.

Desinstaller le mode journal :
```bash
ccv --uninstall
```

### Depannage (Troubleshooting)

Si vous rencontrez des problemes de demarrage, voici une solution ultime :
Etape 1 : ouvrez Claude Code dans n'importe quel repertoire ;
Etape 2 : donnez l'instruction suivante a Claude Code :
```
J'ai installe le package npm cc-viewer, mais apres avoir execute ccv, il ne fonctionne toujours pas correctement. Examine cli.js et findcc.js de cc-viewer, puis adapte-le au mode de deploiement local de Claude Code en fonction de l'environnement specifique. Limite autant que possible les modifications au fichier findcc.js.
```
Laisser Claude Code diagnostiquer lui-meme les erreurs est plus efficace que de consulter qui que ce soit ou de lire n'importe quelle documentation !

Une fois l'instruction executee, findcc.js sera mis a jour. Si votre projet necessite frequemment un deploiement local, ou si le code forke doit souvent resoudre des problemes d'installation, conservez ce fichier -- vous pourrez simplement le copier la prochaine fois. A l'heure actuelle, de nombreux projets et entreprises n'utilisent pas Claude Code sur Mac mais via un deploiement serveur heberge, c'est pourquoi l'auteur a separe le fichier findcc.js pour faciliter le suivi des mises a jour du code source de cc-viewer.

### Autres commandes auxiliaires

Consulter l'aide :
```bash
ccv -h
```

### Remplacement de configuration (Configuration Override)

Si vous devez utiliser un point de terminaison API personnalise (par exemple un proxy d'entreprise), il suffit de le configurer dans `~/.claude/settings.json` ou de definir la variable d'environnement `ANTHROPIC_BASE_URL`. `ccv` le detectera automatiquement et transmettra correctement les requetes.

### Mode silencieux (Silent Mode)

Par defaut, `ccv` fonctionne en mode silencieux lorsqu'il encapsule `claude`, garantissant que la sortie de votre terminal reste propre et coherente avec l'experience native. Tous les journaux sont captures en arriere-plan et consultables via `http://localhost:7008`.

Une fois la configuration terminee, utilisez simplement la commande `claude` comme d'habitude. Accedez a `http://localhost:7008` pour consulter l'interface de surveillance.


## Fonctionnalites


### Mode programmation

Apres avoir lance ccv, vous pouvez voir :

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


Vous pouvez consulter directement le diff du code apres l'edition :

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Bien que vous puissiez ouvrir des fichiers et programmer manuellement, ce n'est pas recommande -- c'est de la programmation a l'ancienne !

### Programmation mobile

Vous pouvez meme scanner un QR code pour programmer sur un appareil mobile :

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

Realisez vos reves de programmation mobile. De plus, un mecanisme de plugins est disponible -- si vous souhaitez personnaliser selon vos habitudes de programmation, vous pourrez suivre les mises a jour des hooks de plugins ulterieurement.

### Mode journal (voir la session complete de Claude Code)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Capture en temps reel de toutes les requetes API emises par Claude Code, garantissant le texte original, et non des journaux tronques (c'est tres important !!!)
- Identification et marquage automatiques des requetes Main Agent et Sub Agent (sous-types : Plan, Search, Bash)
- Les requetes MainAgent prennent en charge Body Diff JSON, affichage replie des differences avec la requete MainAgent precedente (uniquement les champs modifies/ajoutes)
- Affichage en ligne de l'utilisation des Token pour chaque requete (Token d'entree/sortie, creation/lecture de cache, taux de succes)
- Compatible avec Claude Code Router (CCR) et autres scenarios de proxy -- correspondance de secours des requetes via le modele de chemin API

### Mode conversation

Cliquez sur le bouton "Mode conversation" en haut a droite pour visualiser l'historique complet de la conversation du Main Agent dans une interface de chat :

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Ne prend pas encore en charge l'affichage de l'Agent Team
- Messages utilisateur alignes a droite (bulle bleue), reponses du Main Agent alignees a gauche (bulle sombre)
- Les blocs `thinking` sont replies par defaut, rendus en Markdown, cliquez pour developper et voir le processus de reflexion ; prise en charge de la traduction en un clic (fonctionnalite encore instable)
- Les messages de choix utilisateur (AskUserQuestion) sont affiches sous forme de questions-reponses
- Synchronisation bidirectionnelle des modes : lors du passage en mode conversation, positionnement automatique sur la conversation correspondant a la requete selectionnee ; lors du retour en mode brut, positionnement automatique sur la requete selectionnee
- Panneau de parametres : permet de basculer l'etat de repli par defaut des resultats d'outils et des blocs de reflexion
- Navigation de conversation sur mobile : en mode CLI mobile, cliquez sur le bouton "Navigation de conversation" dans la barre superieure pour faire glisser une vue de conversation en lecture seule et parcourir l'historique complet sur mobile

### Outils statistiques

Panneau flottant "Statistiques de donnees" dans la zone d'en-tete :

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- Affichage du nombre de cache creation/read et du taux de succes du cache
- Statistiques de reconstruction du cache : par groupe de raisons (TTL, changement system/tools/model, troncature/modification de messages, changement de cle) avec nombre d'occurrences et tokens cache_creation
- Statistiques d'utilisation des outils : frequence d'appel de chaque outil, triee par nombre d'appels
- Statistiques d'utilisation des Skills : frequence d'appel de chaque Skill, triee par nombre d'appels
- Prise en charge des statistiques de teammates
- Icone d'aide conceptuelle (?) : cliquez pour consulter la documentation integree de MainAgent, CacheRebuild et de chaque outil

### Gestion des journaux

Via le menu deroulant CC-Viewer en haut a gauche :
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**Compression des logs**
Concernant les logs, l'auteur tient a preciser qu'aucune definition officielle d'Anthropic n'a ete modifiee, afin de garantir l'integrite des logs.
Cependant, etant donne que les logs individuels de 1M Opus peuvent devenir extremement volumineux en phase avancee, grace a certaines optimisations des logs MainAgent, l'auteur a pu reduire la taille d'au moins 66% sans gzip.
La methode d'analyse de ces logs compresses peut etre extraite du depot actuel.

### Autres fonctionnalites utiles

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

Vous pouvez localiser rapidement votre prompt grace aux outils de la barre laterale

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

L'interessant KV-Cache-Text vous aide a voir ce que Claude voit reellement

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

Vous pouvez telecharger des images et decrire vos besoins -- Claude a une excellente capacite de comprehension d'images. Et comme vous le savez, vous pouvez coller des captures d'ecran directement avec Ctrl+V ; le contenu complet s'affiche dans le dialogue

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

Vous pouvez creer des plugins personnalises, gerer tous les processus de CC-Viewer et CC-Viewer offre le basculement a chaud d'interfaces tierces (oui, vous pouvez utiliser GLM, Kimi, MiniMax, Qwen, DeepSeek -- bien que l'auteur estime qu'ils sont encore assez faibles actuellement)

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

D'autres fonctionnalites attendent d'etre decouvertes... par exemple : le systeme prend en charge Agent Team et integre un Code Reviewer. L'integration du Code Reviewer de Codex arrive bientot (l'auteur recommande vivement d'utiliser Codex pour faire du Code Review sur Claude Code)


### Mise a jour automatique

CC-Viewer verifie automatiquement les mises a jour au demarrage (une fois toutes les 4 heures maximum). Les mises a jour au sein d'une meme version majeure (par exemple 1.x.x -> 1.y.z) sont appliquees automatiquement et prennent effet au prochain demarrage. Les changements de version majeure affichent uniquement une notification.

La mise a jour automatique suit la configuration globale de Claude Code `~/.claude/settings.json`. Si Claude Code a desactive les mises a jour automatiques (`autoUpdates: false`), CC-Viewer ignorera egalement la mise a jour automatique.

### Support multilingue

CC-Viewer prend en charge 18 langues, avec basculement automatique selon la langue du systeme :

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
