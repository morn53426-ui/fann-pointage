> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Rapport de mise à jour du service Mobil — FANN POINTAGE 0.2.0-preproduction.21

Date : 20 octobre 2026

## Synthèse

Le régime Mobil a été ajouté dans le projet existant, sans réécrire l'application ni remplacer ses technologies. Les régimes `general`, `garde` et `urgences` restent distincts. Les changements d'interface, les contrôles métier côté serveur, les rapports/tableaux de bord et les migrations PostgreSQL sont inclus dans cette livraison.

## Règles mises en œuvre

- **Mobil jour :** début à 08 h, fin à 16 h, du lundi au vendredi par défaut ; samedis, dimanches et jours fériés sont exclus par défaut.
- **Exceptions jour :** un administrateur ou responsable de service autorisé doit activer explicitement les exceptions week-end et/ou jour férié dans l'écran de planning. L'opération est enregistrée dans le journal d'audit.
- **Mobil nuit :** prise de service à 16 h, fin prévue à 08 h le lendemain. La règle s'applique tous les jours, week-ends et jours fériés inclus.
- **Repos :** 56 heures consécutives après la fin prévue de la garde de nuit. Le calcul se fait en instants réels, donc traverse le changement de date. Le cycle d'un même agent est de 72 heures entre deux prises de service (16 h de garde + 56 h de repos). Exemple : lundi 16 h → mardi 08 h → jeudi 16 h.
- **Conflits :** les chevauchements sont refusés. Le contrôle du repos Mobil inspecte aussi les postes d'autres régimes, y compris lors de la création ou modification d'un planning non Mobil à proximité d'une garde Mobil. Les créations/modifications du même agent sont sérialisées par verrou transactionnel PostgreSQL puis les règles sont revalidées.
- **Écran :** sélecteur jour/nuit, groupe de rotation A/B/C pour répartir les nuits, cases d'exception, types et horaires clairement affichés et date/heure de reprise théorique sur les postes de nuit.
- **Persistance :** les migrations ajoutent le régime `mobil`, autorisent les durées 8 h/16 h et affectent au régime Mobil les affectations ouvertes en `garde` dont le service correspond à Mobile/Mobil/Unité mobile. Les plannings historiques et les affectations closes ne sont pas réécrits.

## Fichiers modifiés pour le lot Mobil

### Moteur de règles, types et tests

- `src/regimes/mobil/index.ts` — création/génération des postes, cycle de 72 h, calcul du repos de 56 h, validation des chevauchements et présence.
- `src/regimes/mobil/mobil.test.ts` — tests unitaires des heures, du passage au jour suivant, des week-ends, des jours fériés et du repos.
- `src/regimes/index.ts`, `src/shared/types.ts` — export et type du régime.
- `src/regimes/independance.test.ts` — vérifie l’indépendance des moteurs de régimes, y compris Mobil.

### API et logique côté serveur

- `src/api/routes.ts`, `src/api/catalogue-postgres.ts`, `src/api/demo.ts`, `src/api/magasin.ts` — prise en charge du régime dans les routes et la persistance locale.
- `src/api/operations-postgres.ts` — génération, modification et validations PostgreSQL, prise en compte des jours fériés, contrôle inter-régimes et verrou contre les demandes concurrentes.
- `src/api/admin-planning.test.ts`, `src/api/operations-postgres.test.ts` — tests d'intégration d'API/mocks SQL, incluant les règles Mobil et le verrou.
- `src/api/main-postgres-catalogue.ts` — contrôle au démarrage et dans `/readyz` du régime et des migrations Mobil.
- `src/db/migrations.test.ts` — tests statiques du SQL et de l'ordre des migrations.

### Interface, rapports et indicateurs

- `web/app.js` — choix de l'équipe, rotation nuit, exceptions jour et date de reprise affichée.
- `src/dashboard/evaluation.ts`, `src/dashboard/indicateurs.ts`, `src/anomalies/detection.ts`, `src/suivi/anomalies.ts`, `src/suivi/tableau-de-bord.ts` — présence, indicateurs, détection des conflits et repos.
- `src/rapports/emargement.ts`, `src/rapports/rapport.ts`, `src/suivi/rapports.ts` — libellés, postes de nuit et périodes de repos dans les rapports.
- `src/classement/types.ts`, `src/classement/classement.ts` — type de régime.

### Schéma, exploitation et documentation

- `supabase/migrations/0017_regime_mobil_enum.sql` — ajoute `mobil` à `regime_code` de façon rejouable.
- `supabase/migrations/0018_planning_mobil_rules.sql` — contraintes de durée et mise à niveau des seules affectations ouvertes visées.
- `scripts/migrate-catalogue.mjs`, `compose.yaml` — application des migrations en mise à niveau des bases existantes.
- `package.json`, `package-lock.json` — version `0.2.0-preproduction.21`.
- `README.md`, `docs/DOCKER.md`, `docs/PREPARATION_PRODUCTION.md` — règles et procédure de mise à jour/validation.

L'archive reprend également les corrections d'impression des badges déjà présentes dans l'archive v18 d'entrée ; elles n'ont pas été supprimées.

## Résultats effectivement exécutés

- `npm test` : **377 tests réussis, 0 échec**.
- `node --experimental-strip-types --test src/db/migrations.test.ts` : **22 réussis, 0 échec**.
- `node --experimental-strip-types --test src/api/operations-postgres.test.ts` : **17 réussis, 0 échec**.
- `npm run typecheck` : commande terminée sans diagnostic, mais le contrôle a utilisé le compilateur TypeScript global et des déclarations temporaires pour compenser les dépendances manquantes ; il ne remplace pas une vérification après une installation officielle.
- `node --check web/app.js` et `node --check scripts/migrate-catalogue.mjs` : réussis.
- `npm run check:delivery` : réussi, aucun chemin privé ni motif de secret détecté.

## Vérifications restant à faire — ne pas les considérer comme réussies

- La machine de travail n'a que Node.js 22.16.0 alors que le projet exige `>=22.18.0`.
- `npm ci` avec les dépendances officielles n'a pas été validé dans cet environnement ; le runner `@playwright/test` n'est pas installé, donc `npm run test:e2e` n'a pas été exécuté.
- Docker n'est pas disponible ici : `npm run test:postgres` et le build des images n'ont pas été exécutés.
- Les migrations 0017/0018 ont passé les tests statiques, mais n'ont pas été appliquées sur une base PostgreSQL réelle dans cet environnement. Il faut d'abord les essayer sur une copie de recette, vérifier l'idempotence et la conservation de l'historique, puis valider le service avec des utilisateurs métier.

## Déploiement recommandé

1. Prévoir une fenêtre de maintenance et réaliser une sauvegarde PostgreSQL vérifiable avant mise à jour. Ne jamais supprimer le volume de données.
2. Déployer les sources sur le serveur qui héberge le projet et garder le `.env` existant hors de l'archive ; ne pas écraser les secrets actuels.
3. Avec Node.js 22.18 ou plus récent, exécuter `npm ci` si les dépendances sont installées sur l'hôte. Avec la procédure Docker du projet, l'image utilise déjà `node:22.18-bookworm-slim`.
4. Appliquer les migrations et droits avec `npm run db:upgrade` depuis l'hôte correctement configuré avec `DATABASE_ADMIN_URL`, ou utiliser le service de migration Compose via `docker compose up --build -d`.
5. Vérifier les journaux du service `migrate`, puis `docker compose ps` et `curl -i http://127.0.0.1:8787/readyz`.
6. En environnement de recette, créer un planning Mobil jour, un planning nuit du lundi 16 h au mardi 08 h, vérifier la reprise du jeudi 16 h, les refus de chevauchement et les cas jours fériés/week-ends. Vérifier aussi pointages, absences et rapports avant toute activation en production.
