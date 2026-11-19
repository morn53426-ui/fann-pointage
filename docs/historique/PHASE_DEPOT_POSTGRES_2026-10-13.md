> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Livraison — première tranche du dépôt PostgreSQL

Date : 13 octobre 2026  
Version : `0.2.0-preproduction.4`

## Réalisation

Le module `src/pointage/postgres.ts` implémente une première tranche de persistance PostgreSQL pour le moteur métier de pointage : lecture d'un agent et de son affectation active, lecture d'une zone, récupération des plannings actifs, recherche d'un pointage par clé d'idempotence, vérification de QR déjà consommé, comptage des refus hors zone, insertion transactionnelle, journalisation et validation manuelle avec motif.

Les requêtes SQL sont paramétrées. L'insertion commence par `BEGIN`; si le pointage utilise un QR, le dépôt résout son hash et confirme la zone et la fenêtre d'expiration; il insère la ligne et la relit dans la même transaction; puis il fait `COMMIT`. Toute erreur avant le commit entraîne un `ROLLBACK`. La migration `0011_contrat_pointage_application.sql` arbitre les QR concurrents au moyen du trigger SQL qui consomme le QR dans la transaction.

Un client PostgreSQL de type `pg.Pool` est chargé dynamiquement par `creerPoolPostgres`. La dépendance `pg` et les types `@types/pg` sont ajoutés au manifeste. La configuration `DATABASE_URL` et les options du pool sont documentées dans `.env.example`.

## Contrôles exécutés dans l'environnement de préparation

- `npm test` : **222 réussis, 0 échec**.
- `npm run test:security` : **63 réussis, 0 échec**.
- `npm run test:e2e:process` : **17 contrôles HTTP réussis**; le runner termine maintenant proprement après l'arrêt des processus temporaires.
- `npm run test:postgres:unit` : **6 réussis, 0 échec** avec un client SQL simulé.
- `node --check` : scripts PWA et runner E2E vérifiés.

## Limites — aucune mise en production

1. **Le dépôt n'est pas encore branché au routeur HTTP.** L'application continue d'utiliser `MagasinDemo` et le JSON local. Le démarrage refuse toujours tout mode autre que `demo`.
2. Les six tests du dépôt utilisent un faux client SQL : ils valident les appels et l'ordre transactionnel de l'adaptateur, pas l'exécution des requêtes par un serveur PostgreSQL réel.
3. Docker et `psql` ne sont pas installés dans l'environnement de préparation. Le banc réel `npm run test:postgres` n'a pas été lancé ici.
4. `npm run typecheck` n'a pas pu être validé, car les dépendances de développement et les types Node/PostgreSQL ne sont pas installés. L'accès au registre npm a échoué pour cause de résolution DNS (`EAI_AGAIN`). Les tests exécutés n'ont pas remplacé ce contrôle.
5. Les profils, sessions, utilisateurs, gestion des services, génération des plannings, absences, badges, tableaux de bord et classements doivent encore passer à une source de données PostgreSQL cohérente avant d'autoriser l'usage officiel.

## Commandes pour la machine de développement

```bash
npm install
npm test
npm run typecheck
npm run test:security
npm run test:e2e:process
npm run test:postgres:unit
# Docker Desktop doit être démarré pour tester une véritable instance PostgreSQL jetable
npm run test:postgres
```

Cette version est une étape technique intermédiaire, réservée aux essais avec des données fictives. Ne renseignez pas de données réelles de personnel.
