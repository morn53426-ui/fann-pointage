> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Audit et correctifs — FANN POINTAGE

> Rapport historique de la révision 0.2.0-preproduction.16 (octobre 2026). Les chiffres et versions décrivent cette exécution passée ; consulter README.md et AUDIT_FINAL_FANN_POINTAGE.md pour l’état de l’archive corrigée.

**Date :** 14 octobre 2026  
**Révision :** `0.2.0-preproduction.16`  
**Statut :** code connecté au dépôt PostgreSQL et tests automatisés réussis ; intégration sur une vraie base PostgreSQL toujours requise. **Cette révision ne doit pas être déclarée prête pour le pointage officiel avant la recette et la validation métier.**

## Résumé exécutif

Cette révision poursuit le raccordement des opérations métier au dépôt `OperationsPostgres`, appelé avant tout routeur de démonstration. Le pointage par QR/badge, les plannings, les jours fériés, les badges, les zones/QR, l'historique, les anomalies, le tableau de bord et les classements sont gérés via PostgreSQL. Les absences/justifications et les rapports journaliers, hebdomadaires et mensuels avec export CSV sont désormais également dispatchés vers cette couche, plutôt que de répondre à `503` ou de lire les données fictives.

L'environnement de cet audit ne disposait ni de Docker ni de serveur PostgreSQL. La suite de tests vérifie des règles métier et des requêtes simulées, mais **ne prouve pas que toutes les requêtes et migrations SQL passent sur votre volume PostgreSQL**. La livraison est une version de recette, pas une certification de mise en production.

## Modifications réalisées

### 1. Opérations métier et permissions

- Routes de pointage individuel et au poste partagé ; vérification et idempotence gérées côté serveur.
- Planning et jours fériés persistés ; badges versionnés, émission explicite, renouvellement transactionnel et révocation séparée de l'état actif de l'agent.
- Zones de pointage, QR dynamique, historique, anomalies, tableau de bord et classement mensuel.
- Toutes les routes connues passent par les opérations persistantes avant le stockage de démonstration. Une route toujours non raccordée reste protégée contre le retour implicite vers des données fictives.
- Création/modification/archivage des agents et services ainsi qu'émission/renouvellement/révocation des badges réservés au rôle administrateur. Les responsables restent dans leurs services pour les fonctions opérationnelles autorisées. Les brancardiers ne peuvent voir que leurs données personnelles dans les rapports.

### 2. Absences et justifications PostgreSQL

- `GET /api/absences`, `POST /api/absences`, `PATCH /api/absences/:id` branchés sur `OperationsPostgres`.
- L'entrée est associée au service de l'affectation de l'agent à la date de début. Les entrées commencent en `a_confirmer`, sans impact sur le score. Une décision `justifiee`, `injustifiee` ou `refusee` exige un motif, enregistre l'auteur et l'heure de décision, et écrit une trace d'audit dans la transaction.
- Les responsables ne peuvent consulter/créer/décider que dans leur périmètre de service ; les brancardiers n'ont pas accès au registre global.
- La migration additive `0015_absences_rapports_postgres.sql` ajoute service historique, auteur, note et métadonnées de décision et des index de consultation. Les mises à jour ne peuvent pas modifier l'agent, la période, la catégorie, le service ou l'auteur d'origine.

### 3. Rapports et exports

- `GET /api/rapports` produit les périodes jour, semaine et mois à partir des plannings et pointages PostgreSQL.
- Filtres pris en charge : service, agent, régime, validation du pointage et statut de localisation.
- Les rapports détaillés et leur export CSV respectent le périmètre du rôle. Les coordonnées géographiques exactes ne sont présentes que pour l'administrateur ; les brancardiers ne disposent pas de synthèse des autres agents.
- Les valeurs de filtre passent par des requêtes paramétrées et les CSV réutilisent le sérialiseur destiné à neutraliser les formules dans les cellules.

### 4. Sécurité PostgreSQL

- `fann_app` reçoit des privilèges de table limités nécessaires aux opérations ; aucun privilège superutilisateur ou DDL ne lui est accordé par les scripts runtime.
- `/healthz` vérifie la vie du processus ; `/readyz` vérifie la connexion, les colonnes utilisées et les marqueurs de migrations `0013`, `0014` et `0015`.
- Le marqueur de migration seul ne suffit pas à garantir le schéma : `scripts/migrate-catalogue.mjs` valide aussi les colonnes utilisées et le registre attendu.

### 5. Interface et tableau de bord

- Tableau de bord avec état de connexion PostgreSQL, indicateurs de présence, tendance des derniers jours et compteurs par régime.
- Interface adaptée au bureau et au mobile. Les boutons et formulaires masquent les opérations non autorisées, mais la véritable décision d'accès est toujours prise côté serveur.
- La photo d'agent peut être ajoutée/remplacée dans le registre ; la révocation d'un badge ne désactive pas l'agent ni ne supprime ses pointages historiques.

## Contrôles effectués dans cet environnement

| Contrôle | Résultat | Portée réelle |
|---|---:|---|
| Suite `node --experimental-strip-types --test --test-concurrency=4 'src/**/*.test.ts'` | **277/277** | Tests unitaires ; plusieurs tests DB utilisent un client simulé |
| Tests ciblés sécurité/auth/migrations | **87/87** | Contrôles de rôles, routes et vérifications statiques |
| `npm run test:e2e:process` | **17 contrôles** | HTTP du mode démo avec stockage JSON, pas PostgreSQL |
| `node --check web/app.js` | Réussi | Syntaxe JavaScript |
| `tsc --noEmit` | Réussi avec déclarations locales temporaires | Environnement Node 22.16, inférieur au minimum projet 22.18 ; types de `pg` temporaires |
| Migration SQL sur un vrai PostgreSQL | **Non exécutée ici** | Docker/serveur PostgreSQL indisponible dans l'environnement d'audit |

L'installation npm complète n'a pas été validée ici. Le test de types avec adaptateur temporaire ne remplace pas `npm install` puis `npm run typecheck` sur Node.js 22.18+ avec les dépendances du lockfile.

## Procédure de recette sur Windows / Git Bash

Sauvegardez le `.env` et la base avant l'essai. Ne partagez pas `.env` et ne supprimez pas le volume PostgreSQL utile.

```bash
node -v
npm install
npm run setup:upgrade-runtime-role

docker compose config --quiet
docker compose up --build -d db
docker compose ps
npm run migrate:catalogue
npm run db:configure-app-role
docker compose up --build -d app
docker compose ps -a
docker compose logs --tail=100 app
curl -i http://127.0.0.1:8787/healthz
curl -i http://127.0.0.1:8787/readyz
npm test
npm run test:security
npm run test:e2e:process
```

Node doit être au minimum en version **22.18**. Si `.env` n'existe pas, utilisez `npm run setup:env` au lieu de `setup:upgrade-runtime-role`. Sur un volume existant, les scripts d'initialisation du conteneur ne sont pas rejoués automatiquement : exécutez explicitement les migrations et la configuration du rôle. N'utilisez jamais `docker compose down -v` sur le volume contenant vos données utiles.

## Scénarios de recette obligatoires

1. Vérifier les journaux : l'application doit indiquer `FANN POINTAGE — PostgreSQL connecté`, et aucun flux de données ne doit utiliser le magasin de démonstration.
2. Avec un administrateur, créer/modifier un agent, émettre et révoquer un badge. Refaire les tentatives comme responsable et brancardier et vérifier le refus côté serveur.
3. Vérifier que la révocation du badge ne désactive pas l'agent et ne supprime pas les anciens pointages.
4. Générer les plannings des régimes, valider les règles de repos, les chevauchements, les jours fériés et les limites de service ; tester les scans QR/badge doublés et concurrents.
5. Créer une absence, vérifier l'état initial et décider avec un motif. Tenter une deuxième décision et un accès hors périmètre.
6. Comparer les rapports jour/semaine/mois et les exports CSV avec un jeu de données PostgreSQL connu. Vérifier l'isolation de service et l'absence de coordonnées précises pour les rôles non administrateurs.
7. Redémarrer les conteneurs et tester la persistance, les sauvegardes et la restauration sur une copie de la base.

## Décision

**GO limité à la recette locale ; NO-GO pour le registre officiel** tant que les migrations et requêtes ne sont pas exécutées sur une vraie base PostgreSQL, que les scénarios de concurrence/reprise ne sont pas validés et que les règles des régimes, classements, absences et accès n'ont pas été approuvées par le CHNU Fann.
