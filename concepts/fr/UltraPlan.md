# UltraPlan — La Machine a Voeux Ultime

## Qu'est-ce que UltraPlan

UltraPlan est l'**implementation localisee** par cc-viewer de la commande native `/ultraplan` de Claude Code. Il vous permet d'utiliser les capacites completes de `/ultraplan` dans votre environnement local **sans avoir besoin de lancer le service distant officiel de Claude**, en guidant Claude Code pour accomplir des taches complexes de planification et d'implementation en utilisant la **collaboration multi-agents**.

Par rapport au mode Plan classique ou a Agent Team, UltraPlan peut :
- Propose les rôles **Expert code** et **Expert recherche** adaptés à différents types de tâches
- Déployer plusieurs agents parallèles pour explorer le code ou mener des recherches sous différentes dimensions
- Integrer la recherche externe (webSearch) pour les meilleures pratiques de l'industrie
- Assembler automatiquement une Code Review Team apres l'execution du plan pour la revue de code
- Former une boucle fermee complete **Plan → Execute → Review → Fix**

---

## Notes Importantes

### 1. UltraPlan N'est Pas Omnipotent
UltraPlan est une machine a voeux plus puissante, mais cela ne signifie pas que chaque voeu peut etre exauce. Il est plus puissant que Plan et Agent Team, mais ne peut pas directement « vous faire gagner de l'argent ». Considerez une granularite de taches raisonnable — decomposez les grands objectifs en taches moyennes executables plutot que d'essayer de tout accomplir en une seule fois.

### 2. Actuellement Plus Efficace pour les Projets de Programmation
Les modeles et flux de travail d'UltraPlan sont profondement optimises pour les projets de programmation. D'autres scenarios (documentation, analyse de donnees, etc.) peuvent etre tentes, mais il est conseille d'attendre les adaptations des versions futures.

### 3. Temps d'Execution et Exigences de Fenetre de Contexte
- Une execution reussie d'UltraPlan prend generalement **30 minutes ou plus**
- Necessite que le MainAgent dispose d'une grande fenetre de contexte (modele Opus avec 1M de contexte recommande)
- Si vous ne disposez que d'un modele 200K, **assurez-vous de faire `/clear` sur le contexte avant l'execution**
- Le `/compact` de Claude Code fonctionne mal lorsque la fenetre de contexte est insuffisante — evitez de manquer d'espace
- Maintenir un espace de contexte suffisant est un prerequis essentiel pour la reussite de l'execution d'UltraPlan

Si vous avez des questions ou des suggestions concernant l'UltraPlan localise, n'hesitez pas a ouvrir des [Issues sur GitHub](https://github.com/anthropics/claude-code/issues) pour discuter et collaborer.

---

## Fonctionnement

UltraPlan propose deux rôles d'experts, adaptés à différents types de tâches :

### Expert code
Un workflow de collaboration multi-agents conçu pour les projets de programmation :
1. Déployer jusqu'à 5 agents parallèles pour explorer simultanément le code (architecture, identification de fichiers, évaluation des risques, etc.)
2. Optionnellement déployer un agent de recherche pour étudier les solutions du secteur via webSearch
3. Synthétiser toutes les découvertes des agents en un plan d'implémentation détaillé
4. Déployer un agent de revue pour examiner le plan sous plusieurs perspectives
5. Exécuter le plan une fois approuvé
6. Assembler automatiquement une Code Review Team pour valider la qualité du code après l'implémentation

### Expert recherche
Un workflow de collaboration multi-agents conçu pour les tâches de recherche et d'analyse :
1. Déployer plusieurs agents parallèles pour rechercher sous différentes dimensions (études sectorielles, articles académiques, actualités, analyse concurrentielle, etc.)
2. Assigner un agent pour synthétiser la solution cible tout en vérifiant la rigueur et la crédibilité des sources collectées
3. Optionnellement déployer un agent pour créer un démo produit (HTML, Markdown, etc.)
4. Synthétiser toutes les découvertes en un plan d'implémentation complet
5. Déployer plusieurs agents de revue pour examiner le plan sous différents rôles et perspectives
6. Exécuter le plan une fois approuvé
