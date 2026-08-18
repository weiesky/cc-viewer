# REPL

Exécute du JavaScript dans un contexte vm Node.js persistant au sein de la session. Le `await` de premier niveau est pris en charge, et les variables/fonctions définies lors d'un appel restent disponibles lors des appels suivants.

## Quand l'utiliser

- Calcul rapide, transformation de données ou manipulation de JSON plus faciles en code qu'en lignes de commande shell.
- Scripting multi-étapes où l'état intermédiaire doit persister entre les appels (compteurs, résultats accumulés).
- Sonder le comportement d'une API ou d'une bibliothèque de façon interactive avant de l'écrire dans un fichier.

## Activation

- Désactivé par défaut — définissez `CLAUDE_CODE_REPL=true` pour l'activer.
- Dans les sessions terminal (`cli`) et claude.ai (`remote`), un drapeau de fonctionnalité côté serveur peut également l'activer.
- Lorsqu'il est désactivé, REPL est masqué de la liste d'outils du modèle. Lorsqu'il est activé, `Read`, `Glob`, `Grep`, `Bash`, `PowerShell` et `NotebookEdit` sont remplacés par les raccourcis REPL.

## Paramètres

- `code` (string, requis) : code JavaScript à exécuter. Prend en charge le await de premier niveau. L'état persiste d'un appel à l'autre.
- `description` (string, optionnel) : description claire et concise de ce que fait ce script à la voix active (5 à 10 mots), p. ex. "Trace upgrade message to its GrowthBook flag".
- `timeout` (number, optionnel) : délai d'expiration en millisecondes. Défaut 30000 ; maximum 600000.

## Exemples

### Exemple 1 : calculer et réutiliser un état

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

Renvoie `2` ; `counts` reste défini pour les appels REPL suivants dans la même session.

### Exemple 2 : await de premier niveau avec un délai plus long

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## Notes

- L'état est propre à la session : redémarrer la session efface toutes les définitions.
- C'est un environnement JavaScript (Node) — utilisez Bash pour les commandes shell, les travaux lourds sur le système de fichiers ou les runtimes non JS.
- Le code de longue durée doit définir un `timeout` explicite ; le défaut de 30 s tue tout ce qui est plus lent.
