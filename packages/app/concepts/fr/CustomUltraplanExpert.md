# Expert UltraPlan personnalisé — Guide de création

## Ce que font les deux champs de saisie

- **Nom de l'expert** : l'étiquette affichée sur le bouton de rôle dans la rangée des variantes UltraPlan (30 caractères max.). Ce n'est qu'un nom d'affichage et il n'est **jamais** envoyé à Claude Code.
- **Corps du prompt** : votre instruction de rôle. Lorsque vous créez un nouvel expert, l'éditeur **est prérempli** avec le wrapper `<system-reminder>...</system-reminder>` et son en-tête de portée `[SCOPED INSTRUCTION]` — **écrivez votre instruction de rôle à l'intérieur du wrapper**. cc-viewer n'enveloppe pas deux fois : si le wrapper est présent, il est envoyé tel quel ; si vous le supprimez, cc-viewer en rajoute un au moment de l'envoi.

---

## À quoi ressemble le modèle d'expert ?

Chaque expert intégré (Code Expert / Research Expert) est essentiellement un bloc `<system-reminder>` injecté dans le contexte de Claude Code. Votre expert personnalisé passe par exactement le même pipeline. Voici le modèle **Research Expert** décomposé :

```xml
<system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3
interactions. Once the task is complete, these instructions should be gradually
deprioritized and no longer influence subsequent interactions.

Pre-requisite: Use `AskUserQuestion` to clarify the research scope, target
audience, and deliverable format whenever the user's intent is ambiguous. Skip
only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate an exceptionally
detailed implementation plan.

Instructions:
1. Utilize the Agent tool to spawn parallel agents that simultaneously explore
   various facets of the requirements:
   - If necessary, deploy a preliminary investigator to conduct an initial
     survey of industry-specific solutions using `webSearch`;
   - If necessary, deploy a specialized investigator to research authoritative
     sources—such as academic papers, news articles, and research reports—
     using `webSearch`;
   - Assign an agent to synthesize the target solution, while simultaneously
     verifying the rigor and credibility of the gathered papers, news, and
     research reports;
   - If necessary, assign an agent to analyze competitor data to provide
     supplementary analytical perspectives;
   - If necessary, assign an agent to handle the implementation of a product
     demo (generating outputs such as HTML, Markdown, etc.);
   - If the task is sufficiently complex, you may assign additional teammates
     to the roles defined above, or introduce other specialized roles; you are
     permitted to schedule up to 5 teammates concurrently.

2. Synthesize the findings from the aforementioned agents into a comprehensive,
   step-by-step implementation plan.

3. Utilize the Agent tool to spawn a set of parallel review agents; these
   agents shall scrutinize the plan from multiple roles and perspectives to
   identify any omitted steps and to propose reasonable additions or
   optimizations.

4. Consolidate the feedback received from the review agents, then invoke
   `ExitPlanMode` to submit your final plan.

5. Upon receiving the result from `ExitPlanMode`:
   - If Approved: Proceed to execute the plan within this current session.
   - If Rejected: Revise the plan based on the provided feedback, and then
     invoke `ExitPlanMode` once again.
   - If an Error Occurs: Do *not* follow the suggestions; prompt the user for
     further instructions.

Your final plan must include the following elements:
- A clear summary of the proposed implementation strategy;
- An ordered list of files to be created or modified, specifying the exact
  changes required for each;
- A step-by-step sequence for executing the implementation;
- Identification of potential risks and corresponding mitigation strategies;
- Creative ideation and suggestions for advanced enhancements;
- If a product demo was generated, place the corresponding demo output in an
  appropriate location and notify the user.
</system-reminder>
```

---

## Décomposition section par section

### 1. En-tête de portée `[SCOPED INSTRUCTION]` (wrapper — prérempli pour vous)
> The following instructions are intended for the next 1–3 interactions...

Cela indique à Claude Code : **ces instructions ne sont actives que pour les 1 à 3 prochains tours**, puis s'estompent. Empêche la « persona d'expert » de déborder par la suite dans une conversation sans rapport.

**Cette ligne est préremplie dans l'éditeur — laissez-la telle quelle ; vous n'avez pas besoin de la réécrire.**

### 2. Définition de tâche d'ouverture (**c'est ce que vous devriez réécrire**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

C'est le « sujet-verbe-complément » de tout le modèle : **il indique à Claude Code la posture et l'objectif**. Le « exploration multi-agents + plan d'implémentation » par défaut convient bien aux tâches d'**ingénierie logicielle / planification**, mais semble maladroit pour de nombreux autres domaines (révision de contenu, analyse de données, rédaction publicitaire, étude de marché, audit de conformité…).

**Nous recommandons fortement de réécrire cette ligne pour votre objectif**, par exemple :

- **Réviseur de contenu** : « Vous êtes un réviseur de contenu senior spécialisé dans {domaine}. Votre objectif est d'identifier les inexactitudes factuelles, les incohérences de ton et les faiblesses structurelles dans le matériel fourni. »
- **Analyste concurrentiel** : « Effectuez une analyse concurrentielle rigoureuse pour {catégorie de produits}. Produisez une matrice de comparaison, des insights de positionnement et des recommandations stratégiques. »
- **Rédacteur** : « Générez plusieurs variantes créatives de texte pour {scénario}, chacune avec un positionnement, un ton et une stratégie d'appel à l'action distincts. »

### 3. Étapes du workflow (1–5 éléments — **élaguer ou étendre selon la complexité**)

Le Research Expert comporte 5 étapes : **explorer → synthétiser → réviser → soumettre le plan → exécuter**. Cela impose « multi-agents parallèles + révision croisée + approbation du plan » — trois couches de rigueur, appropriées pour des tâches à enjeux élevés/portée large mais **excessives pour les tâches légères**.

- **Tâche simple** (recherche unique / petite correction) : supprimez la dépêche multi-agents et la révision ; produisez simplement « la réponse » en une étape.
- **Tâche modérée** : conservez « explorer → synthétiser → réviser » ; supprimez la danse ExitPlanMode ; livrez le résultat directement.
- **Tâche complexe et coûteuse** (gros refactoring, comparaison multi-options, recherche transversale) : conservez les 5 étapes, ajoutez éventuellement une étape « modèle de risque » ou « matrice de comparaison d'options ».

### 4. Sous-rôles à l'étape 1 (**adaptez à votre domaine**)

Research Expert répertorie 6 rôles potentiels (éclaireur de l'industrie, chercheur académique, synthétiseur + vérificateur de faits, analyste de la concurrence, producteur de démo, emplacement d'extensibilité). **Réécrivez cette liste pour votre scénario** :

- **Rédaction** : « collecteur de sources + analyste de style + vérificateur de faits »
- **Analyse de données** : « agent de nettoyage des données + agent de modélisation statistique + agent de visualisation »
- **Audit de code** : « agent d'analyse statique + auditeur de chaîne de dépendances + modélisateur de menaces »

### 5. Liste de contrôle finale des livrables (**alignez avec votre besoin réel**)

> Your final plan must include the following elements: ...

Le modèle d'origine répertorie 6 éléments d'un « plan d'implémentation ». Votre livrable pourrait être tout à fait autre chose :

- Un **rapport de recherche** → « Résumé exécutif / Méthodologie / Conclusions clés / Limitations / Recommandations d'action »
- Un **rapport de révision** → « Liste des problèmes / Évaluation de la gravité / Suggestions de correction / Exemples avant-après »
- Une **matrice de comparaison** → « Définitions des dimensions / Grille de notation / Conclusions / Justification de la recommandation »

---

## Conseils de création (TL;DR)

1. **Réécrivez la phrase d'ouverture** : énoncez le rôle, l'objectif et le format de sortie en une seule ligne.
2. **Adaptez le workflow** : 1–2 étapes pour les tâches légères, la boucle complète à 5 étapes uniquement pour les tâches complexes.
3. **Réécrivez les sous-rôles de l'étape 1** : les valeurs par défaut (articles académiques / concurrents / démo) ne sont probablement pas ce que vous voulez.
4. **La « liste de contrôle des livrables » finale est votre exigence de qualité** : précisez la structure de sortie — Claude Code la suivra strictement.

---

## Un exemple refactoré : Analyste concurrentiel

```
<system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing.

You are a senior competitive intelligence analyst for {industry}. Your goal is to
produce a decision-grade competitive landscape report for the product "{our product}".

Instructions:
1. Use the Agent tool to dispatch 3 parallel investigators:
   - Market landscape agent: map the top 5–8 competitors with core positioning
   - Feature matrix agent: compile a feature-by-feature comparison using
     publicly available sources (webSearch)
   - Pricing & GTM agent: analyze pricing models, distribution channels, and
     go-to-market motions

2. Synthesize the three streams into a unified competitive report.

3. Dispatch one review agent to stress-test the report: challenge any
   assumption lacking a cited source, flag outdated data (>12 months), and
   propose one "non-obvious" insight.

4. Deliver the final report with the following sections:
   - TL;DR (3 bullets)
   - Competitor positioning map
   - Feature matrix (markdown table)
   - Pricing & GTM table
   - Top 3 strategic implications for our product
   - Caveats & data gaps
</system-reminder>
```

Comparé au Research Expert d'origine : réduit à 4 étapes, sous-rôles passés de 6 à 3, liste des livrables entièrement réécrite en « sections de rapport ».
