# Docker — FANN POINTAGE

## Mode fourni par cette version

Compose démarre trois services :

- `db` : PostgreSQL avec volume persistant `fann-pointage-postgres-data` ;
- `migrate` : tâche ponctuelle qui applique les migrations manquantes et configure les droits du rôle runtime ;
- `app` : l’application Node.js, en mode `FANN_MODE=postgres-catalogue` par défaut. Elle attend que `db` soit saine et que `migrate` ait réussi.

Le catalogue comprend 20 services de référence. Les éléments de référence transmis pour l'import initial représentent 54 fiches agents, mais le fichier nominatif reste hors du dépôt et n'est pas importé automatiquement : voir `docs/IMPORT_REGISTRE.md`. Après migration, le registre peut donc contenir 0 fiche importée ou 54 fiches validées ; un nombre partiel doit être examiné et ne doit pas être corrigé par suppression manuelle. Les routes persistantes actuelles couvrent les agents/services, le pointage QR, le pointage au poste partagé par badge, les plannings/jours fériés, les badges versionnés, l’historique, les anomalies, le tableau de bord, les classements mensuels, la messagerie générale et l’export de sauvegarde métier réservé à l’administrateur. Aucune de ces routes ne doit retomber sur les données de démonstration.

La gestion des fiches agents et des badges est limitée à l’administrateur côté serveur. L’émission/révocation/renouvellement des badges est auditée ; retirer un badge ne désactive pas l’agent. Le rôle SQL `fann_app` n’est pas superutilisateur et ne possède pas de droits DDL.

**Préproduction — version 0.2.0-preproduction.47 :** la PR #1 (socle sauvegardes/sécurité) est fusionnée dans `main`. Les corrections additionnelles de restauration et de responsive sont regroupées sur `integration/preproduction-hardening` et la PR #5 ; la CI combinée doit être verte avant revue/merge. Les tests de restauration CI utilisent PostgreSQL isolé en `tmpfs` (aucun volume Docker persistant), sans supprimer de volume. Les migrations du catalogue vont jusqu’à `0027_indexes_performance_operational` ; le script vérifie aussi l’ENUM Mobil `0017`. Cela ne remplace pas la recette d’un clone de la base du site, ni les essais HTTPS, GPS, caméra et impression sur les appareils réels. Ne considérez pas cette version comme un registre officiel de présence avant validation des contrôles de `docs/PREPARATION_PRODUCTION.md`.

## Configuration

Dans Git Bash, depuis le dossier du projet :

```bash
npm install
npm run setup:env   # uniquement si .env n’existe pas déjà
```

Le script produit des secrets aléatoires et fixe par défaut `FANN_MODE=postgres-catalogue`. Ne partagez jamais le fichier `.env`. Si `.env` existe, il n’est pas écrasé. Exécutez `npm run setup:upgrade-runtime-role` : il sauvegarde l’ancien fichier, configure la connexion `fann_app`, conserve un secret durable `BADGE_SECRET` et définit le mode PostgreSQL pour éviter le démarrage accidentel en mode démo.

## Démarrage recommandé

Pour assurer que le catalogue est importé, commencez par démarrer PostgreSQL :

```bash
docker compose up --build -d db
docker compose ps
docker compose logs --tail=80 db
```

Attendez `healthy`, puis appliquez la migration idempotente sur la base locale :

```bash
npm run migrate:catalogue
npm run db:configure-app-role
```

Sur une base existante, le script applique les migrations manquantes `0013` à `0016`, vérifie/applique l’ENUM `0017`, puis applique `0018` à `0027` et configure les privilèges minimaux du rôle runtime. Il ne demande pas de supprimer le volume. Sur un volume neuf, Docker exécute toutes les migrations à l’initialisation et le script confirme celles déjà appliquées.

Ensuite démarrez le catalogue :

```bash
docker compose up --build -d app
docker compose ps -a
docker compose logs --tail=80 app
curl -i http://127.0.0.1:8787/healthz
curl -i http://127.0.0.1:8787/readyz
```

Ouvrir `http://127.0.0.1:8787`. La connexion se fait avec le compte applicatif administrateur créé via le script `npm run admin:postgres -- admin`; le secret initial est défini lors de sa création. Ne recréez pas ce compte s’il existe déjà. Sur une base neuve uniquement, créez-le une fois avec `npm run admin:postgres -- admin`.

## Régistre et maintenance

Les 20 services sont dans `supabase/migrations/0013_catalogue_reel_agents_services.sql`. Le registre nominatif est conservé hors du dépôt, des archives et des images Docker. La commande normale `npm run migrate:catalogue` applique uniquement les migrations du schéma ; un import initial doit être explicitement prévisualisé puis appliqué avec `REGISTRE_INITIAL_SQL` et les options documentées dans `docs/IMPORT_REGISTRE.md`. Une réexécution ne remplace pas les noms ou prénoms corrigés en base. Les régimes importés doivent être vérifiés par l’administration avant la création des plannings. Pour l’unité Mobil, les agents affectés au service de jour travaillent 08 h–16 h du lundi au vendredi, sans samedi ni dimanche (jours fériés exclus par défaut). Les agents affectés aux gardes travaillent 16 h–08 h les jours ouvrés non fériés ; si la date de début de leur garde tombe un samedi, un dimanche ou un jour férié enregistré, la garde est automatiquement 08 h–08 h (24 h). Après chaque garde, le moteur impose au moins 56 heures consécutives de repos avant toute nouvelle prise de poste. Les groupes de rotation A, B et C sont conservés ; les autres régimes ne sont pas modifiés.

La suppression dans l’interface est un archivage réversible ; les historiques d’affectation et les pointages restent conservés. Un service qui a encore des agents actifs ne peut pas être archivé. Avant un usage officiel, vérifiez les graphies incertaines sur la liste originale et la configuration des régimes.

## Base existante et migrations

Les scripts du dossier `supabase/migrations/` sont exécutés automatiquement uniquement au premier démarrage d’un volume PostgreSQL neuf. La reconstruction de l’image ne rejoue pas les migrations sur un volume existant. Pour le registre courant, le service Compose `migrate` exécute `scripts/migrate-catalogue.mjs` et `scripts/configurer-role-application.mjs` avant le démarrage de `app`. Le script vérifie `app_schema_migrations`, applique les migrations `0013` à `0016`, vérifie l’ENUM `0017`, puis applique `0018` à `0027` de façon idempotente. La commande ne lit aucun fichier nominatif, sauf si une option d'import initial est explicitement fournie.

Ne faites pas `docker compose down -v` pour « relancer » une migration : cela supprimerait les données du volume. Sauvegardez et testez une restauration avant de changer le schéma d’une base utile.

## Sécurité et limites de production

- Le port de l’application est lié à `127.0.0.1` par défaut. Ne l’ouvrez pas à Internet.
- Configurez HTTPS, secrets hors dépôt, réseau de confiance, sauvegardes chiffrées et restauration testée avant une exploitation réelle.
- Le contrôle GPS exige des coordonnées validées ; un rayon seul n’active pas le géorepérage.
- Le compte administrateur ne doit être remis qu’à une personne autorisée.
- L'application utilise le rôle runtime `fann_app`, sans `SUPERUSER`, `CREATEDB`, `CREATEROLE`, droit DDL ou bypass global de RLS. Les droits de table couvrent les routes PostgreSQL opérationnelles de cette version ; les permissions de rôle sont contrôlées par l’API et doivent être revalidées avant une évolution du schéma.
- `/healthz` est la sonde de vie. `/readyz` teste la connexion PostgreSQL, les colonnes opérationnelles utilisées par l’API et la présence des migrations 0013/0014/0015/0016/0018/0019/0020/0021/0022/0023/0024/0025/0026/0027 et le régime Mobil dans l’ENUM ; Compose s'appuie sur `/readyz` pour marquer l'app `healthy`.
- Les opérations courantes ci-dessus sont maintenant routées vers PostgreSQL, mais restent à valider sur une vraie instance : migrations, émission/révocation de badges, génération de planning, pointages en concurrence, rôles et reprise après arrêt. La prise en charge SQL des absences/justifications et rapports a été ajoutée en 0015 ; ces scénarios exigent toujours un test d’intégration sur la vraie base et un contrôle métier avant production.

## Essais PostgreSQL sur base jetable

`npm run test:postgres` est réservé aux tests isolés : il construit un conteneur de test dont `PGDATA` est monté en `tmpfs`, sans volume Docker persistant ; son nettoyage retire uniquement le conteneur et l’image de test. Ne lancez jamais ces tests sur la base contenant les 54 fiches réelles. Les tests unitaires utilisent également des clients SQL simulés ; seuls les essais sur la vraie base valident l’intégration complète.


## Mise à jour applicative (migrations 0021–0027)

Pour un déploiement Docker Compose existant, conservez le volume PostgreSQL et exécutez une mise à jour normale :

```bash
docker compose build app migrate
docker compose up -d
```

Le service `migrate` applique les migrations manquantes jusqu’à `0027_indexes_performance_operational` (après `0026_mobil_gardes_24h_weekends_feries`) puis met à jour les droits du rôle `fann_app`. Vérifiez ensuite `/readyz`, connectez-vous comme administrateur et contrôlez l'accès à **Messages** et **Sauvegarde en ligne**. Ne supprimez jamais le volume PostgreSQL pour forcer une migration. Avant production, prenez une sauvegarde chiffrée et testez sa restauration.
