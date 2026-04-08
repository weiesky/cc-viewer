# SendMessage

## Définition

Envoie des messages entre agents au sein d'une équipe. Utilisé pour la communication directe, la diffusion et les messages de protocole (requêtes/réponses d'arrêt, approbation de plan).

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `to` | string | Oui | Destinataire : nom du coéquipier, ou `"*"` pour diffuser à tous |
| `message` | string / object | Oui | Message texte ou objet de protocole structuré |
| `summary` | string | Non | Aperçu de 5 à 10 mots affiché dans l'interface |

## Types de messages

### Texte brut
Messages directs entre coéquipiers pour la coordination, les mises à jour d'état et les discussions sur les tâches.

### Requête d'arrêt
Demande à un coéquipier de s'arrêter proprement : `{ type: "shutdown_request", reason: "..." }`

### Réponse d'arrêt
Le coéquipier approuve ou refuse l'arrêt : `{ type: "shutdown_response", approve: true/false }`

### Réponse d'approbation de plan
Approuve ou refuse le plan d'un coéquipier : `{ type: "plan_approval_response", approve: true/false }`

## Diffusion vs. Direct

- **Direct** (`to: "nom-du-coéquipier"`) : Envoyer à un coéquipier spécifique — à privilégier pour la plupart des communications
- **Diffusion** (`to: "*"`) : Envoyer à tous les coéquipiers — à utiliser avec parcimonie, uniquement pour les annonces critiques à l'échelle de l'équipe

## Outils associés

| Outil | Rôle |
|-------|------|
| `TeamCreate` | Créer une nouvelle équipe |
| `TeamDelete` | Supprimer l'équipe une fois terminé |
| `Agent` | Démarrer des coéquipiers qui rejoignent l'équipe |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Gérer la liste de tâches partagée |
