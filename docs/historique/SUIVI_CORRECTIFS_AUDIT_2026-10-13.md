> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

> **Note de version — 14 octobre 2026 :** ce rapport décrit l’état observé le 13 octobre 2026. Une révision ultérieure raccorde désormais les routes de pointage, planning, badges, QR, historique, anomalies, tableau de bord et classement au dépôt PostgreSQL et applique les contrôles de rôle côté serveur. Voir `docs/AUDIT_CORRECTIFS_OPERATIONS_POSTGRES_2026-10-14.md`. Ces nouvelles routes restent à valider sur une vraie instance PostgreSQL ; cette note ne vaut pas certification de production.

# Suivi des correctifs d'audit — 13 octobre 2026

Cette note décrit la deuxième passe de corrections apportée à partir du rapport d'audit technique. Elle ne vaut pas certification de production.

## Correctifs appliqués dans cette archive

1. **Compte PostgreSQL runtime distinct.** Le conteneur applicatif se connecte avec `fann_app`, pas avec `POSTGRES_USER` (rôle superutilisateur de bootstrap). Le rôle runtime n'est ni superutilisateur, ni propriétaire du schéma, ni autorisé à créer base/rôle. Il ne bénéficie pas de `BYPASSRLS` : des politiques RLS explicites le visent sur les tables nécessaires à l'authentification et au catalogue. Ses droits SQL sont limités aux opérations utilisées par cette tranche (pas de `DELETE`, `TRUNCATE`, `CREATE` ou droits généraux sur toutes les tables). Le compte applicatif reste un compte de confiance du serveur : les contrôles d'accès par utilisateur sont exécutés par l'API.
2. **Volumes existants.** De nouveaux volumes reçoivent le rôle et les politiques par les scripts d'initialisation. Comme PostgreSQL ne rejoue pas les scripts sur un volume existant, `npm run setup:upgrade-runtime-role` permet de sauvegarder et adapter `.env`, puis `npm run db:configure-app-role` configure le rôle par `DATABASE_ADMIN_URL`.
3. **Build indépendant du `node_modules` de l'hôte.** Le Dockerfile installe les dépendances runtime dans l'image ; `npm ci` est préféré si `package-lock.json` est présent. Si le lockfile manque, le build retombe sur `npm install`, ce qui n'est pas encore entièrement déterministe.
4. **Sondes distinctes.** `/healthz` reste une sonde de vie du processus. `/readyz` vérifie la disponibilité de la base et de la migration du catalogue ; la sonde Compose utilise cette route. L'erreur SQL n'est jamais renvoyée au client.
5. **Contrôles régression.** Deux tests vérifient les réponses `readyz`; des tests statiques couvrent le rôle runtime et l'indépendance Docker vis-à-vis du `node_modules` hôte.

## Vérifications effectuées sur cette copie

- `node --experimental-strip-types --test --test-concurrency=4 'src/**/*.test.ts'` : **258/258 tests réussis** avec Node 22.16.0 dans l'environnement de travail.
- `node --check` sur les scripts `.mjs` modifiés : réussis.
- `sh -n` sur les scripts d'initialisation PostgreSQL : réussi.

Node 22.16.0 est inférieur au minimum déclaré par le projet (Node 22.18+). Les tests sont donc une vérification de non-régression partielle, pas la validation finale sur l'environnement cible. L'installation npm n'a pas abouti dans cet environnement et aucun `package-lock.json` ne pouvait être généré ici.

## Points non résolus / bloquants de production

- **Le pointage métier complet reste non raccordé à PostgreSQL.** Dans le mode catalogue, les routes de pointage, plannings, badges, absences, rapports et classements renvoient encore `503 migration_metier_incomplete`. Cette protection a été conservée plutôt que de basculer silencieusement sur les données fictives.
- **Aucun test d'intégration avec un vrai PostgreSQL n'a été exécuté** pendant cette passe, car Docker n'était pas disponible dans l'environnement de travail. Les rôles/politiques doivent être exercés sur une base jetable avant usage.
- `package-lock.json` doit être généré puis inclus dans le projet par `npm install` sous Node.js 22.18+ ; après ajout du lockfile, le Dockerfile utilisera `npm ci`.
- Le `docker compose up --build -d` du poste Windows a échoué auparavant lors du téléchargement de `postgres:17-alpine` et `node:22.18-bookworm-slim` par IPv6 (`network is unreachable`). Aucun correctif de code ne peut réparer cette connectivité réseau externe : il faut résoudre l'accès Docker Desktop/Docker Hub/CloudFront avant d'évaluer le build complet.

## Décision

**GO limité pour tests locaux de gestion agents/services ; NO-GO pour le pointage officiel.** L'intégration complète des dépôts métier, les tests PostgreSQL réels, le lockfile et un build Docker sur le poste cible restent nécessaires.
