# Write

Crée un nouveau fichier ou remplace entièrement le contenu d'un fichier existant sur le système de fichiers local. Comme il remplace tout au chemin cible, il doit être réservé à la création réelle ou aux réécritures complètes intentionnelles.

## Quand l'utiliser

- Créer un tout nouveau fichier source, de test ou de configuration qui n'existe pas encore
- Générer une fixture, un snapshot ou un fichier de données à partir de zéro
- Effectuer une réécriture complète lorsqu'un `Edit` incrémental serait plus complexe que de repartir de zéro
- Émettre un artefact demandé tel qu'un schéma, une migration ou un script de build que l'utilisateur a explicitement demandé de produire

## Paramètres

- `file_path` (string, requis) : chemin absolu du fichier à écrire. Tous les répertoires parents doivent déjà exister.
- `content` (string, requis) : texte complet à écrire dans le fichier. Cela devient le corps entier du fichier.

## Exemples

### Exemple 1 : créer un nouveau module d'aide
Appelez `Write` avec `file_path: "/Users/me/app/src/utils/slugify.ts"` et fournissez l'implémentation comme `content`. Utilisez-le uniquement après avoir vérifié que le fichier n'existe pas déjà.

### Exemple 2 : régénérer un artefact dérivé
Après que le source du schéma a changé, réécrivez `/Users/me/app/generated/schema.json` en un seul appel `Write` en utilisant le JSON fraîchement généré comme `content`.

### Exemple 3 : remplacer un petit fichier de fixture
Pour une fixture de test jetable où chaque ligne change, `Write` peut être plus clair qu'une séquence d'appels `Edit`. Lisez d'abord le fichier, confirmez la portée, puis écrasez.

## Notes

- Avant d'écraser un fichier existant, vous devez appeler `Read` dessus dans la session en cours. `Write` refuse d'écraser du contenu non lu.
- Préférez `Edit` pour tout changement qui ne touche qu'une partie d'un fichier. `Edit` n'envoie que le diff, ce qui est plus rapide, plus sûr et plus facile à relire.
- Ne créez pas de manière proactive de documentation Markdown, de `README.md` ou de fichiers changelog sauf si l'utilisateur les demande explicitement.
- N'ajoutez pas d'emojis, de texte marketing ou de bannières décoratives sauf si l'utilisateur demande ce style.
- Vérifiez d'abord que le répertoire parent existe avec un appel `Bash` `ls` ; `Write` ne crée pas de dossiers intermédiaires.
- Fournissez le contenu exactement tel que vous voulez qu'il soit persisté ; il n'y a pas de templating ni de post-traitement.
