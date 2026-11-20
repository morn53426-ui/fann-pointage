# Démarrer FANN POINTAGE sous Windows — registre réel des agents

## Version 0.2.0-preproduction.47 — branche de correction

Cette version utilise **PostgreSQL** pour le catalogue, les agents et services, le pointage QR et au poste partagé, les plannings, les jours fériés, les badges, les absences, les rapports, les classements, les anomalies, la messagerie et l’export métier. En mode `postgres-catalogue`, une route non raccordée est refusée : elle ne doit jamais basculer silencieusement vers des données de démonstration. Les 20 services de référence sont gérés par les migrations. Le registre nominatif de 54 références n'est pas inclus dans le dépôt ni importé automatiquement : son import initial, si autorisé, se fait séparément avec un fichier SQL privé (voir `docs/IMPORT_REGISTRE.md`).

**Statut : préproduction uniquement.** La PR #1 a été fusionnée dans `main`. Les corrections suivantes (#2 collision de base, #3 restauration chiffrée intégrale, #4 responsive) sont réunies sur `integration/preproduction-hardening` et attendent une CI combinée puis une revue avant intégration. Les runs #79, #91 et #97 ont validé séparément la CI standard, la restauration chiffrée sur PostgreSQL `tmpfs` et la matrice responsive. Cela ne remplace pas la recette d'une copie restaurée de la base, ni les tests HTTPS, caméra/GPS et impression sur les appareils du site. Consultez `docs/PREPARATION_PRODUCTION.md` avant tout pilote. Les rapports de `docs/historique/` sont historiques : ne les utilisez pas comme procédure d'installation.

### Points de sécurité à connaître

- **Mots de passe provisoires des agents : aléatoires par défaut.** Le code (8 caractères) est affiché **une seule fois** à l’administrateur : remettez-le à l’agent séparément du badge. Le mode « téléphone » n’existe plus que sur demande explicite (`FANN_MDP_PROVISOIRE=telephone`) et est refusé au démarrage si `FANN_ENV=production`.
- **Affiches QR permanentes : adresse contrôlée.** L’écran « QR de pointage » refuse de produire des affiches définitives pour une adresse en `http`, `localhost`, tunnel temporaire ou IP non routable (il ne produit alors que des affiches filigranées « TEST — NE PAS AFFICHER »). Une adresse du réseau interne en https (ex. `https://192.168.1.80`) demande une confirmation explicite.
- **Affiche perdue ou volée :** l’administrateur désactive la zone (écran « QR de pointage », section « Zones de pointage »), avec un motif ; l’action est journalisée.

## 1. Prérequis

- Node.js 22.23.4 ou supérieur.
- Docker Desktop installé et démarré.
- Le ZIP extrait dans un dossier accessible en écriture.

## 2. Vérifier le fichier `.env`

Dans Git Bash, depuis le dossier du projet :

```bash
npm install
```

Si **aucun** fichier `.env` n’existe, crée-le une seule fois :

```bash
npm run setup:env
```

Si `.env` existe déjà, **ne relance pas** `setup:env` et ne le supprime pas. Ouvre-le :

```bash
notepad .env
```

Vérifie que cette ligne est exactement :

```dotenv
FANN_MODE=postgres-catalogue
```

Ne partage pas `.env` : il contient les mots de passe et les secrets. Pour une configuration générée avec `npm run setup:env`, vérifie que `DATABASE_URL` utilise `fann_app`, que `DATABASE_ADMIN_URL` utilise `fann_admin`, et que les deux mots de passe sont différents. `POSTGRES_PASSWORD` ne doit jamais être utilisé par le serveur Node. Si ton `.env` provient d'une version antérieure, exécute avant Docker :

```bash
npm run setup:upgrade-runtime-role
```

Ce script crée une sauvegarde `.env.backup-runtime-role-*`, génère un secret runtime distinct et conserve l'ancienne chaîne en `DATABASE_ADMIN_URL` pour les migrations. Ne partage jamais les fichiers `.env*`.

## 3. Démarrer PostgreSQL et séparer le rôle runtime

```bash
docker compose up --build -d db
docker compose ps
```

Sur une **base existante** créée par une ancienne version, les scripts PostgreSQL d'initialisation ne se rejouent pas avec le volume déjà présent. Sur un volume existant, le service Compose `migrate` applique les migrations manquantes et configure automatiquement le rôle runtime `fann_app` avant le démarrage de l'application. La commande manuelle ci-dessous reste disponible pour une intervention contrôlée :

```bash
npm run db:configure-app-role
```

Sur un volume neuf, Docker crée `fann_app` et applique les droits après les migrations automatiquement.

Attends que le service `db` soit `healthy` :

```bash
docker compose logs --tail=80 db
```

## 4. Appliquer les migrations et, si autorisé, importer le registre

Les migrations de schéma sont séparées de l'import nominatif. La commande `npm run migrate:catalogue` applique les migrations `0013` à `0016`, vérifie l'ENUM Mobil `0017`, puis applique `0018` à `0027`. Elle crée/vérifie les 20 services de référence, mais **n'importe pas les 54 fiches nominatives** à elle seule. Le service Compose `migrate` exécute aussi la configuration des droits de `fann_app` avant le démarrage de l'application.

Vérifie les données sans rien modifier :

```bash
docker compose exec -T db psql -U fann_admin -d fann_pointage -c "SELECT count(*) AS agents_photo FROM agents WHERE source_ref LIKE 'FANN-PHOTO-%';"
docker compose exec -T db psql -U fann_admin -d fann_pointage -c "SELECT count(*) AS services FROM services WHERE actif;"
```

Selon l'environnement, le nombre de fiches du registre initial doit être `0` (aucun import nominatif effectué) ou `54` (import autorisé déjà appliqué). Un nombre partiel doit être examiné : ne supprime pas des lignes et ne relance pas un import à l'aveugle. Les services de référence attendus sont au nombre de 20.

Si l'établissement a autorisé l'import et qu'un fichier SQL privé validé est disponible, suis strictement `docs/IMPORT_REGISTRE.md` : sauvegarde préalable, base de recette isolée, prévisualisation avec `--preview-registre`, comparaison et approbation, puis application avec `--apply-registre`. Le fichier SQL et les identités ne doivent jamais être ajoutés au dépôt, aux journaux, à l'archive applicative ni aux tickets.

Les matricules absents de la source restent vides ; aucun matricule ne doit être inventé. Les régimes importés sont à faire valider par l'administration avant la création des plannings.

## 5. Créer ou utiliser le compte administrateur

Dans cette base, le compte `admin` a déjà été créé lors des essais antérieurs. **Ne relance pas la commande de création si le compte existe déjà.** Le mot de passe initial est la valeur `ADMIN_INITIAL_MOT_DE_PASSE` de `.env`.

`LANCER_FANN_POINTAGE.bat` crée ce compte automatiquement s'il est absent (jamais de modification d'un compte existant). À la main, sur une base neuve :

```bash
npm run admin:postgres -- admin --si-absent
```

Le mot de passe n’est pas affiché : consulte la valeur locale `ADMIN_INITIAL_MOT_DE_PASSE` dans `.env`.

## 6. Démarrer le catalogue PostgreSQL — sans données fictives

Après avoir appliqué la migration, lance :

```bash
docker compose up --build -d app
docker compose ps -a
docker compose logs --tail=80 app
npm run health
```

`npm run health` lit le port `APP_PORT` de ton `.env` (8788 si tu l’as changé) et doit afficher `OK 200` pour `/healthz` et `/readyz`. Ouvre ensuite `http://127.0.0.1:<APP_PORT>` (8787 par défaut) et connecte-toi avec `admin` et le mot de passe initial stocké dans `.env`.

Dans **Agents et services**, tu peux :

- ajouter et modifier une fiche agent (prénoms, nom, service, régime et matricule facultatif) ;
- archiver ou réactiver un agent ;
- ajouter et modifier un service, son régime par défaut, puis archiver ou réactiver ce service ;
- rechercher un agent et afficher l’état de chaque fiche.

Une suppression est une désactivation/archivage réversible : l’historique d’affectation et les éventuels pointages ne sont pas effacés.

## 7. Règles à confirmer avant la suite

Les en-têtes de services sont recopiés depuis les photos, et les personnes des sous-sections « SG » restent dans leur service avec le régime `general`. Les horaires/régimes qui ne sont pas explicitement annotés sur la liste papier ont été initialisés selon les règles métier connues et doivent être confirmés par l’administration avant de planifier des gardes.

Quelques graphies de la photo demandent confirmation auprès de la liste officielle, notamment « Déograccia », « Niabaly », « Diouf 1/2 » et les mentions entre parenthèses d’El Hadji Mamadou et Birane. Aucun matricule n’a été inventé.

## 8. Sauvegarde et limites

Ne lance pas `docker compose down -v` : cela supprimerait le volume PostgreSQL. Avant une migration de schéma en production, sauvegarde la base et teste une restauration.

Les flux métier décrits plus haut sont raccordés à PostgreSQL dans le code de cette version, mais la préproduction n'est pas une autorisation d'usage officiel. Avant tout usage réel, il faut restaurer une sauvegarde authentifiée sur un clone isolé, migrer ce clone jusqu'à `0027`, vérifier les rôles et les scénarios métier, puis valider HTTPS, caméra/GPS, impression et pilote avec l'établissement. La CI verte seule ne suffit pas.


## Dépendances et réseau Docker

Le Dockerfile ne copie plus `node_modules` depuis Windows. Il utilise `npm ci` si `package-lock.json` existe, sinon `npm install`, dans l'image. Le `package-lock.json` est maintenant fourni : conservez-le dans votre dépôt/ZIP pour des builds reproductibles. Le build a besoin d'accéder au registre npm lors de la première installation.

Si Docker échoue avant le build en téléchargeant `node:22.23.4-bookworm-slim` ou `postgres:17-alpine` avec `network is unreachable`, c'est un problème réseau Docker Desktop/IPv6, distinct du code et du registre npm. Réparez d'abord l'accès au Docker Hub/CloudFront. Ne supprimez ni `.env` ni le volume PostgreSQL.

## Mise à jour d'une base existante

Depuis la version 47, `docker compose up --build -d app` démarre automatiquement le service `migrate`, qui applique les migrations manquantes jusqu'à `0027` (avec vérification séparée de l'ENUM `0017`) puis configure les droits du rôle `fann_app`, **avant** l'application. Rien n'est supprimé par ce processus et il est rejouable. En cas de doute :

```bash
docker compose logs migrate
```

`npm run db:upgrade` reste disponible pour le faire à la main depuis l'hôte. Ne lancez jamais `docker compose down -v`.
