# Plan d'automatisation qualité — FANN POINTAGE

Mise à jour : 19 novembre 2026 · Fuseau : Africa/Dakar  
Dépôt : https://github.com/morn53426-ui/fann-pointage  
Branche principale : `main` (`bafb11c7ac403eebbc00c5465eef4b509af812ca`)  
Branche de consolidation : `integration/preproduction-hardening`, créée depuis `main` pour réunir les corrections des PR #2, #3 et #4.

> Ce tableau décrit les preuves effectivement disponibles à la date indiquée. Une CI verte sur une branche de travail ne signifie ni intégration dans `main`, ni recette terrain, ni autorisation de mise en production.

## Tableau de suivi obligatoire

Les seuls statuts autorisés sont : **À faire**, **En cours**, **Bloqué**, **Corrigé**, **Validé**.

| Phase | Statut | Priorité | Preuve / situation vérifiable |
|---|---|---:|---|
| 0 — Audit initial | En cours | P1 | Références GitHub vérifiées : `main` = `bafb11c7` (PR #1 fusionnée). Les PR #2 et #4 ont été fusionnées dans la branche corrective ; la PR #3 dans sa branche de suivi. La consolidation est maintenant portée par la PR #5, ouverte en Draft. L'audit courant est ciblé ; l'inventaire exhaustif du code, des routes, des règles métier et des dépendances reste à compléter. |
| 1 — Rétablissement de la CI | En cours | P1 | Run #79 sur la tête de la PR #1 : CI standard verte. Run #91 sur la branche de suivi PR #3 : restauration intégrale chiffrée sur PostgreSQL `tmpfs`, migrations 0027 idempotentes et privilèges `fann_app` vérifiés. Run #97 sur la branche PR #4 : matrice responsive élargie et Playwright verts. [Run #79](https://github.com/morn53426-ui/fann-pointage/actions/runs/44620631851) · [Run #91](https://github.com/morn53426-ui/fann-pointage/actions/runs/44621955504) · [Run #97](https://github.com/morn53426-ui/fann-pointage/actions/runs/44623136749). La consolidation vers `main` est testée par le run #122, actuellement en cours. |
| 2 — Responsive mobile / tablette / desktop | En cours | P1 | Les scénarios d'en-tête, des écrans principaux et des badges couvrent 320, 360, 390, 430, 768, 1024 et 1440 px ; run #97 réussi. Les formulaires, tableaux, fenêtres modales et tous les parcours métiers ne sont pas encore couverts à ces dimensions. |
| 3 — Badges et impression | En cours | P1 | Les tests Playwright du run #97 et du run #91 sont verts, incluant le format CR80, QR, aperçu, recto-verso, PDF A4 et les tailles responsive ciblées. Aucune impression sur imprimante physique n'a été réalisée. [Run #97](https://github.com/morn53426-ui/fann-pointage/actions/runs/44623136749). |
| 4 — Sécurité et sauvegardes | En cours | P1 | Les corrections #2 empêchent la suppression d'une base préexistante en cas de collision ; les tests nominaux et collision simulée sont inclus. La recette #3 vérifie le HMAC avant déchiffrement et la restauration via le script officiel dans PostgreSQL `tmpfs`. Aucun VPS, secret réel ni backup de production n'a été utilisé. |
| 5 — PostgreSQL et règles métier | En cours | P1 | Run #91 : banc PostgreSQL jetable réussi ; archive restaurée, 20 services et un agent fictif contrôlés ; migrations jusqu'à `0027_indexes_performance_operational` et second passage idempotent ; privilèges du rôle `fann_app` vérifiés. Une restauration d'un clone VPS isolé et la validation métier CHNU Fann restent nécessaires. |
| 6 — Non-régression et performance | En cours | P2 | Les tests unitaires, PostgreSQL et Playwright sont verts sur les commits indiqués. Aucun test de charge représentatif ni mesure de latence/consommation CPU/RAM sur un VPS de recette n'est encore documenté. |
| 7 — Documentation et tableau qualité | En cours | P2 | Le tableau qualité et `docs/ETAT_ACTUEL.md` sont mis à jour sur la branche de consolidation ; les autres guides de préproduction doivent encore être passés en revue pour retirer les références aux PR fermées et refléter la version consolidée. |
| 8 — Préproduction et livraison | Bloqué | P1 | En attente d'une restauration récente sur un clone VPS isolé, HTTPS/DNS/Caddy, tests GPS et caméra sur appareils réels, impression physique, validation des responsables CHNU Fann et revue des PR. Aucun déploiement ni merge n'est autorisé par ce plan. |

## État GitHub et dépendances entre PR

- `main` est au commit `bafb11c7ac403eebbc00c5465eef4b509af812ca` : la PR #1 y a été fusionnée. Aucun changement direct sur `main` n'a été effectué dans cette nouvelle phase.
- PR #1 : [Sécuriser les sauvegardes et restaurations PostgreSQL](https://github.com/morn53426-ui/fann-pointage/pull/1), fusionnée dans `main`.
- PR #2 : [Empêcher la suppression d'une base préexistante](https://github.com/morn53426-ui/fann-pointage/pull/2), fusionnée dans `fix/p0-backup-restore-security`, pas directement dans `main`.
- PR #3 : [Restauration chiffrée intégrale et migrations PostgreSQL](https://github.com/morn53426-ui/fann-pointage/pull/3), fusionnée dans `fix/p1-restore-test-db-safety`; ses changements sont maintenant repris dans la PR #5.
- PR #4 : [Étendre la recette responsive et ajouter le tableau qualité](https://github.com/morn53426-ui/fann-pointage/pull/4), fusionnée dans `fix/p0-backup-restore-security`; ses changements sont maintenant repris dans la PR #5.
- PR #5 : [Consolider sécurité, restauration PostgreSQL et responsivité](https://github.com/morn53426-ui/fann-pointage/pull/5), ouverte en Draft vers `main`. Son run combiné #122 est en cours.

## Règles de preuve

1. Ne déclarer **Corrigé** ou **Validé** qu'avec un commit identifiable et un contrôle réellement exécuté.
2. Un run provenant d'une branche empilée doit être rattaché à cette branche et ne doit pas être présenté comme une validation de `main`.
3. Un test avec PostgreSQL `tmpfs` et des données fictives ne remplace pas la restauration sur un clone de recette représentatif.
4. Ne jamais utiliser `docker compose down -v`, `docker compose down --volumes` ni supprimer un volume PostgreSQL.
5. Ne jamais lire, modifier ou publier le contenu du `.env` réel ; ne jamais restaurer sur la base de production.
6. Ne jamais fusionner automatiquement, déployer en production ou modifier directement `main`.

## Prochaines actions

1. Vérifier le résultat complet du run #122 sur la PR #5 et corriger les éventuelles régressions combinées.
2. Compléter la matrice responsive des formulaires, tableaux et modales.
3. Faire relire la PR #5 ; ne la fusionner qu'après approbation humaine et CI verte.
4. Restaurer une sauvegarde récente sur un clone VPS isolé, avec données anonymisées/fictives, puis contrôler `/readyz`.
5. Mesurer les performances sur une infrastructure de recette représentative.
6. Obtenir les validations terrain CHNU Fann avant toute mise en production.

## Historique des preuves récentes

- PR #1, run #79, commit `f9b76e22` : CI standard verte.
- PR #3, run #91, commit `e3b506af` : CI complète verte, y compris le test de restauration chiffrée intégrale sur PostgreSQL `tmpfs`, migrations 0027 idempotentes, privilèges runtime et 40 tests Playwright.
- PR #2 : correction de collision de base temporaire fusionnée dans sa branche cible ; sera revalidée dans la CI de consolidation.
- PR #4, run #97 : CI verte pour la matrice responsive étendue et les autres contrôles du dépôt.
