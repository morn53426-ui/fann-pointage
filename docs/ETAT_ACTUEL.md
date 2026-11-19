# État actuel du projet — point d'entrée unique FANN POINTAGE
Mise à jour : 19 novembre 2026 · Version : `0.2.0-preproduction.47`

> Ce fichier est le point d'entrée de l'état courant. Les audits et rapports de `docs/historique/` restent des instantanés historiques et ne décrivent pas nécessairement la version actuelle.

## État de livraison

- Branche de travail : `fix/p0-backup-restore-security`
- Révision de base de la PR #1 vérifiée : `f9b76e22e44d6b8826738e372f3057f122bdf7c4` (19 novembre 2026).
- Pull Request : [#1 — sécuriser les sauvegardes et restaurations PostgreSQL](https://github.com/morn53426-ui/fann-pointage/pull/1), encore en brouillon.
- Branche `main` : non modifiée par cette série de corrections.
- Statut : **préproduction**. La CI est verte, mais la recette sur un clone du VPS/de la base réelle et les validations sur site restent obligatoires avant toute mise en production.

## Fonctions présentes

- Pointage par QR, heure serveur, géorepérage, mode hors ligne, poste partagé et validation manuelle motivée.
- Régimes général, garde, urgences et Mobil, avec règles de calendrier et de repos.
- Catalogue PostgreSQL des services et agents, plannings, absences, rapports, classement mensuel et anomalies.
- Badges recto-verso, QR versionnés et révocables, données de badge modifiables et impression A4.
- Messagerie persistante générale ou ciblée par comptes/services, avec priorité et suivi de lecture.
- Export JSON métier expurgé réservé à l'administrateur. Cet export n'est pas un remplacement du dump PostgreSQL complet.
- Sécurité : mots de passe scrypt, sessions signées, contrôles de rôles côté serveur, journal d'audit, rôle SQL runtime `fann_app` distinct du rôle de migration.
- Exploitation : services Docker `db`, `migrate`, `app`, reverse proxy Caddy sur le VPS, sauvegarde chiffrée et procédure de restauration.

## Migrations PostgreSQL

Le paquet de migration de catalogue traite les migrations `0013` à `0027`. L'ajout de l'ENUM Mobil `0017` est vérifié/appliqué séparément, entre les migrations `0016` et `0018`.

Migrations opérationnelles les plus récentes :
- `0025_anomalies_suivi` : suivi de traitement des anomalies.
- `0026_mobil_gardes_24h_weekends_feries` : gardes Mobil de 24 h dans les cas calendaires prévus.
- `0027_indexes_performance_operational` : index complémentaires pour les lectures historiques et les vues par service.

Le service Compose `migrate` lance `scripts/migrate-catalogue.mjs`, puis configure les droits du rôle runtime avant le démarrage de l'application. Sur une base existante, ne supprimez jamais le volume pour forcer les migrations. Consultez `docs/DOCKER.md`.

## Vérifications GitHub Actions — PR #1 et branches de suivi

Sur la tête de la PR #1 `f9b76e22`, les contrôles suivants sont réussis :
- installation des dépendances et audit des dépendances de production ;
- vérification de l'absence de fichiers privés et de secrets livrables ;
- TypeScript et suite de tests Node ;
- tests de chiffrement/intégrité des sauvegardes et vérification des scripts navigateur ;
- intégration sur un PostgreSQL jetable (migrations, QR, concurrence) ;
- tests de bout en bout Playwright sur Chromium.

Lien : [exécution CI #79 réussie — PR #1](https://github.com/morn53426-ui/fann-pointage/actions/runs/44620631851).

Une validation plus poussée de la restauration a également été ajoutée sur la branche de suivi de la PR #3 : [run #91 réussi](https://github.com/morn53426-ui/fann-pointage/actions/runs/44621955504). Elle restaure une archive chiffrée avec des données fictives sur PostgreSQL `tmpfs`, vérifie la migration `0027` deux fois et les privilèges `fann_app`. Cette preuve appartient à la branche empilée de la PR #3 et n'est pas encore intégrée à la tête de la PR #1.

Cette validation automatisée ne signifie pas que le VPS, une base de production, les téléphones de l'hôpital ou les imprimantes réelles ont été testés.

## Sauvegardes et restauration

Sur Linux/VPS, `scripts/vps/sauvegarde-chiffree.sh` produit un dump PostgreSQL et une copie de `.env`, puis une archive chiffrée AES-256-CBC/PBKDF2 et authentifiée par HMAC-SHA256 (format V2). Le contrôle HMAC est effectué avant déchiffrement lors de la restauration. La clé par défaut est `~/.fann-backup.key` et doit être copiée séparément hors du VPS.

Pour valider une archive sans remplacer la base courante, utilisez le mode test du script dédié :

```bash
export COMPOSE_FILE="compose.yaml:compose.vps.yaml"
bash scripts/vps/restaurer-sauvegarde-chiffree.sh sauvegardes/chiffrees/fann-AAAAMMJJ-HHMMSS.tar.enc test
```

Le mode test restaure dans une base temporaire, vérifie les principales tables et supprime automatiquement cette base. Pour une répétition complète de migration sur un clone persistant, consultez la section recette de `docs/PREPARATION_PRODUCTION.md`. N'utilisez jamais le mode `production` sur le VPS réel pour un simple test.

Les archives historiques sans HMAC sont refusées par défaut. L'option `ALLOW_LEGACY_BACKUP=1` est une dérogation exceptionnelle, à n'utiliser qu'après vérification de la provenance ; elle ne fournit pas de preuve cryptographique d'intégrité.

## Reste à valider avant toute production

- [ ] Restaurer une sauvegarde récente sur un environnement de recette isolé, puis faire migrer ce clone jusqu'à `0027`.
- [ ] Vérifier que le deuxième passage de mise à niveau n'applique aucune migration supplémentaire.
- [ ] Exécuter les scénarios métier sur le clone : comptes/rôles, agents/services, planning Mobil, QR, pointage en concurrence, anomalies, messagerie et rapports.
- [ ] Tester HTTPS avec le vrai DNS et Caddy, puis caméra et GPS sur les téléphones utilisés sur site.
- [ ] Contrôler les badges et feuilles d'émargement sur les imprimantes réelles.
- [ ] Faire valider par le CHNU Fann les horaires/régimes, les zones GPS, les accès, la conservation des données et les procédures de support.
- [ ] Réaliser un pilote limité à un service avant l'ouverture générale.

## Documents de référence

| Besoin | Document |
|---|---|
| Docker, migrations et base existante | `docs/DOCKER.md` |
| Recette de préproduction et critères de sortie | `docs/PREPARATION_PRODUCTION.md` |
| Installation VPS/HTTPS | `docs/DEPLOIEMENT_VPS.md` |
| Sauvegardes chiffrées Linux/VPS | `docs/DEPLOIEMENT_VPS.md`, `scripts/vps/` |
| Sauvegardes Windows/PowerShell | `docs/SAUVEGARDE_SERVEUR.md` |
| Pilote avant ouverture générale | `docs/CHECKLIST_PILOTE.md` |
| Règles métier | `docs/REGIMES.md`, `docs/POINTAGE.md` |

## Décisions et limites connues

- La gouvernance des données personnelles (photos, adresses, téléphones), les durées de conservation et les obligations applicables au Sénégal doivent être confirmées avec la direction et les personnes compétentes.
- Le limiteur de tentatives de connexion est en mémoire : une seule instance applicative doit être utilisée tant qu'un stockage partagé n'est pas mis en place.
- Le serveur exécute le TypeScript avec `--experimental-strip-types`. Une compilation JavaScript dédiée reste une évolution possible.
- Les essais de sauvegarde/restauration PowerShell doivent être exécutés et documentés sur un poste Windows réel avant de considérer cette voie d'exploitation validée.
