# Correctifs v32 (0.2.0-preproduction.44) — suite à l'audit v31 du 28/10/2026

| Constat | Correction | Fichiers |
|---|---|---|
| F-01 QR permanents imprimables avec une URL non sûre | `evaluerOrigineQr` classe l'adresse (production / interne / test / invalide), IPv4 et IPv6 inclus. Production : impression normale. Interne (IP privée, `.local`) en https : confirmation à cocher. Test (http, localhost, tunnels, IP non routable ou publique brute) : seules des affiches filigranées « TEST — NE PAS AFFICHER » sont produites. | `web/origine-qr.js`, `web/app.js`, `web/styles.css`, `web/sw.js`, `src/shared/origine-qr.test.ts` |
| F-02 Mot de passe provisoire prévisible | Défaut « aleatoire » (code, montré une seule fois). « telephone » seulement si explicite. `FANN_ENV=production` refuse le démarrage avec « telephone » ou une valeur inconnue. `compose.yaml`, `.env.example` et `init-env.mjs` alignés ; `compose.vps.yaml` fixe `FANN_ENV=production`. | `src/api/auth-postgres.ts`, `src/api/main-postgres-catalogue.ts`, `compose*.yaml`, `.env.example`, `scripts/init-env.mjs`, tests |
| F-03 Documentation contradictoire | 48 documents historiques déplacés dans `docs/historique/` avec bandeau ; `DEMARRER-ICI-WINDOWS.md`, `docs/DEPLOIEMENT.md`, `docs/REGIMES.md`, `docs/CONTRAT-POSTGRES.md`, `docs/ETAT_ACTUEL.md`, `docs/PREPARATION_PRODUCTION.md` et le README mis à jour. | `docs/`, `README.md` |
| F-05 Révocation d'affiche impossible | `PATCH /api/zones/:id` `{actif, motif}` : administrateur seul, motif ≥ 3 caractères, verrou de ligne, transaction, audit, idempotent. `GET /api/zones?inclureInactives=1` (administrateur). Section d'administration dans « QR de pointage ». Un scan sur zone inactive est déjà refusé (`zone_inactive`). | `src/api/operations-referentiel.ts`, `operations-postgres.ts`, `routes.ts`, `web/app.js` |
| F-06 Création de zone et audit non atomiques | Insertion + audit dans une même transaction (BEGIN/COMMIT, ROLLBACK si l'audit échoue). | `src/api/operations-referentiel.ts` |

## Non traité (hors du code ou décision métier)
- F-04 : recette PostgreSQL réelle, Docker, Playwright, essais téléphones/imprimante, `npm audit` — à exécuter sur une machine connectée (voir l'audit).
- F-07 : correspondance service-zone-coordonnées des 7 affiches à valider avec le CHNU Fann.
- F-08 : limiteur en mémoire — acceptable en mono-instance.
- F-09 : données imprimées sur le badge — décision de gouvernance.

## Limite connue de F-01
Le QR est construit dans le navigateur ; le serveur ne connaît pas l'adresse encodée et ne peut donc pas la refuser. Le contrôle est dans l'interface d'administration (et testé), pas dans l'API.
