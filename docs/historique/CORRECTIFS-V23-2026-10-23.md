> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctifs v23 — FANN POINTAGE 0.2.0-preproduction.28

Lot issu de l'audit du 23 octobre 2026 (archive v23-SIGNAL-AGENT).

## Appliqué
- **P0 — Node.js** : image Docker `node:22.23.4-bookworm-slim` (correctifs de sécurité du 21/10/2026, dont Brotli CVE-2026-111497) ; `engines.node >=22.23.4` (package.json et lockfile) ; CI GitHub sur 22.23.4 ; documentation et script `.bat` alignés ; test de déploiement mis à jour.
- **P2 — compose.yaml** : `pg_isready -h 127.0.0.1` (test TCP), 30 tentatives, délai de démarrage 30 s, comme `compose.vps.yaml`.
- **P2 — Documentation** : `docs/DOCKER.md` décrit les migrations jusqu'à 0024.
- **P2 — Versions** : package.json, lockfile et README alignés sur 0.2.0-preproduction.28 ; dossier racine renommé v23.

## Vérifié (Node 22.22.2)
`npm ci`, `tsc --noEmit` (OK), 411 tests (OK), `node --check web/app.js`.

## Non traité (décision requise)
- **P1 — mot de passe provisoire = téléphone** : conservé tel quel, car c'est l'exigence métier actuelle (expiration 7 jours + changement obligatoire déjà en place). Alternative : code aléatoire remis séparément.
- **P1 — politiques RLS `USING (true)`** : refonte à cadrer (périmètre par service/agent) avec tests PostgreSQL ; non modifiée à l'aveugle.
- Limiteur de tentatives en mémoire (instance unique), Docker/PostgreSQL réels et téléphones : à recetter.

## Lot 2 — compteurs, anomalies, retour du scan (0.2.0-preproduction.29)
Voir `docs/COMPTEURS_ET_SCAN.md`. Fichiers créés : `supabase/migrations/0025_anomalies_suivi.sql`, `web/compteurs.js`, `web/scan-pointage.js`, `docs/COMPTEURS_ET_SCAN.md`, `src/api/compteurs-scan.test.ts`, `src/api/compteurs-postgres.integration.test.ts`.
Fichiers modifiés : `src/api/operations-postgres.ts`, `src/api/routes.ts`, `src/api/main-postgres-catalogue.ts`, `scripts/migrate-catalogue.mjs`, `scripts/grant-runtime-role.sql`, `web/app.js`, `web/styles.css`, `web/sw.js`, `src/db/migrations.test.ts`, `src/api/serveur.test.ts`, `compose.yaml`, `compose.vps.yaml`, `docs/DOCKER.md`, `package.json`, `package-lock.json`, `README.md`.

## Lot 3 — banc de test PostgreSQL (machine lente)
`compose.postgres-test.yaml` : healthcheck en TCP (`pg_isready -h 127.0.0.1`), car le serveur temporaire d'initialisation n'écoute que sur un socket local et le conteneur était déclaré « Healthy » avant la fin des migrations. `scripts/test-postgres.mjs` : attend jusqu'à 60 s la fin de l'initialisation avant de la refaire lui-même.

## Lot 4 — doublon Messages/Anomalies
Les entrées « Messages » et « Anomalies » du menu sont masquées quand l'icône correspondante est affichée dans l'en-tête (le menu les garde sinon). L'icône de l'en-tête est mise en évidence sur la page courante. Cache du service worker : v29.

## Lot 5 — hachage asynchrone et code provisoire aléatoire (0.2.0-preproduction.30)
- **Hachage scrypt non bloquant** (`src/api/auth.ts`) : connexion, changement de mot de passe et création de comptes utilisent `scrypt` asynchrone, via une file à concurrence bornée (3 calculs simultanés, 64 en attente, au-delà HTTP 503 + `Retry-After`). Même algorithme et mêmes paramètres : les mots de passe existants restent valides. Les fonctions synchrones sont conservées pour les scripts (création de l'administrateur, démo).
- **Mot de passe provisoire aléatoire (optionnel)** : `FANN_MDP_PROVISOIRE=aleatoire` dans `.env`. Le serveur génère un code de 8 caractères (alphabet sans 0/O/1/I/L), montré une seule fois à l'administrateur (création de fiche, « Créer les comptes agents manquants », réactivation), jamais stocké en clair ni journalisé. Le téléphone n'est alors plus nécessaire. Défaut inchangé : `telephone`.
- Tests : `src/api/hachage-async.test.ts`, `src/api/code-provisoire.test.ts`.

## Lot 6 — contrôles en dossier de travail (0.2.0-preproduction.31)
- `npm run check:delivery:local` : contrôle de livraison qui ignore le `.env` local de la racine (le contrôle strict reste utilisé par la CI et pour l'archive : `node scripts/check-delivery.mjs --archive fichier.zip`). Le message d'échec explique la marche à suivre.
- `npm run audit:prod` : `npm audit` avec le registre officiel (les miroirs comme npmmirror n'implémentent pas l'audit).
