# Démarrer FANN POINTAGE sous Windows — registre réel des agents

## Ce que cette version permet (0.2.0-preproduction.44)

Cette version fonctionne sur un **catalogue persistant PostgreSQL** (54 fiches et 20 services importés). Les API de pointage (QR dynamique, badge sur poste partagé), plannings, jours fériés, badges, absences, rapports, classements, anomalies, messagerie et export métier sont **actives sur PostgreSQL** ; aucune donnée de démonstration n’est utilisée dans ce mode.

**Statut : préproduction.** Ce n’est pas encore autorisé en production hospitalière : la recette sur une vraie base, Docker, HTTPS, caméra/GPS sur les téléphones du site et l’impression réelle restent à valider (voir `docs/PREPARATION_PRODUCTION.md` et `docs/CHECKLIST_PILOTE.md`). Les anciens rapports d’audit et de correctifs sont rangés dans `docs/historique/` : **ne les suivez pas pour installer cette version**.

### Points de sécurité à connaître (v32)

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

Sur une **base existante** créée par une ancienne version, les scripts PostgreSQL d'initialisation ne se rejouent pas avec le volume déjà présent. Une fois `db` sain, crée/actualise le rôle runtime avec le compte administrateur conservé dans `.env` :

```bash
npm run db:configure-app-role
```

Sur un volume neuf, Docker crée `fann_app` et applique les droits après les migrations automatiquement.

Attends que le service `db` soit `healthy` :

```bash
docker compose logs --tail=80 db
```

## 4. Importer les 54 fiches sans effacer les données

Applique la migration du catalogue depuis le terminal Windows :

```bash
npm run migrate:catalogue
```

Résultat attendu : `Migration 0013 appliquée. Fiches de la liste photo présentes : 54/54.` Si la migration a été exécutée par le tout premier démarrage d’un volume neuf, le script peut signaler qu’elle est déjà appliquée. Ne supprime **jamais** le volume pour essayer de la relancer.

Vérification SQL non destructive :

```bash
docker compose exec -T db psql -U fann_admin -d fann_pointage -c "SELECT count(*) AS agents_photo FROM agents WHERE source_ref LIKE 'FANN-PHOTO-%';"
docker compose exec -T db psql -U fann_admin -d fann_pointage -c "SELECT nom, regime_defaut, actif FROM services ORDER BY nom;"
```

La première commande doit retourner `54`. Si tu as changé `POSTGRES_USER` ou `POSTGRES_DB`, remplace `fann_admin` et `fann_pointage` par les valeurs exactes de `.env`.

La migration conserve les matricules vides, car la liste papier n’en fournit pas. Les régimes importés sont des propositions initiales : vérifie-les service par service avant toute utilisation opérationnelle. Le numéro de liste ne devient pas un matricule officiel.

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

Cette version utilise PostgreSQL pour le catalogue, les modifications et le journal associé, mais n’a pas encore raccordé les pointages/plannings à cette base. N’utilise pas encore les classements ni les pointages comme registre officiel. Le passage en production exige encore une migration complète du flux de pointage, les tests sur vraie base, la restauration, les droits par rôle/service et le contrôle GPS en conditions réelles.


## Dépendances et réseau Docker

Le Dockerfile ne copie plus `node_modules` depuis Windows. Il utilise `npm ci` si `package-lock.json` existe, sinon `npm install`, dans l'image. Le `package-lock.json` est maintenant fourni : conservez-le dans votre dépôt/ZIP pour des builds reproductibles. Le build a besoin d'accéder au registre npm lors de la première installation.

Si Docker échoue avant le build en téléchargeant `node:22.23.4-bookworm-slim` ou `postgres:17-alpine` avec `network is unreachable`, c'est un problème réseau Docker Desktop/IPv6, distinct du code et du registre npm. Réparez d'abord l'accès au Docker Hub/CloudFront. Ne supprimez ni `.env` ni le volume PostgreSQL.

## Mise à jour d'une base existante

Depuis cette version, `docker compose up --build -d app` démarre automatiquement le service `migrate`, qui applique les migrations 0013 à 0016 manquantes puis les droits du rôle `fann_app`, **avant** l'application. Rien n'est supprimé et la commande est rejouable. En cas de doute :

```bash
docker compose logs migrate
```

`npm run db:upgrade` reste disponible pour le faire à la main depuis l'hôte. Ne lancez jamais `docker compose down -v`.
