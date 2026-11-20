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
| 1 — Rétablissement de la CI | Validé en CI | P1 | Run #130 sur `integration/preproduction-hardening` : installation, audit, contrôle livraison, TypeScript, tests Node, chiffrement, PostgreSQL jetable, restauration chiffrée intégrale `tmpfs` et Playwright tous réussis. La suite Playwright élargie a passé 55/55 tests. [Run #130](https://github.com/morn53426-ui/fann-pointage/actions/runs/44641989788). Run #142 a également terminé avec succès sur la tête `aa733cd` de la PR #5 : les 55 tests Playwright, la restauration chiffrée, PostgreSQL, TypeScript et tous les contrôles CI sont verts. |
| 2 — Responsive mobile / tablette / desktop | Validé en CI | P1 | Run #130 : 55/55 tests Playwright réussis. Les scénarios testent en-tête et vues tableau de bord, anomalies, absences, rapports, planning, badges, émargement et historique à 320, 360, 390, 430, 768, 1024 et 1440 px ; formulaires de création et fenêtre d'édition des badges comprises. Les appareils physiques et les autres parcours non couverts restent à vérifier sur site. |
| 3 — Badges et impression | Validé en CI | P1 | Run #130 : tests Playwright du format CR80, QR, aperçu, édition, recto-verso, PDF A4, texte minimum et responsive réussis. Aucune impression sur imprimante physique ni lecture avec les scanners réels n'a été réalisée. |
| 4 — Sécurité et sauvegardes | Validé en CI | P1 | Les corrections #2 empêchent la suppression d'une base préexistante en cas de collision ; les tests nominaux et collision simulée sont inclus. La recette #3 vérifie le HMAC avant déchiffrement et la restauration via le script officiel dans PostgreSQL `tmpfs`. Aucun VPS, secret réel ni backup de production n'a été utilisé. |
| 5 — PostgreSQL et règles métier | Validé en CI | P1 | Run #130 : banc PostgreSQL jetable et restauration chiffrée E2E réussis ; agent fictif et 20 services contrôlés ; migrations jusqu'à `0027_indexes_performance_operational` puis second passage idempotent ; privilèges `fann_app` vérifiés. Une restauration d'un clone VPS isolé et la validation métier CHNU Fann restent nécessaires. |
| 6 — Non-régression et performance | En cours | P2 | Les tests unitaires, PostgreSQL et Playwright sont verts sur les commits indiqués. Aucun test de charge représentatif ni mesure de latence/consommation CPU/RAM sur un VPS de recette n'est encore documenté. |
| 7 — Documentation et tableau qualité | Validé | P2 | `docs/PLAN_AUTOMATISATION_QUALITE.md`, `docs/ETAT_ACTUEL.md`, `README.md`, `DEMARRER-ICI-WINDOWS.md`, `docs/PREPARATION_PRODUCTION.md`, `docs/CHECKLIST_PILOTE.md` et `docs/DOCKER.md` ont été alignés sur la fusion de PR #1 et la PR #5 de consolidation. |
| 8 — Préproduction et livraison | Bloqué | P1 | En attente d'une restauration récente sur un clone VPS isolé, HTTPS/DNS/Caddy, tests GPS et caméra sur appareils réels, impression physique, validation des responsables CHNU Fann et revue des PR. Aucun déploiement ni merge n'est autorisé par ce plan. |

## État GitHub et dépendances entre PR

- `main` est au commit `bafb11c7ac403eebbc00c5465eef4b509af812ca` : la PR #1 y a été fusionnée. Aucun changement direct sur `main` n'a été effectué dans cette nouvelle phase.
- PR #1 : [Sécuriser les sauvegardes et restaurations PostgreSQL](https://github.com/morn53426-ui/fann-pointage/pull/1), fusionnée dans `main`.
- PR #2 : [Empêcher la suppression d'une base préexistante](https://github.com/morn53426-ui/fann-pointage/pull/2), fusionnée dans `fix/p0-backup-restore-security`, pas directement dans `main`.
- PR #3 : [Restauration chiffrée intégrale et migrations PostgreSQL](https://github.com/morn53426-ui/fann-pointage/pull/3), fusionnée dans `fix/p1-restore-test-db-safety`; ses changements sont maintenant repris dans la PR #5.
- PR #4 : [Étendre la recette responsive et ajouter le tableau qualité](https://github.com/morn53426-ui/fann-pointage/pull/4), fusionnée dans `fix/p0-backup-restore-security`; ses changements sont maintenant repris dans la PR #5.
- PR #5 : [Consolider sécurité, restauration PostgreSQL et responsivité](https://github.com/morn53426-ui/fann-pointage/pull/5), ouverte en Draft vers `main`. Le run combiné #130 a réussi sur le commit `385773ba` (55 tests Playwright). Le run #138 revalide le dernier commit documentaire.

## Règles de preuve

1. Ne déclarer **Corrigé** ou **Validé** qu'avec un commit identifiable et un contrôle réellement exécuté.
2. Un run provenant d'une branche empilée doit être rattaché à cette branche et ne doit pas être présenté comme une validation de `main`.
3. Un test avec PostgreSQL `tmpfs` et des données fictives ne remplace pas la restauration sur un clone de recette représentatif.
4. Ne jamais utiliser `docker compose down -v`, `docker compose down --volumes` ni supprimer un volume PostgreSQL.
5. Ne jamais lire, modifier ou publier le contenu du `.env` réel ; ne jamais restaurer sur la base de production.
6. Ne jamais fusionner automatiquement, déployer en production ou modifier directement `main`.

## Prochaines actions

1. Vérifier la réussite du run #136 sur le commit documentaire actuel de la PR #5.
2. Obtenir une revue humaine et la configuration des protections obligatoires de `main` avant de fusionner la PR #5.
3. Restaurer une sauvegarde récente sur un clone VPS isolé, avec données anonymisées/fictives, puis contrôler `/readyz`.
4. Exécuter le test de charge sur l'infrastructure de recette et consigner p50/p95/p99, erreurs, CPU/RAM et connexions PostgreSQL.
5. Réaliser les tests caméra/GPS/HTTPS, l'impression et le pilote avec les responsables CHNU Fann.
6. N'autoriser la production qu'après validation écrite de ces contrôles.

## Historique des preuves récentes

- PR #1, run #79, commit `f9b76e22` : CI standard verte.
- PR #3, run #91, commit `e3b506af` : CI complète verte, y compris le test de restauration chiffrée intégrale sur PostgreSQL `tmpfs`, migrations 0027 idempotentes, privilèges runtime et 40 tests Playwright.
- PR #2 : correction de collision de base temporaire fusionnée dans sa branche cible ; sera revalidée dans la CI de consolidation.
- PR #4, run #97 : CI verte pour la matrice responsive initiale étendue.
- PR #5, run #130, commit `385773ba` : CI combinée verte ; 55 tests Playwright réussis, dont formulaires/éditeur de badge et sept largeurs. [Run #130](https://github.com/morn53426-ui/fann-pointage/actions/runs/44641989788).
- PR #5, run #142, commit `aa733cd` : CI entièrement verte sur la tête finale vérifiée ; 55/55 tests Playwright et restauration chiffrée PostgreSQL `tmpfs` réussis. [Run #142](https://github.com/morn53426-ui/fann-pointage/actions/runs/44642779373).
