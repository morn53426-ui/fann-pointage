> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctif du test de confidentialité sous Windows — 14 octobre 2026

> Rapport historique de la révision 0.2.0-preproduction.16 (octobre 2026). Les chiffres et versions décrivent cette exécution passée ; consulter README.md et AUDIT_FINAL_FANN_POINTAGE.md pour l’état de l’archive corrigée.

## Symptôme observé

Sous Windows, `npm test` échouait dans `src/pointage/vie-privee.test.ts` avec un chemin du type `C:\\C:\\Users\\...\\src`. Le code utilisait `new URL(...).pathname`, qui ne convertit pas le chemin d'une URL `file:` en chemin natif Windows.

## Correction

Le test utilise désormais `fileURLToPath(new URL("../../", import.meta.url))`, qui convertit correctement une URL `file:` en chemin natif Windows ou POSIX. Aucun comportement de l'application ni mécanisme de localisation n'a été modifié.

## Vérifications réalisées sur cette révision

- `node --experimental-strip-types --test src/pointage/vie-privee.test.ts` : 1/1 réussi.
- `npm test` : 277/277 réussis.
- `npm run test:security` : 87/87 réussis.
- `npm run test:e2e:process` : 17 contrôles réussis, mais ce scénario est explicitement basé sur le stockage JSON de démonstration et ne valide pas PostgreSQL.

## Vérifications PostgreSQL rapportées par le poste de recette

- PostgreSQL 17 indiqué `healthy`.
- Les migrations 0013, 0014 et 0015 ont été appliquées ; le script a vérifié 54 fiches agents et 20 services.
- `npm run db:configure-app-role` a confirmé que `fann_app` est `NOSUPERUSER`, `NOCREATEDB` et `NOCREATEROLE` avec des droits de table limités.
- `/readyz` renvoie HTTP 200 avec `{"status":"ready","mode":"catalogue-postgres"}`.

Ces observations prouvent que la base et le schéma requis répondent au contrôle de disponibilité, pas que chaque parcours métier a été testé de bout en bout avec la base de recette.

## Validation restante

Depuis le poste Windows avec Docker Desktop opérationnel, exécuter `npm run test:postgres`. Cette commande crée un projet Compose de test isolé, exécute les contraintes SQL et teste la concurrence d'utilisation d'un QR puis la conservation d'une écriture après redémarrage PostgreSQL. Elle nettoie uniquement les ressources de son projet de test dédié.

Tester aussi, dans l'interface opérationnelle PostgreSQL, les scénarios de création/renouvellement/révocation du badge, refus de ces actions aux rôles non administrateurs, pointage arrivée/départ, modification de planning avec motif, décision d'absence, classement et rapport. Ne pas utiliser le jeu de démonstration pour conclure à la persistance PostgreSQL.
