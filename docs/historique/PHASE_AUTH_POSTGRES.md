> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

> **Note de version — 14 octobre 2026 :** ce rapport décrit l’état observé le 13 octobre 2026. Une révision ultérieure raccorde désormais les routes de pointage, planning, badges, QR, historique, anomalies, tableau de bord et classement au dépôt PostgreSQL et applique les contrôles de rôle côté serveur. Voir `docs/AUDIT_CORRECTIFS_OPERATIONS_POSTGRES_2026-10-14.md`. Ces nouvelles routes restent à valider sur une vraie instance PostgreSQL ; cette note ne vaut pas certification de production.

# Phase d'intégration de l'authentification PostgreSQL

**Statut : sonde de préproduction limitée, pas serveur de pointage de production.**

## Ce que cette phase permet de tester

- Le `POST /api/connexion` cherche les comptes dans `identifiants_application` et ne retombe jamais sur les comptes fictifs.
- Le jeton signé est lié à `session_version`. Le serveur relit le profil en base à chaque requête authentifiée; désactivation ou incrément de version révoque donc les sessions existantes.
- `GET /api/moi` lit l'identité et les services visibles depuis PostgreSQL.
- Les autres routes API renvoient volontairement `503 migration_metier_incomplete`. Les données agents, plannings et pointages n'ont pas encore toutes été raccordées au dépôt transactionnel.
- La création du premier compte administrateur s'effectue via une commande explicite. Le mot de passe en clair ne s'affiche pas dans les logs.

## Pré-requis

- Node.js **22.23.4 ou supérieur**.
- PostgreSQL accessible; les migrations `0001` à `0012` doivent avoir été appliquées dans l'ordre.
- Dépendances installées depuis `package.json` (`npm install`).
- Un compte technique PostgreSQL réservé à l'application, avec uniquement les droits requis.
- Si la base est distante, activer TLS et configurer une chaîne de certificats vérifiable. `PGSSL=require` active TLS avec validation du certificat.

## Préparer les variables dans Git Bash

Ne collez jamais ces secrets dans un chat, un ticket ou un dépôt Git.

```bash
export DATABASE_URL='postgresql://UTILISATEUR:SECRET@HOTE:5432/fann_pointage'
export SESSION_SECRET=REMPLACER_PAR_UN_SECRET_ALEATOIRE_LOCAL
export ADMIN_INITIAL_MOT_DE_PASSE=REMPLACER_PAR_UN_SECRET_ALEATOIRE_LOCAL
```

`SESSION_SECRET` doit être sauvegardé dans le gestionnaire de secrets de l'environnement et rester stable entre redémarrages. Si ce secret change, toutes les sessions signées deviennent invalides.

## Créer le compte initial

```bash
npm run admin:postgres -- admin
unset ADMIN_INITIAL_MOT_DE_PASSE
```

Cette commande ne fonctionne qu'après application des migrations. Choisissez un mot de passe long et unique; ne le mettez pas dans un script versionné.

## Lancer la sonde d'authentification

```bash
export FANN_MODE=postgres-auth
npm run auth:postgres
```

Le serveur se lance sur `HOST`/`PORT` configurés. Connectez-vous à `/api/connexion`, puis appelez `/api/moi` avec le jeton Bearer reçu. Les appels authentifiés à `/api/agents`, `/api/plannings`, `/api/pointage` et aux autres routes métier doivent retourner `503` tant que ces données n'ont pas été migrées. C'est une barrière de sécurité intentionnelle, pas un dysfonctionnement à contourner.

## Tests locaux

```bash
npm test
npm run test:security
npm run test:e2e:process
npm run test:auth:postgres
```

Les tests de `auth-postgres.test.ts` et `routes-auth-postgres.test.ts` utilisent un client PostgreSQL simulé. Pour une validation intégrée, utiliser un environnement de test jetable et exécuter aussi le banc Docker (`npm run test:postgres`) lorsque Docker est disponible.

## Avant toute exploitation

1. Raccorder les dépôts PostgreSQL agents, services, affectations, zones, plannings, pointages, absences et audit aux routes correspondantes.
2. Supprimer les données de démonstration du chemin de production; ajouter un démarrage de production distinct qui refuse tout fallback vers le JSON local.
3. Tester une vraie base avec migrations, concurrence, révocation de comptes, indisponibilité et restauration depuis sauvegarde.
4. Activer HTTPS, rotation/stockage des secrets, sauvegardes chiffrées et surveillance.
5. Garder le mode production désactivé tant que les étapes ci-dessus n'ont pas été vérifiées.
