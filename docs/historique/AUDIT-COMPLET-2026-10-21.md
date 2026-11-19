> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Audit complet — FANN POINTAGE PROFESSIONNEL v18.6 (2026-10-21)

## Méthode
- Typage strict (`tsc --noEmit`, y compris `--noUnusedLocals --noUnusedParameters`) : 0 erreur.
- Suite de tests : 370 réussis, 0 échec.
- Graphe d'imports depuis les points d'entrée (démo, PostgreSQL catalogue/auth, création d'administrateur, CLI urgences) pour trouver les fichiers jamais atteints.
- Recherche des exports sans aucun appelant ; recherche d'interpolations dans le SQL ; `npm audit --omit=dev` : 0 vulnérabilité.
- Relecture ciblée : pointage, rattachement aux postes, tableau de bord et rapports PostgreSQL, routes d'émargement, migrations.

## Bugs et régressions corrigés
| # | Gravité | Constat | Correctif |
|---|---|---|---|
| 1 | Haute | `GET /api/emargement` : route autorisée en mode PostgreSQL mais jamais implémentée ; retombait sur le magasin de démonstration vide (aperçu vide, export Excel en 404). | Implémentée dans `OperationsPostgres.emargement` (v18.4). |
| 2 | Haute | Contrainte SQL `planning_coherence_regime` : service général exactement 8 h, donc les plannings « fin avant 16 h » étaient refusés par PostgreSQL. | Migration `0019_general_heure_fin.sql` (2 h à 8 h) appliquée par `npm run migrate:catalogue` ; modification d'un poste alignée (v18.4). |
| 3 | Haute | Règles du 21/10 (retard toléré 20 min, arrivée acceptée 1 h avant) appliquées seulement dans les moteurs purs ; PostgreSQL gardait 5 min de tolérance et 15 min d'avance au poste partagé. | Constante unique `TOLERANCE_RETARD_MIN` reprise dans le SQL et le code du tableau de bord ; fenêtre du poste partagé portée à 60 min (v18.5). |
| 4 | Moyenne | Tableau de bord PostgreSQL : filtres `regime` et `service` envoyés par l'écran mais ignorés (indicateurs globaux quel que soit le filtre). | Filtres appliqués côté serveur, cumulés avec le périmètre du responsable ; régime inconnu refusé (400). Test ajouté. |
| 5 | Moyenne | Tableau de bord PostgreSQL : « absents à confirmer » dès 5 min après le début, avant même la fin de la tolérance de retard. | Seuil aligné sur la tolérance de 20 min. |
| 6 | Basse | Export CSV du planning urgences : copie de l'assistant CSV qui préfixait aussi les nombres négatifs d'une apostrophe. | Utilise désormais `rapports/csv.ts` (une seule implémentation). |

## Code mort supprimé
- `src/suivi/` en entier (anomalies, périodes, rapports, résumé, tableau de bord, types, jeu de données, 15 tests) : ancienne implémentation parallèle du tableau de bord et des rapports, jamais branchée (la production utilise `dashboard/`, `rapports/` et `anomalies/`). Son seul élément réellement utilisé, `csv.ts`, doublait `rapports/csv.ts`.
- `src/regimes/index.ts` (fichier barrel sans aucun import), `creerPoolPostgres`, `prochainJourTravaille`, constantes `CYCLE_JOUR_H` et `ECART_PASSAGE_H`, helper `cleDakar` du régime Mobil.
- 8 paramètres inutilisés dans `OperationsPostgres`, et trois restes inutilisés dans les tests.

## Conservé volontairement (à décider)
Fonctions testées mais non appelées par le serveur : `modifierGarde`, `modifierPosteUrgences`, `prochaineGardeDebut`, `postesPeriode`, `prochaineRepriseMobil`, `lireSession`, `checkZone`, `addHours`. Elles servent de spécification testée des règles, mais le serveur ré-implémente les contrôles de modification dans `operations-postgres.ts` : risque de divergence à terme. Recommandation : faire appeler ces fonctions par la route de modification ou les retirer avec leurs tests.

## Non vérifié
- Aucune exécution contre une vraie base PostgreSQL (tests avec pool simulé uniquement) : lancer `npm run test:postgres` et la recette sur la base cible.
- Aucun test navigateur (Playwright) ni sur téléphone : le nouvel écran de pointage personnel et le champ « Heure de fin du service général » restent à essayer à la main.
- Tolérance de départ anticipé : à définir par l'administration (0 min dans les moteurs, 5 min dans le SQL des rapports).
- Pas d'audit d'infrastructure (HTTPS, sauvegardes, rôles de base de données) au-delà de ce que documentent `docs/PREPARATION_PRODUCTION.md` et `docs/HTTPS_ET_SAUVEGARDES.md`.
