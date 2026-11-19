> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Audit final — FANN POINTAGE PROFESSIONNEL v7

**Date de vérification :** 17 octobre 2026  
**Version de référence du projet :** `0.2.0-preproduction.18` (cohérente entre `package.json` et `package-lock.json`)  
**Décision :** **NE PAS déclarer prêt pour la production** tant que les validations PostgreSQL, dépendances et navigateur de la section « Blocages avant préproduction » ne sont pas terminées.

## 1. Résumé exécutif

L’archive source contenait le fichier SQL de registre privé. Le dossier était exclu par certaines règles Docker/Git, mais restait distribué dans le ZIP et était monté dans le service de migration. Le script de migration pouvait en outre rejouer son contenu et remplacer des champs du registre métier.

Les routes de gestion des comptes renvoyaient une réponse `503 migration_metier_incomplete` en mode PostgreSQL car elles n’étaient pas admises par la liste de routes persistantes. Le dépôt d’authentification PostgreSQL contenait des opérations partielles, mais pas de liste de comptes ni de modification atomique complète permettant de brancher le contrat HTTP actuel.

Ces points ont été corrigés dans le code livré et couverts par des tests automatisés. Une erreur supplémentaire découverte par les tests a également été corrigée : l’appel de désactivation perdait le contexte `this` du dépôt et produisait une erreur interne. **316 tests automatisés ont été exécutés avec 316 réussites et zéro échec.** Cette réussite est celle du runner Node, pas une recette complète de préproduction : l’environnement disponible est sous la version minimale Node du projet, et ni Docker ni `psql` n’étaient disponibles.

Aucun contenu nominatif du registre privé n’est reproduit dans ce rapport ou dans l’archive de livraison.

## 2. Défauts constatés, causes racines et corrections

### P1 — Registre privé distribué

**Cause racine :** le fichier privé était présent dans la source compressée ; l’exclusion Docker/Git ne protégeait pas les archives ZIP. Le service de migration montait également le répertoire privé.

**Corrections :**
- retrait du registre SQL et du document de registre nominatif de l’arborescence livrée ;
- suppression du montage privé dans `compose.yaml` ;
- renforcement de `.gitignore` et `.dockerignore` pour les chemins nominatifs, fichiers d’environnement, sauvegardes et exports ;
- ajout de `scripts/check-delivery.mjs`, accessible par `npm run check:delivery`, pour refuser les chemins privés identifiés et rechercher des motifs de secrets dans le code et la livraison ;
- ajout du contrôle à la CI ;
- documentation d’un import initial distinct, depuis un fichier externe au dépôt, par une procédure d’aperçu puis d’application.

**Limite :** supprimer un fichier du répertoire courant n’efface pas ses occurrences éventuelles dans un historique Git distant, les anciennes archives ou les copies déjà partagées. Ces sources doivent être traitées séparément si elles ont été diffusées.

### P1 — Gestion des utilisateurs en mode PostgreSQL

**Cause racine :** les chemins `/api/utilisateurs` et `/api/utilisateurs/:id` n’étaient pas inclus dans le routage persistant ; le dépôt n’exposait pas toutes les opérations attendues par le frontend.

**Corrections :**
- ajout de la lecture des comptes dans le dépôt PostgreSQL ;
- raccordement de la liste, de la création, de la réinitialisation du mot de passe, de la réactivation et de la désactivation au dépôt persistant ;
- réponse HTTP sans empreinte de mot de passe ;
- validations serveur et contrôle d’accès administrateur côté routeur ;
- création et modification transactionnelles, journal d’audit, incrémentation de `session_version` pour invalider les anciennes sessions ;
- contrôle du dernier compte administrateur actif et contrôle de la fiche agent lors de la réactivation d’un compte brancardier ;
- gestion sécurisée des erreurs connues, sans renvoyer les détails SQL au client ;
- tests positifs et négatifs de routage, de droits, de création, de modification et de désactivation.

**Correction supplémentaire découverte en test :** l’appel de désactivation extrayait une méthode de l’objet de dépôt, puis l’appelait sans préserver son contexte. Le test recevait une erreur 500. Le contexte du dépôt est désormais préservé ; le scénario passe.

**Limite :** le raccordement a été testé contre un dépôt simulé. Il reste à confirmer sur un véritable PostgreSQL jetable que les requêtes, contraintes, verrous et migrations s’exécutent comme prévu.

### P1 — Import initial et migrations métier

**Cause racine :** la commande standard de migration pouvait charger le fichier privé et l’import utilisait des opérations de mise à jour conflictuelles susceptibles d’écraser les corrections manuelles.

**Corrections :**
- les migrations ordinaires n’importent plus de registre nominatif ;
- import autorisé uniquement par option explicite et chemin `REGISTRE_INITIAL_SQL` hors du dépôt ;
- séparation de `--preview-registre` et `--apply-registre` ;
- aperçu transactionnel annulé par `ROLLBACK` ;
- refus de SQL contenant des commandes destructives ciblées ou des données de registre partielles ;
- un import déjà complet n’est pas réexécuté ;
- les conflits de source deviennent `DO NOTHING` au lieu de réécrire les données existantes ;
- la migration de référence des services n’écrase plus le régime ni l’état existant d’un service portant déjà le même nom ;
- ajout de tests de non-régression sur ces garanties.

**Limite :** le script reste à tester sur une base PostgreSQL jetable avant usage sur une base de recette. Le filtrage de commandes SQL est une défense complémentaire, pas un substitut à la revue d’un fichier d’import de confiance et d’une sauvegarde restaurable.

### P2 — Versions et documentation

- `package.json` et `package-lock.json` concordent sur `0.2.0-preproduction.18`.
- le README indique désormais le résultat réel des tests de cette vérification et les validations non faites ;
- le guide Docker mentionne la version .18 et la plage complète des migrations 0013 à 0016 ;
- les anciens rapports datés indiquant .16 ou 277 tests restent des instantanés historiques, désormais explicitement identifiés comme tels ;
- une procédure sécurisée d’import initial a été ajoutée dans `docs/IMPORT_REGISTRE.md`.

## 3. Fichiers modifiés ou ajoutés

- `src/api/auth-postgres.ts` — listing des comptes, modification transactionnelle, révocation des sessions, audit et protection du dernier administrateur.
- `src/api/routes.ts` — raccordement PostgreSQL des routes utilisateurs, messages d’erreur sûrs et conservation du contexte du dépôt lors de la désactivation.
- `src/api/auth-postgres.test.ts` — tests du listing et de la protection du dernier administrateur.
- `src/api/routes-auth-postgres.test.ts` — tests HTTP de gestion de comptes persistants et contrôle des autorisations.
- `src/db/catalogue-import.test.ts` — non-régression sur l’absence de registre privé et le comportement de migration.
- `scripts/migrate-catalogue.mjs` — séparation entre migrations de schéma et import initial explicitement déclenché.
- `supabase/migrations/0013_catalogue_reel_agents_services.sql` — évite l’écrasement des services existants.
- `scripts/check-delivery.mjs` — nouveau contrôle des livrables et des motifs connus de secrets.
- `package.json` — commande `check:delivery`.
- `.github/workflows/ci.yml` — exécution du contrôle de livraison en CI.
- `.gitignore`, `.dockerignore`, `compose.yaml` — exclusions renforcées et retrait du volume privé.
- `README.md`, `docs/DOCKER.md`, `docs/ETAT_ACTUEL.md`, `docs/PHASE_AUTH_POSTGRES.md`, `docs/AUDIT_2026-10-15.md`, `docs/IMPORT_REGISTRE.md` et trois anciens rapports d’audit — nettoyage et/ou actualisation documentaire, sans contenu nominatif privé.

## 4. Tests et contrôles réellement exécutés

| Contrôle | Résultat constaté |
|---|---|
| Suite complète Node : `node --experimental-strip-types --test --test-concurrency=4 'src/**/*.test.ts'` | **316 réussis, 0 échec, 0 ignoré** |
| Sous-suite comptes/auth PostgreSQL et import catalogue | **24 réussis, 0 échec** |
| `node scripts/check-delivery.mjs` sur l’arborescence de livraison | Réussi |
| `node --check scripts/check-delivery.mjs` | Réussi |
| `node --check web/app.js` | Réussi |
| `node --check web/sw.js` | Réussi |
| `node --check web/vendor/qrcode.js` | Réussi |
| `node --check` sur les scripts `scripts/*.mjs` | Réussi |
| Cohérence de version `package.json` / `package-lock.json` | Réussi : .18 |

Les tests unitaires déjà présents couvrent notamment les permissions, les sessions, les QR, les doubles soumissions, des scénarios hors ligne en attente de validation, les règles de pointage, les plannings, les rapports et les exports. Ces tests restent des tests automatisés : ils ne remplacent pas des essais de caméra réels ou une base PostgreSQL intégrée.

## 5. Contrôles non exécutés ou bloqués

| Contrôle | Statut et raison |
|---|---|
| Installation propre `npm ci` | Non validée : l’installation tentée n’a pas terminé dans l’environnement disponible. |
| `npm run typecheck` | Non exécuté : `tsc` est absent, les dépendances ne sont pas installées complètement. |
| `npm audit --omit=dev` | Non exécuté : nécessite une installation exploitable et un accès aux métadonnées du registre npm. |
| Tests PostgreSQL réels (`npm run test:postgres`) | Bloqués : commande `docker` indisponible. `psql` est également absent. |
| Migrations sur base vide et base déjà peuplée | Non validées dans cette session, faute de PostgreSQL. |
| Concurrence et persistance après redémarrage d’une base réelle | Non validées ici ; le dépôt comprend un script de test PostgreSQL jetable prévu à cet effet. |
| Tests navigateur Playwright / visuels / responsive / caméra | Non exécutés dans cette session ; les dépendances/navigateurs nécessaires ne sont pas installés. |
| Sauvegarde et restauration PostgreSQL réelles | Non exécutées dans cette session. |
| Test de charge de production | Non exécuté ; aucun environnement de performance isolé disponible. |

L’environnement utilisé était Node.js `22.16.0`, inférieur au minimum déclaré du projet (`>=22.18`). Le succès des tests unitaires ne doit donc pas être interprété comme une validation du runtime de déploiement officiellement requis.

## 6. Risques résiduels et exigences avant préproduction

**Bloquants avant préproduction :**

1. Reproduire l’installation propre avec Node.js 22.18+ (`npm ci --no-audit --no-fund`), puis exécuter `npm run typecheck`, `npm test`, `npm audit --omit=dev` et les contrôles de syntaxe sur la machine de recette.
2. Exécuter `npm run test:postgres` sur Docker avec base jetable, contrôler les migrations 0013–0016 et tester la gestion des utilisateurs sur un PostgreSQL réel, y compris la désactivation concurrente du dernier administrateur.
3. Exécuter `npm run test:e2e` avec Chromium et vérifier manuellement les parcours de caméra/QR en HTTPS, les erreurs réseau et les tailles d’écran.
4. Démontrer une sauvegarde PostgreSQL restaurable sur une base isolée, sans manipuler la base réelle, et documenter la rétention/protection des sauvegardes.
5. Vérifier la configuration finale des secrets, HTTPS, droits du rôle applicatif, permissions administratives et paramètres GPS sur l’environnement de recette.

**Points de sécurité à examiner spécifiquement avant la production :**

- la limitation des tentatives de connexion si plusieurs instances d’API sont utilisées (le limiteur en mémoire ne partage pas son état entre processus) ;
- le profil de charge de la vérification synchrone des mots de passe avec `scrypt` sous concurrence élevée ;
- la politique d’expiration et de rotation des QR/badges avec les règles métier du site ;
- les restrictions de confidentialité et de durée de rétention pour les photos, exports et journaux ;
- l’intégralité du workflow d’audit de toutes les opérations sensibles, au-delà de la gestion des comptes corrigée ici ;
- la synchronisation hors ligne dans de vrais navigateurs après coupure, expiration de session et reprise de réseau.

Ces points ne sont pas déclarés corrigés simplement parce qu’un test unitaire existe ; ils nécessitent une validation dans l’environnement et avec les règles métier définitives.

## 7. Commandes de recette recommandées

Depuis la racine du projet, avec Node.js 22.18+, npm et Docker Desktop démarré :

```bash
npm ci --no-audit --no-fund
npm run check:delivery
npm run typecheck
npm test
npm audit --omit=dev
npm run test:postgres
npm run test:e2e
```

Pour PostgreSQL, le banc `test:postgres` utilise un projet Compose et des données jetables. Le registre privé ne doit pas être copié dans le projet : suivre `docs/IMPORT_REGISTRE.md`, viser une base de recette isolée, effectuer et vérifier une sauvegarde avant l’import. Pour la configuration de l’application, suivre `docs/DOCKER.md` et `DEMARRER-ICI-WINDOWS.md`. La création du premier administrateur ne doit s’effectuer qu’une fois sur une base neuve, via `npm run admin:postgres -- admin`, avec le mot de passe initial transmis de manière sûre depuis la configuration locale, jamais dans le code ou un ticket.

## 8. Conclusion

Les trois causes racines P1 confirmées — exposition du registre dans les livrables, routage incomplet de la gestion des utilisateurs vers PostgreSQL et réimport risquant d’écraser des corrections métier — ont reçu des corrections ciblées et des tests de non-régression. Le contrôle de livraison est opérationnel et la suite de tests disponible passe.

**Statut global : version corrigée prête pour une recette technique, mais pas encore déclarée prête pour la production.** La levée des blocages de validation ci-dessus est obligatoire avant utilisation comme registre officiel de présence.
