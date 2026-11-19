> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# FANN POINTAGE v18 (0.2.0-preproduction.20) — préparation à la production — 19 octobre 2026

Suite à l'audit approfondi de la v17. **Statut : préproduction.** Cette version est prête pour une recette sur site puis un pilote contrôlé ; elle n'autorise pas à elle seule la mise en production (voir `docs/PREPARATION_PRODUCTION.md`, section 5).

## 1. Test de sauvegarde (P1 — suite non verte)
Cause établie : le script `scripts/sauvegarde-postgres.sh` est bien `rwxr-xr-x` dans le ZIP v17 ; l'échec venait d'un extracteur qui ne préserve pas les modes Unix (0644). Or le script n'est jamais lancé directement : PowerShell et la documentation appellent `bash scripts/sauvegarde-postgres.sh`.
Correction (sans affaiblir le contrôle) : le test (`src/api/audit-correctifs.test.ts`) ne dépend plus du bit exécutable. Il vérifie désormais ce qui garantit l'exécution : shebang, fins de ligne **LF**, syntaxe valide (`bash -n`), contenu strict (pg_dump -Fc, pg_restore --list, écriture atomique, rétention). Nouveau `.gitattributes` : `*.sh`, `Dockerfile*`, `Caddyfile`, `*.sql` en LF. `scripts/check-delivery.mjs --archive` signale (sans bloquer) les scripts sans bit exécutable. Le test passe avec le fichier en 0644 **et** en 0755.

## 2. Contrôles rejoués (Node 22.22.0)
`npm ci` (0 vulnérabilité) · `npm run typecheck` · suite complète `npm test` (352 réussis, 0 échec) · `npm run test:security` · `npm run check:delivery` · `npm audit --omit=dev`. Résultats chiffrés dans `docs/PREPARATION_PRODUCTION.md`.

## 3. Recette sur PostgreSQL 16 réel (P1)
Base neuve, mise à niveau d'une base 0001→0012, 2ᵉ passage idempotent, contraintes SQL, rôle `fann_app` sans privilèges excessifs, application réelle connectée avec ce rôle, 55 contrôles fonctionnels (rôles, accès hors périmètre, doubles soumissions, sessions révoquées, verrouillage), persistance après redémarrage, sauvegarde puis restauration dans une base isolée avec effectifs identiques. Script rejouable : `npm run recette:api` (garde-fou `FANN_RECETTE_OK=1`, base de recette uniquement).

## 4. Routes 503 `migration_metier_incomplete` (P2)
Nouveau test `src/api/couverture-routes-postgres.test.ts` : tous les chemins `/api/…` du front (`web/app.js`) sont extraits et aucun ne doit tomber sur le garde-fou 503 ; vérifié par mutation (retirer une méthode du dépôt de comptes fait échouer le test). Les 503 restants sont des refus intentionnels de fonctions non raccordées. Aucun écran du front n'est concerné.

## 5. Limiteur en mémoire et proxy (P1)
Risque documenté avec procédure de supervision (`docs/PREPARATION_PRODUCTION.md` §7) : remise à zéro au redémarrage, **une seule instance `app`** (commentaire dans `compose.yaml` + test qui refuse `replicas`/`scale`), `X-Forwarded-For` lu seulement si `TRUST_PROXY=1` (dernier maillon, remplacé par Caddy), port applicatif jamais exposé avec le proxy. Pas de changement d'architecture : un limiteur partagé n'est justifié que pour une exposition hors réseau interne ou plusieurs instances.

## 6. Code mort
Retrait des imports/variables inutilisés du code applicatif (`routes.ts`, `operations-postgres.ts`, `catalogue-postgres.ts`) et de trois imports de tests ; `tsc --noEmit --noUnusedLocals` ne signale plus rien hors paramètres de fonctions (non modifiés pour ne pas changer les signatures). Aucune route ou fonction « atteignable » n'a été supprimée.

## 7. Documentation
README resynchronisé (résultats réellement reproduits, séparés des résultats historiques), version 0.2.0-preproduction.20 dans `package.json`, `package-lock.json`, README, `docs/DOCKER.md`.

## 8. Décisions et validations restantes pour vous
- **Mot de passe minimum : 6 caractères pour tous** (administrateur initial, responsables, brancardiers), à votre demande ; l'administrateur passait de 14 à 6.
- Docker complet, navigateurs mobile/desktop, caméra/GPS en HTTPS, impression réelle, confiance du certificat Caddy sur les appareils : voir la liste de `docs/PREPARATION_PRODUCTION.md` §5.
- Image PostgreSQL du projet : 17 ; la recette ici a utilisé la 16.
