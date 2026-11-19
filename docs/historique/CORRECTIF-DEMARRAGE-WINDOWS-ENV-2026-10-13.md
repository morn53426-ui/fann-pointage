> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctif de démarrage Windows — FANN POINTAGE 0.2.0-preproduction.8

## Symptômes corrigés

1. `npm run admin:postgres -- admin` échouait avec `DATABASE_URL est obligatoire` : Node.js ne charge pas automatiquement un fichier `.env` avec les commandes précédentes.
2. `npm run auth:postgres` échouait pour la même raison, puis pour l'absence des secrets de session.
3. Docker Compose refusait de configurer `DEMO_MOT_DE_PASSE` et `POSTGRES_PASSWORD` : aucun `.env` complet n'était initialisé et `.env.example` n'était pas présent dans l'archive précédente.
4. Le test HTTP de démonstration pouvait choisir un agent de nuit dont la série de postes ne couvrait plus le jour courant.

## Correctifs

- `npm run setup:env` crée `.env` et génère des secrets aléatoires distincts. Il refuse d'écraser un fichier existant.
- `.env.example` est inclus dans l'archive, à titre de modèle uniquement.
- `admin:postgres` et `auth:postgres` utilisent `node --env-file=.env` pour charger les variables.
- `LANCER_FANN_POINTAGE.bat` s'appuie sur le générateur local d'environnement.
- Les scripts de démonstration génèrent 14 postes d'urgences pour mieux couvrir les heures/jours de test.

## Démarrage rapide de la démo

```bash
npm install
npm run setup:env
docker compose config
docker compose up --build -d
docker compose ps
```

## Préparer la sonde PostgreSQL

```bash
docker compose --profile database up --build -d db
docker compose --profile database ps
docker compose --profile database logs --tail=100 db
```

Attendre l'état `healthy`, puis vérifier le schéma :

```bash
docker compose --profile database exec db psql -U fann_admin -d fann_pointage -c "SELECT to_regclass('public.identifiants_application');"
```

La sortie doit comporter `identifiants_application`. Lors de la toute première initialisation, le conteneur PostgreSQL exécute les migrations copiées dans l'image. Si le volume existait déjà, les migrations ajoutées ensuite ne seront pas exécutées automatiquement.

Créer le compte administrateur une fois :

```bash
npm run admin:postgres -- admin
```

Le mot de passe se trouve dans `.env`, sur la ligne `ADMIN_INITIAL_MOT_DE_PASSE`. Ne partagez pas ce fichier.

Arrêter le serveur de démo avant de lancer la sonde sur le même port :

```bash
docker compose stop app
export FANN_MODE=postgres-auth
npm run auth:postgres
```

La sonde vérifie l'authentification PostgreSQL et l'identité persistante. Les routes métier non migrées doivent retourner `503`. Ce n'est pas un serveur de pointage opérationnel.

## Vérifications exécutées lors de la correction

- `npm test` : 240 réussis, 0 échec.
- `npm run test:security` : 81 réussis, 0 échec.
- `npm run test:e2e:process` : 17 contrôles HTTP réussis, dont arrivée/départ, déduplication, accès refusés, redémarrage du processus et récupération des écritures JSON.
- Test temporaire du générateur `.env` et du chargement Node `--env-file` réussi.

## Limites

Docker/PostgreSQL réel n'a pas été démarré ici. Les migrations dans la base locale, la création du compte réel et la sonde doivent encore être exécutées sur la machine de l'utilisateur. Le test E2E de reprise cité plus haut porte sur le stockage JSON de démo, pas sur PostgreSQL. Les fonctions métier dans la sonde restent désactivées par sécurité.


## Correctif complémentaire après démarrage Docker réel

Le journal de démarrage Windows montrait que le conteneur `app` entrait en boucle de redémarrage alors que la base commençait à s'initialiser et que la commande de création de l'administrateur PostgreSQL réussissait. L'image applicative ne copiait pas `package.json`, ce qui supprimait le champ `"type": "module"` du scope de module dans l'image.

Le Dockerfile copie désormais `package.json` dans `/app` et le test de déploiement vérifie cette exigence. Après extraction de cette version, reconstruire l'image applicative avec `docker compose up --build -d --force-recreate app`, puis examiner `docker compose logs --tail=100 app` et attendre son état healthy.

Sécurité : la sortie `docker compose config` collée dans le chat révélait la valeur de `DEMO_MOT_DE_PASSE`. Traiter cette valeur comme divulguée et la remplacer manuellement dans `.env` avant de recréer le conteneur.
