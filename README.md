# FANN POINTAGE

**Version 0.2.0-preproduction.47 — branche de correction `fix/p0-backup-restore-security`.** Cette révision comprend les corrections de sécurité/sauvegarde, les ajustements des badges et du responsive mobile, ainsi que la migration `0027_indexes_performance_operational`. Les contrôles GitHub Actions de la révision `04546766` sont réussis ; la version reste toutefois en préproduction jusqu'à la recette sur un clone de la base, les essais sur appareils réels et la validation métier. La PR #1 est encore en brouillon.

## Périmètre fonctionnel de cette livraison

Le mode `postgres-catalogue` utilise PostgreSQL pour le registre des agents et services, le pointage par QR dynamique ou badge sur poste partagé, les plannings et jours fériés, l’émission/révocation/renouvellement des badges, l’historique du pointage, les anomalies, le tableau de bord, les classements mensuels, le registre des absences/justifications et les rapports jour/semaine/mois avec exports CSV, la messagerie générale ou ciblée (comptes/services) et l’export métier expurgé réservé à l’administrateur. Ces routes sont dispatchées vers le dépôt PostgreSQL : elles ne sont pas redirigées vers les données fictives de démonstration.

Le tableau de bord dispose d’indicateurs issus de PostgreSQL, d’un état de connexion explicite, d’un aperçu sur 7 jours, des compteurs par régime et d’une présentation adaptative desktop/mobile. La création, l’émission, le renouvellement et la révocation des badges ainsi que la modification des données agents sont réservés à l’administrateur côté serveur. Révoquer un badge ne désactive pas l’agent ; les pointages historiques ne sont pas supprimés.

Les éléments de référence fournis pour l'import initial représentent **54 fiches agents et 20 services**. Le fichier nominatif SQL reste hors du dépôt et n'est jamais intégré à l'image Docker ni appliqué par les migrations ordinaires. Son import, s'il est autorisé, nécessite la prévisualisation et l'approbation décrites dans `docs/IMPORT_REGISTRE.md`. Les matricules absents de la liste restent vides ; les régimes importés doivent être confirmés par l’administration avant la création des plannings.

## Limites restantes — préproduction uniquement

Les absences/justifications et rapports détaillés sont maintenant raccordés à la couche PostgreSQL dans le code livré. La migration `0015_absences_rapports_postgres` ajoute les métadonnées nécessaires au registre (service historique, auteur, note administrative, date et motif de décision). Cette couche a été exercée sur une véritable instance PostgreSQL 16 (base neuve et base mise à niveau) lors de la recette v18 ; les tests unitaires, eux, utilisent des clients simulés. Elle reste à rejouer sur le poste de déploiement (`docs/PREPARATION_PRODUCTION.md`). Le QR dynamique nécessite une zone de pointage configurée avec les coordonnées validées du site. Les règles de calendrier, les régimes individuels et les accès responsables doivent être validés avec l’administration du CHNU Fann.

**Vérifications de la révision 0.2.0-preproduction.47 :** GitHub Actions a réussi l'installation des dépendances, l'audit des dépendances de production, le contrôle de livraison, TypeScript, les tests Node, les tests de chiffrement/intégrité des sauvegardes, les tests sur PostgreSQL jetable et Playwright sur Chromium. Voir l'exécution [CI réussie](https://github.com/morn53426-ui/fann-pointage/actions/runs/44607027343). Ces contrôles automatisés ne remplacent pas la recette sur un clone du VPS/de la base, ni les essais HTTPS, caméra, GPS et impression sur les appareils réels. Voir `docs/PREPARATION_PRODUCTION.md`.

**Toujours obligatoire avant la production :** restaurer une archive chiffrée authentifiée sur un clone isolé, mettre ce clone à niveau jusqu'à `0027`, refaire les scénarios métier, puis tester les appareils, la caméra, le GPS, le HTTPS, l'impression et un pilote contrôlé. Le dépôt `main` n'est pas mis à jour par cette branche de correction.

## Démarrage — Windows / Git Bash

Prérequis : Node.js 22.23.4+ et Docker Desktop démarré. Dans le dossier extrait :

```bash
npm install
npm run setup:env   # uniquement si .env n'existe pas
```

Si `.env` existe déjà depuis une version précédente, ne le supprimez pas et ne relancez pas `setup:env`. Après `npm install`, exécutez `npm run setup:upgrade-runtime-role` : le script sauvegarde la configuration, sépare les identifiants PostgreSQL, crée/conserve `BADGE_SECRET` et bascule `FANN_MODE` sur `postgres-catalogue`. Sur une base existante, démarrez ensuite `db`, appliquez les migrations, puis exécutez `npm run db:configure-app-role`. Ne partagez pas `.env` : il contient les secrets.

Démarrez la base, vérifiez/appliquez la migration du registre avec le compte administrateur local, puis démarrez l’application :

```bash
docker compose up --build -d db
# Attendre que le conteneur db soit healthy
docker compose ps
npm run migrate:catalogue
# Sur une base existante, reconfigurer les droits du compte runtime
npm run db:configure-app-role
docker compose up --build -d app
docker compose ps -a
npm run health
```

Sur une base neuve, Docker applique les migrations SQL, crée le rôle non-superutilisateur `fann_app` et lui accorde les droits listés dans `scripts/grant-runtime-role.sql`. Sur un volume existant, les scripts initiaux ne se rejouent pas : `npm run migrate:catalogue` applique les migrations manquantes et `npm run db:configure-app-role` met à jour les droits runtime. Les deux scripts utilisent `DATABASE_ADMIN_URL`, séparé de la connexion runtime. Les migrations de planning Mobil `0017_regime_mobil_enum` et `0018_planning_mobil_rules` ajoutent le régime Mobil, les durées de 8 h/16 h et convertissent uniquement les affectations ouvertes du service Mobile. La migration `0026_mobil_gardes_24h_weekends_feries` autorise les nouvelles gardes Mobil de 24 h (08 h–08 h) lorsque la date de début tombe un samedi, un dimanche ou un jour férié ; les gardes ordinaires restent 16 h–08 h et chacune est suivie d’au moins 56 h de repos. La migration `0020_regles_calendrier_services` règle le service général sur lundi–vendredi hors jours fériés et ajuste les régimes par défaut des services généraux, sans modifier les régimes individuels ni les plannings historiques. La migration 0016 reste dédiée aux champs facultatifs du badge. Ne lancez jamais `docker compose down -v` pour essayer de réexécuter une migration.

> Le port publié est `APP_PORT` dans `.env` (8787 par défaut, 8788 si vous l’avez changé). `npm run health` lit ce port ; `docker compose ps` l’affiche aussi. Ne tapez pas 8787 en dur si votre `.env` dit autrement.

Connectez-vous sur `http://127.0.0.1:<APP_PORT>` (8787 par défaut) avec `admin` et le mot de passe stocké dans `ADMIN_INITIAL_MOT_DE_PASSE` dans `.env`. Si la base est neuve et ne contient pas encore d’administrateur, créez-en un **une seule fois** :

```bash
npm run admin:postgres -- admin
```

Un administrateur existe déjà dans la base utilisée pendant les tests antérieurs ; dans ce cas, ne relancez pas la commande de création.

**État actuel et documents à jour : [`docs/ETAT_ACTUEL.md`](docs/ETAT_ACTUEL.md).** Guide Windows complet : [`DEMARRER-ICI-WINDOWS.md`](DEMARRER-ICI-WINDOWS.md). Documentation Docker : [`docs/DOCKER.md`](docs/DOCKER.md). Import initial sécurisé : [`docs/IMPORT_REGISTRE.md`](docs/IMPORT_REGISTRE.md).

## Tests locaux

```bash
npm test
npm run test:security
npm run test:e2e:process
npm run test:postgres:unit
npm run test:auth:postgres
npm run typecheck
```

Le test `npm run test:postgres` lance des essais PostgreSQL jetables, crée et détruit son propre conteneur/volume de test ; ne le lancez jamais sur une base contenant le registre utile. Les tests avec un client SQL simulé ne remplacent pas les tests d’intégration sur un vrai PostgreSQL.

## Régimes initiaux : à confirmer

Le régime des agents importés depuis « SG » est `general`. Les urgences utilisent `urgences`. Les autres services ont reçu un régime initial provisoire en s’appuyant sur les règles communiquées lors de la conception ; confirmez ces affectations auprès de l’administration avant de générer des plannings. Les horaires métier documentés restent : service général 08 h–16 h du lundi au vendredi, hors jours fériés ; garde 24 h de 08 h à 08 h puis 48 h de repos ; urgences jour 08 h–20 h et nuit 20 h–08 h, avec cycles distincts.

Avant l’émission des badges, les responsables doivent confirmer les identités, matricules, régimes et services depuis la source autorisée. Les références `FANN-PHOTO-*` servent uniquement à identifier les fiches de l’import initial ; elles ne sont pas des matricules officiels.

## Sécurité et production

- L’application est liée à `127.0.0.1` par défaut ; n’exposez pas directement le port sur Internet.
- Les changements d’agents/services sont réservés à l’administrateur ; le serveur vérifie les permissions même si l’interface est modifiée.
- L’archivage ne supprime pas les affectations et pointages historiques.
- Le géorepérage n’est actif que si `ZONE_LAT` et `ZONE_LNG` sont tous deux renseignés ; validez le point de référence et le rayon sur site.
- La connexion runtime `fann_app` n'est pas superutilisateur, n'a pas de droits DDL, ne contourne pas globalement la RLS et reçoit des politiques explicites sur les tables du catalogue/authentification actuellement activés.
- `/healthz` vérifie la vie du processus ; `/readyz` vérifie PostgreSQL, les colonnes opérationnelles requises et les marqueurs des migrations 0013/0014/0015/0016/0018/0019/0020/0021/0022/0023/0024/0025/0026/0027 ainsi que le régime Mobil dans l’ENUM.
- Avant le déploiement officiel : HTTPS, sauvegardes chiffrées avec restauration testée, supervision, authentification et rôles revus, validation des migrations sur le vrai conteneur PostgreSQL, essais de concurrence, panne/reprise, revue métier des règles et essais terrain au CHNU Fann sont requis. La recette des absences/justifications, des rapports détaillés et de leurs exports sur une vraie base PostgreSQL reste obligatoire.

## Code et schéma

- `supabase/migrations/0013_catalogue_reel_agents_services.sql` : importe les 20 services et les 54 fiches.
- `supabase/migrations/0014_runtime_operations_and_agent_photo.sql` : ajoute les champs photo/index opérationnels.
- `supabase/migrations/0015_absences_rapports_postgres.sql` : raccorde le registre des absences et la traçabilité des décisions.
- `supabase/migrations/0016_badge_profession_contact.sql` : ajoute `profession`, `adresse` et `telephone` (facultatifs, bornés) pour le recto/verso du badge.
- `supabase/migrations/0017_regime_mobil_enum.sql` et `0018_planning_mobil_rules.sql` : ajoutent le régime Mobil et ses durées ; l’historique des plannings terminés reste inchangé. `0019_general_heure_fin.sql` borne les horaires courts du régime général ; `0020_regles_calendrier_services.sql` applique le calendrier ouvré et les nouveaux défauts de services.
- `scripts/migrate-catalogue.mjs` : applique de façon idempotente les migrations 0013 à 0016, 0018 à 0024 sur une base existante, et vérifie le nouvel ENUM par la migration 0017.
- `src/api/routes.ts` : aiguillage des requêtes et contrôle d'accès commun (session valide, mot de passe provisoire, routes autorisées selon le mode) ; chaque famille de routes vit dans un module `src/api/routes-*.ts` (session, comptes, agents, catalogue, classement, pointage, plannings, badges, suivi, absences, jours fériés, zones/QR). `src/api/routes-caracterisation.test.ts` fige les statuts, codes d'erreur et messages par rôle (brancardier, responsable limité à ses services, administrateur).
- `src/api/operations-postgres.ts` : routes métier PostgreSQL (plannings, badges, pointage station, zones/QR, tableau de bord, classement, anomalies, absences, rapports) ; la messagerie vit dans `operations-messages.ts`, les jours fériés, badges et zones/QR dans `operations-referentiel.ts` et les utilitaires communs dans `operations-communs.ts` (les autres familles seront extraites de la même façon).
- `src/api/catalogue-postgres.ts` : opérations transactionnelles de gestion des agents et services.
- `src/api/main-postgres-catalogue.ts` et `src/api/entrypoint.ts` : mode catalogue dédié sans chargement de données de démonstration.
- `scripts/docker-init-create-app-role.sh`, `scripts/grant-runtime-role.sql` et `scripts/configurer-role-application.mjs` : rôle de connexion runtime limité.
- `scripts/upgrade-env-app-role.mjs` : migration prudente des `.env` créés avant la séparation des comptes.
- `web/app.js` : rubrique de gestion, ajout, édition, recherche, archivage et réactivation.
- `docs/REGIMES.md`, `docs/DEPLOIEMENT.md`, `docs/DATABASE.md` : règles métier et autres contrôles à compléter avant la production.


### Messagerie et copie de sauvegarde

Après mise à jour, le service `migrate` applique les migrations `0021_messagerie_diffusion` et `0022_messagerie_destinataires`, puis configure les droits runtime. La navigation « Messages » est disponible à tous les comptes de l'application PostgreSQL. Seul un administrateur peut envoyer une diffusion générale, à des comptes précis ou à un service ; les messages ciblés sont filtrés côté serveur et les lectures sont suivies.

La page « Sauvegarde en ligne » permet à l'administrateur d'exporter les principales données métier en JSON depuis PostgreSQL. C'est une copie téléchargeable supplémentaire, pas une restauration complète : les mots de passe, sessions et secrets QR/badges sont exclus. Continuez d'utiliser les scripts de sauvegarde PostgreSQL chiffrée pour disposer d'une vraie copie serveur distante et testez la restauration régulièrement (voir `docs/SAUVEGARDE_SERVEUR.md`). Les exports contiennent des données personnelles : stockez-les dans un emplacement protégé.

## Lot v21 (0.2.0-preproduction.26) — correctifs d'audit avant production

Voir `docs/historique/CORRECTIFS-V22-2026-10-23.md` (expiration du mot de passe provisoire, verrou par compte, règle administrateur renforcée) puis `docs/historique/CORRECTIFS-V21-2026-10-23.md` : mot de passe administrateur (9 caractères minimum), compte agent créé automatiquement avec le badge (matricule + téléphone), changement de mot de passe obligatoire/volontaire (`PATCH /api/moi`), journalisation des erreurs 500, retrait des messages (`DELETE /api/messages/:id`), migration `0023_comptes_agents_mot_de_passe`. Après mise à jour : `docker compose build app migrate && docker compose up -d`.
