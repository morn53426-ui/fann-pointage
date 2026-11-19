> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

> **Note de version — 14 octobre 2026 :** ce rapport décrit l’état observé le 13 octobre 2026. Une révision ultérieure raccorde désormais les routes de pointage, planning, badges, QR, historique, anomalies, tableau de bord et classement au dépôt PostgreSQL et applique les contrôles de rôle côté serveur. Voir `docs/AUDIT_CORRECTIFS_OPERATIONS_POSTGRES_2026-10-14.md`. Ces nouvelles routes restent à valider sur une vraie instance PostgreSQL ; cette note ne vaut pas certification de production.

# Audit technique — FANN POINTAGE

**Date de l’audit :** 13 octobre 2026  
**Archive examinée :** `FANN-POINTAGE-CORRECTIF-BUILD-NPM-LOCAL-2026-10-13.zip`  
**Périmètre :** code TypeScript/Node.js, PWA, routes HTTP, authentification, Docker Compose, migrations SQL, scripts npm et tests livrés.

## 1. Verdict exécutif

**Décision : GO limité pour des essais locaux contrôlés ; NO-GO pour le pointage hospitalier officiel ou une mise en production.**

Cette version dispose d’une base technique sérieuse pour le registre des agents et des services : validation serveur, contrôles de rôle, mots de passe hachés, sessions révocables, requêtes SQL paramétrées, mutations transactionnelles et journalisées, et conteneur applicatif durci.

Mais le mode Docker par défaut, `postgres-catalogue`, n’active réellement que la gestion des agents et des services dans PostgreSQL. Les fonctions de pointage, plannings, badges, absences, rapports et classements ne sont pas encore raccordées au dépôt PostgreSQL et renvoient volontairement `503 migration_metier_incomplete`. Les tests HTTP bout en bout exécutés ici utilisent le stockage JSON de démonstration et ne valident donc pas le flux opérationnel PostgreSQL.

Aucun module ou endpoint de paiement n’a été identifié dans le code applicatif livré. Les tests existants vérifient également que plusieurs routes de paiement ne sont pas disponibles.

## 2. Résultats des vérifications exécutées

| Vérification | Résultat |
|---|---|
| `npm test` sur l’archive originale | **ÉCHEC : 254 réussis, 1 échec** |
| Cause de l’échec | `src/api/deploiement.test.ts` tente de lire `.env.example`, absent de l’archive originale (`ENOENT`) |
| `npm test` après restauration de `.env.example` dans la copie d’audit | **255/255 réussis** |
| `npm run test:security` | **83/83 réussis** |
| `npm run test:e2e:process` | **17 contrôles HTTP réussis**, mode démo/JSON uniquement |
| `npm run test:postgres:unit` | **6/6 réussis**, clients SQL simulés |
| `node --check web/app.js`, `web/sw.js`, `web/vendor/qrcode.js` | Réussis |
| `npm run typecheck` | **Non validé** : dépendances/types absents (`node:*`, `@types/node`, `pg`, `@types/pg`) |
| `npm install --no-audit --no-fund` | N’a pas abouti dans cet environnement ; délai dépassé et aucun `node_modules`/`package-lock.json` produit |
| Docker Compose et migrations PostgreSQL sur une vraie instance | **Non exécutés** : commande Docker indisponible dans l’environnement d’audit |

L’environnement d’audit utilisait Node.js **22.16.0**, alors que `package.json` déclare `>=22.18`. Les résultats des tests Node sont informatifs, mais le contrôle final doit être rejoué sur une version conforme et avec les dépendances installées.

## 3. Constatations classées par priorité

### P0 — Bloquant avant utilisation officielle : flux métier PostgreSQL incomplet

**État : confirmé, limite documentée par le projet.**

- `src/api/main-postgres-catalogue.ts` démarre le catalogue persistant et précise que seules les fonctions de gestion des agents et services sont ouvertes.
- `src/api/routes.ts` bloque les routes métier non migrées en renvoyant `503` pour éviter tout retour silencieux aux données fictives.
- Les scénarios `scripts/test-e2e-process.mjs` valident le mode démonstration/JSON, pas le fonctionnement complet avec une base réelle.

**Action requise :** raccorder l’authentification, le pointage, l’idempotence, les QR, les plannings, validations, absences, rapports et classements à des dépôts PostgreSQL transactionnels. Ajouter des tests d’intégration et de concurrence sur PostgreSQL réel avant toute utilisation avec les agents du CHNU Fann.

### P1 — Configuration manquante dans l’archive : `.env.example`

**État : confirmé et corrigé dans la copie d’audit jointe.**

Le test `src/api/deploiement.test.ts` lit ce fichier et vérifie les variables GPS, mais le ZIP original ne le contient pas. Cela fait échouer la suite de tests complète. La copie jointe réintroduit un modèle sans secrets réels ; après ce correctif, la suite passe à 255/255.

**Action restante :** conserver ce fichier modèle dans les prochaines archives. Pour des secrets locaux, préférer `npm run setup:env` et ne jamais déployer les valeurs de remplacement du modèle.

### P1 — Le compte PostgreSQL de l’application est un superutilisateur

**État : confirmé dans `compose.yaml`.**

L’application utilise `DATABASE_URL` construit avec `POSTGRES_USER`, et le même `POSTGRES_USER` est utilisé pour initialiser l’image PostgreSQL officielle. Cette image crée le rôle configuré via `POSTGRES_USER` avec les privilèges de superutilisateur. Les requêtes de l’application disposent donc de privilèges bien plus larges que nécessaire ; les règles RLS ne constituent pas une seconde barrière pour un superutilisateur.

Référence : documentation de l’image PostgreSQL officielle, section `POSTGRES_USER` : https://hub.docker.com/_/postgres

**Action requise :** séparer le rôle de migration/bootstrap du rôle d’exécution de l’application. Donner au compte runtime uniquement les droits requis et concevoir/tester l’utilisation de RLS ou d’une politique de privilèges équivalente, sans contourner cette protection par un superutilisateur.

### P1 — Installation et compilation non reproductibles à partir du ZIP nu

**État : confirmé.**

- Le ZIP ne contient pas `package-lock.json` ni `node_modules`.
- Le Dockerfile exécute `COPY node_modules ./node_modules` et ne résout pas lui-même les dépendances. Un build propre échoue si le dossier local `node_modules` n’a pas d’abord été créé.
- L’absence de lockfile rend les installations moins reproductibles ; la CI utilise `npm install` plutôt que `npm ci`.
- L’installation n’a pas pu être achevée dans l’environnement d’audit et le typecheck ne peut donc pas servir de validation du code dans cet état.

**Action requise :** générer et livrer `package-lock.json`, utiliser `npm ci` en CI, vérifier une installation propre sur Windows/Node.js 22.18+, puis valider le build Docker à partir d’une extraction neuve. Garder une stratégie hors-ligne si nécessaire, mais documenter clairement qu’elle exige un `node_modules` déjà préparé.

### P1 — Intégration PostgreSQL réelle non prouvée

**État : non vérifié, faute de Docker disponible.**

Les six tests du dépôt PostgreSQL utilisent des clients simulés. Le script `npm run test:postgres` est prévu pour appliquer les migrations, tester les contraintes, une course concurrente sur un QR et la persistance après redémarrage, mais ce banc n’a pas été exécuté.

**Action requise :** lancer `npm run test:postgres` dans un environnement Docker propre et conserver le rapport complet. Vérifier aussi la migration sur une base déjà initialisée, le redémarrage, les sauvegardes et une restauration dans une base isolée.

### P2 — Le healthcheck ne vérifie pas la disponibilité PostgreSQL

**État : confirmé.**

`/healthz` dans `src/api/serveur.ts` renvoie un statut `200` et le mode configuré sans tester la connexion à la base. L’application peut donc rester considérée saine par Docker alors que PostgreSQL n’est plus joignable.

**Action recommandée :** conserver `/healthz` comme sonde de vie et ajouter une sonde de disponibilité qui vérifie la base, ou faire exécuter un test de connexion borné dans le healthcheck adapté. Tester le scénario de perte puis de rétablissement de PostgreSQL.

### P2 — En-tête IP derrière proxy : hypothèse de configuration à sécuriser

**État : risque conditionnel confirmé dans `src/api/serveur.ts`.**

Quand `TRUST_PROXY=1`, `ipClient` choisit la première valeur de `X-Forwarded-For`. Si le proxy de confiance ajoute son adresse à une chaîne fournie par le client au lieu de remplacer cet en-tête, le client peut influencer l’IP retenue et contourner la limitation des tentatives.

**Action recommandée :** configurer le reverse proxy pour remplacer l’en-tête reçu par l’adresse client validée, ou analyser uniquement les sauts explicitement approuvés. Ajouter un test de falsification `X-Forwarded-For` avant d’activer ce paramètre.

### P2 — Documentation de livraison à consolider

Plusieurs sections de `docs/ETAT_LIVRAISON_SENIOR_2026-10-13.md` décrivent encore l’application comme entièrement en démonstration ou comme non branchée à PostgreSQL, alors que les passages suivants décrivent la phase `postgres-auth` et le catalogue PostgreSQL. Les constats de fond restent utiles, mais la décision de livraison et le périmètre actif gagneraient à figurer dans un seul résumé à jour.

**Action recommandée :** remplacer les anciens paragraphes de synthèse par un état unique : catalogue agents/services PostgreSQL disponible, toutes les autres fonctions métier non migrées et production interdite.

## 4. Points positifs constatés

- Les permissions sont vérifiées côté serveur et la portée des responsables est testée.
- Les mots de passe applicatifs sont hachés ; les sessions ont une durée et une version révocable.
- Les requêtes SQL examinées utilisent des paramètres, et les mutations agents/services ont des transactions avec journal d’audit.
- Le mode catalogue ne réutilise pas silencieusement les comptes/données fictifs et masque les vues non migrées dans l’interface.
- Le conteneur applicatif utilise un utilisateur non privilégié, un système de fichiers en lecture seule, un abandon des capacités et `no-new-privileges`.
- Le service worker n’enregistre pas les réponses `/api/` dans le cache.
- Les tests présents confirment l’absence de routes de paiement dans le périmètre applicatif examiné.

## 5. Plan de correction recommandé

1. Garder le correctif `.env.example` et rétablir une installation npm reproductible avec lockfile.
2. Séparer les rôles PostgreSQL de migration et d’exécution, puis définir les privilèges minimums.
3. Construire et tester la suite PostgreSQL réelle sous Docker ; corriger toute erreur de migration avant d’aller plus loin.
4. Migrer les fonctions métier restantes vers PostgreSQL en conservant le comportement existant par tests de non-régression.
5. Ajouter des tests de disponibilité de la base, de proxy/IP, de concurrence, de sauvegarde/restauration et rejouer CI, typecheck, tests et build depuis une extraction neuve.
6. N’autoriser la production qu’après validation officielle des régimes, affectations, règles GPS, comptes, droits et procédures de sauvegarde/restauration.

## 6. Limites de cet audit

Cet audit combine lecture statique et exécution des tests Node présents dans l’archive. Il ne constitue pas un audit de pénétration réseau, ne valide pas un déploiement hospitalier, et ne certifie pas les migrations SQL car aucune instance Docker/PostgreSQL réelle n’était disponible ici. Les noms et affectations initialement importés doivent être comparés à la liste officielle par l’administration avant toute exploitation.

## Suivi des correctifs — passe 2 (13 octobre 2026)

Une seconde passe corrige le compte de connexion runtime PostgreSQL, l'installation Docker dépendante de `node_modules`, et la sonde de disponibilité : voir [`SUIVI_CORRECTIFS_AUDIT_2026-10-13.md`](SUIVI_CORRECTIFS_AUDIT_2026-10-13.md). Après modifications, la suite Node est passée à 258/258 tests sur Node 22.16.0, mais Docker/PostgreSQL et le typecheck sur Node 22.18+ restent à exécuter. Le pointage métier complet demeure bloqué par conception en `503` et la décision de mise en production reste **NO-GO**.
