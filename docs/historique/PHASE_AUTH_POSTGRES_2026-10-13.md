> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

> **Note de version — 14 octobre 2026 :** ce rapport décrit l’état observé le 13 octobre 2026. Une révision ultérieure raccorde désormais les routes de pointage, planning, badges, QR, historique, anomalies, tableau de bord et classement au dépôt PostgreSQL et applique les contrôles de rôle côté serveur. Voir `docs/AUDIT_CORRECTIFS_OPERATIONS_POSTGRES_2026-10-14.md`. Ces nouvelles routes restent à valider sur une vraie instance PostgreSQL ; cette note ne vaut pas certification de production.

# Mise à jour — routage de l'authentification PostgreSQL

## Livraison 0.2.0-preproduction.6

Cette étape fait passer le dépôt de comptes PostgreSQL d'un module isolé à une option explicite du routeur HTTP.

### Comportement testé

- `POST /api/connexion` consulte `DepotAuthentificationPostgres.parIdentifiant` lorsqu'il est injecté. Il ne retombe pas sur les comptes de démonstration si l'identifiant PostgreSQL n'existe pas.
- Le serveur lit le compte depuis PostgreSQL à chaque appel protégé. Une désactivation ou un changement de `session_version` invalide un jeton existant.
- `GET /api/moi` lit l'identité et les services autorisés en base.
- Toutes les autres routes métier répondent `503 migration_metier_incomplete` dans ce mode. Le fait de recevoir un jeton PostgreSQL ne donne donc pas accès aux données de démonstration du magasin mémoire.
- `npm run admin:postgres -- admin` crée un premier administrateur après que les migrations ont été appliquées, en prenant le mot de passe dans `ADMIN_INITIAL_MOT_DE_PASSE` sans l'imprimer.

### Vérifications

- `npm test` : 240 tests réussis.
- `npm run test:security` : 81 tests réussis.
- `npm run test:auth:postgres` : 15 tests réussis, avec client PostgreSQL simulé.
- `npm run test:e2e:process` : 17 contrôles HTTP réussis sur le serveur de démonstration et son stockage JSON.
- Contrôle de syntaxe natif Node réussi pour les deux nouveaux points d'entrée TypeScript (`--experimental-strip-types --check`).

### Limites

- Ces tests n'ont pas utilisé de serveur PostgreSQL réel; les tests unitaires du dépôt utilisent un client simulé.
- `npm run typecheck` n'a pas pu être validé : l'environnement de travail ne contient pas les dépendances installées, et les déclarations Node et `pg` sont donc manquantes.
- Docker et `psql` sont absents ici ; migrations réelles, concurrence sur base réelle, panne et restauration PostgreSQL restent à tester.
- Le mode `postgres-auth` est une sonde de préproduction, pas un serveur opérationnel de pointage. Il bloque les routes métier non migrées en `503`. Ne pas l'exposer à l'hôpital ni l'utiliser avec des données réelles.

### Étape suivante

Migrer les services, agents, affectations, zones et plannings vers des dépôts PostgreSQL, puis connecter `/api/agents`, `/api/plannings`, `/api/pointage` et les routes de suivi. Les droits doivent se baser sur les services actifs en base; la transition ne sera terminée qu'après des tests d'intégration HTTP avec un PostgreSQL jetable.


## Correctif démarrage Windows — 13 octobre 2026

- Ajout de `scripts/init-env.mjs` et `npm run setup:env` pour créer `.env` sans écraser une configuration existante. Les valeurs DEMO, PostgreSQL, session et administrateur sont générées indépendamment.
- Ajout du `.env.example` au ZIP (modèle sans secrets réels).
- Les scripts `admin:postgres` et `auth:postgres` passent par `node --env-file=.env`, afin que `DATABASE_URL`, `SESSION_SECRET` et `ADMIN_INITIAL_MOT_DE_PASSE` soient chargés depuis le fichier local.
- Le lanceur Windows appelle le générateur de configuration et n'attend plus un `.env.example` absent.
- Test local : génération de `.env` en dossier temporaire, lecture par `node --env-file`, cohérence entre `DATABASE_URL` et `POSTGRES_PASSWORD`, syntaxe des scripts : réussis. Docker/PostgreSQL réel non testé dans cet environnement.

- Correctif du jeu de démonstration : les cycles urgences sont générés sur 14 occurrences pour que les tests HTTP du poste partagé trouvent un poste actif le jour du test, quelle que soit l’heure de lancement.
