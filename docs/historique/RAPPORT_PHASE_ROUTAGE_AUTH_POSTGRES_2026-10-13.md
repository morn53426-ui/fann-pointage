> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

> **Note de version — 14 octobre 2026 :** ce rapport décrit l’état observé le 13 octobre 2026. Une révision ultérieure raccorde désormais les routes de pointage, planning, badges, QR, historique, anomalies, tableau de bord et classement au dépôt PostgreSQL et applique les contrôles de rôle côté serveur. Voir `docs/AUDIT_CORRECTIFS_OPERATIONS_POSTGRES_2026-10-14.md`. Ces nouvelles routes restent à valider sur une vraie instance PostgreSQL ; cette note ne vaut pas certification de production.

# Rapport de livraison — FANN POINTAGE 0.2.0-preproduction.6

Date : 13 octobre 2026

## Livrable

Le projet ajoute un mode explicite de sonde PostgreSQL pour l'authentification et la lecture du profil, plus une commande de provisionnement du premier compte administrateur. L'API normale continue de démarrer en mode démonstration.

## Changements

- `src/api/routes.ts` accepte l'injection d'une interface d'authentification persistante. La connexion et la relecture de session consultent PostgreSQL lorsque le dépôt est injecté.
- Un jeton est accepté seulement si le compte existe encore, est actif et si sa `session_version` correspond.
- `DepotAuthentificationPostgres.servicesVisibles()` récupère les services actifs pour l'administrateur, les services affectés au responsable et l'affectation courante du brancardier.
- `src/api/main-postgres-auth.ts` expose la sonde avec `FANN_MODE=postgres-auth`, `DATABASE_URL` et un `SESSION_SECRET` long. Il valide l'existence des tables avant de démarrer.
- `src/api/creer-admin-postgres.ts` crée le premier admin, avec mot de passe transmis par `ADMIN_INITIAL_MOT_DE_PASSE` et jamais écrit aux logs.
- Barrière importante : dans la sonde, tout endpoint API métier à part `/api/moi` retourne un `503 migration_metier_incomplete`. Cela empêche que les utilisateurs PostgreSQL touchent aux agents ou pointages du magasin de démo.
- Ajout de tests de routage et de documentation dans `docs/PHASE_AUTH_POSTGRES.md`.

## Résultats réellement exécutés

- `npm test` : **240/240 réussis**, après limitation de la concurrence à 4 workers pour stabiliser l'exécution du jeu de tests.
- `npm run test:security` : **81/81 réussis**.
- `npm run test:auth:postgres` : **15/15 réussis** (client PostgreSQL simulé).
- `npm run test:postgres:unit` : **6/6 réussis** (dépôt pointage simulé).
- `npm run test:e2e:process` : **17 contrôles HTTP réussis**, stockage JSON de démonstration. Ce résultat n'est pas un test PostgreSQL.
- Syntaxe des deux nouveaux points d'entrée validée avec `node --experimental-strip-types --check`.

## Limites et risques résiduels

- Le typecheck TypeScript a été tenté mais est **non validé** car `@types/node`, `pg` et les types correspondants ne sont pas installés dans l'environnement courant; les erreurs observées signalent d'abord ces modules/types manquants. Il faut exécuter `npm install`, puis `npm run typecheck`.
- Docker et `psql` sont absents, donc les migrations et transactions n'ont pas été testées sur un véritable moteur PostgreSQL.
- Les routes agents, services, plannings, pointages, absences, rapports et classement ne sont pas migrées. Elles restent désactivées en `postgres-auth`.
- Aucune préparation ne signifie mise en production. Garder les données fictives et le mode de démonstration jusqu'à la migration et aux tests d'intégration de toutes les données métier.


## Correctif de démarrage — version 0.2.0-preproduction.7

L'erreur `DATABASE_URL est obligatoire` venait des scripts qui ne lisaient pas automatiquement le fichier `.env`. L'erreur Compose venait du fait que `.env.example` manquait dans l'archive et/ou que `.env` n'avait pas été initialisé.

Correctifs : `npm run setup:env`, `.env.example` inclus dans le ZIP, scripts PostgreSQL lancés avec `--env-file=.env` et lanceur Windows corrigé. Le nouveau générateur crée des secrets aléatoires et distincts; il refuse d'écraser un `.env` existant.

Commande d'initialisation : `npm run setup:env`. Puis démarrer PostgreSQL avec `docker compose --profile database up --build -d db`. Les requêtes/migrations sur une vraie base n'ont pas été exécutées pendant la génération de cette archive.

Le jeu de démonstration génère désormais 14 postes pour les équipes d’urgences afin que le banc HTTP trouve un poste actif indépendamment du jour/heure d’exécution.
