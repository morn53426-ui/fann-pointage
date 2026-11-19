# Plan d'automatisation qualité — FANN POINTAGE

Mise à jour : 19 novembre 2026 · Fuseau : Africa/Dakar  
Dépôt : https://github.com/morn53426-ui/fann-pointage  
Branche principale : `main`  
Branche corrective de référence au démarrage de cette mise à jour : `fix/p0-backup-restore-security` — `f9b76e22e44d6b8826738e372f3057f122bdf7c4`

> Ce tableau décrit les preuves effectivement disponibles à la date indiquée. Une CI verte sur une branche de travail ne signifie ni intégration dans `main`, ni recette terrain, ni autorisation de mise en production.

## Tableau de suivi obligatoire

Les seuls statuts autorisés sont : **À faire**, **En cours**, **Bloqué**, **Corrigé**, **Validé**.

| Phase | Statut | Priorité | Preuve / situation vérifiable |
|---|---|---:|---|
| 0 — Audit initial | En cours | P1 | Références GitHub vérifiées : `main` = `b399764d`, branche corrective = `f9b76e22`, PR #1 ouverte en Draft. L'audit courant est ciblé ; l'inventaire exhaustif du code, des routes, des règles métier et des dépendances reste à compléter. |
| 1 — Rétablissement de la CI | Corrigé | P1 | Run #79 de la PR #1, commit `f9b76e22` : installation, audit de production, contrôle livraison, TypeScript, tests Node, tests backup, PostgreSQL et Playwright terminés avec succès. [Run #79](https://github.com/morn53426-ui/fann-pointage/actions/runs/44620631851). La recette de restauration intégrale ajoutée ensuite est sur la PR #3, pas encore intégrée à la PR #1. |
| 2 — Responsive mobile / tablette / desktop | En cours | P1 | Les scénarios d'en-tête et badges couvrent désormais les largeurs 320, 360, 390, 430, 768, 1024 et 1440 px sur la branche `quality/phase2-responsive-plan`. La CI de cette branche doit encore prouver ces nouveaux cas ; formulaires, tableaux et modales restent à couvrir plus largement. |
| 3 — Badges et impression | En cours | P1 | Les 40 tests Playwright du run #91 sont passés, incluant format CR80, QR, aperçu, recto-verso et PDF A4. Aucune impression sur imprimante physique n'a été réalisée. [Run #91](https://github.com/morn53426-ui/fann-pointage/actions/runs/44621955504). |
| 4 — Sécurité et sauvegardes | En cours | P1 | PR #2 corrige le risque de collision de nom de base temporaire ; tests nominaux et collision simulée intégrés au test backup. PR #3 vérifie sur données fictives le HMAC avant déchiffrement et la restauration via le script officiel dans PostgreSQL `tmpfs`. Aucun VPS, secret réel ni backup de production n'a été utilisé. |
| 5 — PostgreSQL et règles métier | En cours | P1 | Run #91 : banc PostgreSQL jetable réussi ; archive restaurée, 20 services et un agent fictif contrôlés ; migrations jusqu'à `0027_indexes_performance_operational` et second passage idempotent ; privilèges du rôle `fann_app` vérifiés. Une restauration d'un clone VPS isolé et la validation métier CHNU Fann restent nécessaires. |
| 6 — Non-régression et performance | En cours | P2 | Les tests unitaires, PostgreSQL et Playwright sont verts sur les commits indiqués. Aucun test de charge représentatif ni mesure de latence/consommation CPU/RAM sur un VPS de recette n'est encore documenté. |
| 7 — Documentation et tableau qualité | En cours | P2 | Ce fichier est créé sur la branche de suivi qualité. Les références historiques de `docs/ETAT_ACTUEL.md` et les documents opérationnels doivent encore être alignés sur les commits réellement livrés. |
| 8 — Préproduction et livraison | Bloqué | P1 | En attente d'une restauration récente sur un clone VPS isolé, HTTPS/DNS/Caddy, tests GPS et caméra sur appareils réels, impression physique, validation des responsables CHNU Fann et revue des PR. Aucun déploiement ni merge n'est autorisé par ce plan. |

## État GitHub et dépendances entre PR

- `main` reste sur le commit de référence `b399764d1eea2ea9ca487d030e21cb2bbb781c91` ; aucune modification de `main` n'a été effectuée dans ce travail.
- PR #1 : [Sécuriser les sauvegardes et restaurations PostgreSQL](https://github.com/morn53426-ui/fann-pointage/pull/1), ouverte en Draft, cible `main`.
- PR #2 : [Empêcher la suppression d'une base préexistante](https://github.com/morn53426-ui/fann-pointage/pull/2), ouverte en Draft, cible `fix/p0-backup-restore-security`. À la dernière comparaison, cette branche de suivi était en retard de deux commits sur la tête de PR #1 ; synchroniser avant toute intégration.
- PR #3 : [Restauration chiffrée intégrale et migrations PostgreSQL](https://github.com/morn53426-ui/fann-pointage/pull/3), ouverte en Draft, empilée sur la branche de PR #2. Son run #91 est vert ; cela ne vaut pas fusion automatique.

## Règles de preuve

1. Ne déclarer **Corrigé** ou **Validé** qu'avec un commit identifiable et un contrôle réellement exécuté.
2. Un run provenant d'une branche empilée doit être rattaché à cette branche et ne doit pas être présenté comme une validation de `main`.
3. Un test avec PostgreSQL `tmpfs` et des données fictives ne remplace pas la restauration sur un clone de recette représentatif.
4. Ne jamais utiliser `docker compose down -v`, `docker compose down --volumes` ni supprimer un volume PostgreSQL.
5. Ne jamais lire, modifier ou publier le contenu du `.env` réel ; ne jamais restaurer sur la base de production.
6. Ne jamais fusionner automatiquement, déployer en production ou modifier directement `main`.

## Prochaines actions

1. Faire terminer la CI de la branche `quality/phase2-responsive-plan` après l'extension de la matrice responsive.
2. Compléter les scénarios responsive pour les formulaires, tableaux, navigation et modales.
3. Synchroniser la branche PR #2 avec la tête actuelle de PR #1 après revue du diff, sans écraser les commits existants.
4. Réaliser une recette de restauration sur un clone VPS isolé, avec données anonymisées/fictives, sauvegarde récente et contrôle de /readyz.
5. Mesurer les performances sur une infrastructure de recette représentative.
6. Obtenir les validations terrain et la revue humaine avant toute sortie de Draft ou fusion.

## Historique des preuves récentes

- PR #1, run #79, commit `f9b76e22` : CI standard verte.
- PR #3, run #91, commit `e3b506af` : CI complète verte, y compris le test de restauration chiffrée intégrale sur PostgreSQL `tmpfs`, migrations 0027 idempotentes, privilèges runtime et 40 tests Playwright.
- PR #2, run #63, commit `3a4956e3` : CI verte pour la correction de collision de base temporaire ; ce run précède la mise à jour de la branche PR #1 et doit être revalidé après synchronisation.
