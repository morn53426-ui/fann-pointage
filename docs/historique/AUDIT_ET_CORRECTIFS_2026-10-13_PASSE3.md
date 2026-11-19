> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

> **Note de version — 14 octobre 2026 :** ce rapport décrit l’état observé le 13 octobre 2026. Une révision ultérieure raccorde désormais les routes de pointage, planning, badges, QR, historique, anomalies, tableau de bord et classement au dépôt PostgreSQL et applique les contrôles de rôle côté serveur. Voir `docs/AUDIT_CORRECTIFS_OPERATIONS_POSTGRES_2026-10-14.md`. Ces nouvelles routes restent à valider sur une vraie instance PostgreSQL ; cette note ne vaut pas certification de production.

# Audit et correctifs — passe 3 (13 octobre 2026) — version 0.2.0-preproduction.14

Cette passe reprend l'archive « CORRECTIFS-AUDIT » et la soumet à une revue du code **et à une exécution réelle sur PostgreSQL 16**, ce que les passes précédentes n'avaient pas pu faire (pas de Docker dans leur environnement).

## Ce qui a été vérifié (état de départ)

| Contrôle | Résultat |
|---|---|
| `tsc --noEmit` | OK, 0 erreur |
| `npm test` (Node 22.22) | 258/258 avant correctifs, **259/259 après** |
| Migrations 0001 → 0013 + seed + `grant-runtime-role.sql` sur un vrai PostgreSQL 16 | OK ; 54 agents et 20 services importés |
| Rôle runtime `fann_app` (NOSUPERUSER, sans BYPASSRLS) : création admin, login, CRUD agents/services, audit | OK |
| `supabase/tests/001_contraintes.sql` (chevauchements, gardes 24 h, indépendance des régimes…) | `TESTS SQL OK` |
| Parcours API réel : doublon de matricule → 409, nom de service en double (casse/espaces) → 409, archivage d'un service avec agents actifs → 409, changement de service deux fois le même jour, désactivation/réactivation, id invalide → 400, routes non migrées → 503, sans jeton → 401 | conformes |
| Lignes d'audit applicatives (`agent_modifie`, `service_cree`…) avec acteur et IP | présentes |
| Front : aucun `innerHTML`, tout passe par `textContent` | confirmé |

## Défauts trouvés et corrigés

1. **Contournement de la limitation de connexion via `X-Forwarded-For`** (`src/api/serveur.ts`). Avec `TRUST_PROXY=1`, le *premier* maillon était retenu, or c'est celui que le client fournit lui-même : en préfixant l'en-tête, un attaquant changeait d'« IP » à chaque tentative et contournait les limites par compte et par IP. On retient désormais le **dernier** maillon (celui ajouté par le proxy de confiance). Test mis à jour.
2. **Clé de limitation sensible à la casse** (`src/api/routes.ts`). `admin`, `ADMIN` et ` Admin` comptaient comme trois comptes différents, ce qui multipliait les essais permis. La clé est normalisée (trim + minuscules). Nouveau test de non-régression.
3. **Erreur 500 sur chevauchement d'affectation** (`src/api/catalogue-postgres.ts`). Une violation de la contrainte d'exclusion (code `23P01`) remontait en erreur interne ; elle devient un 409 avec un message clair.
4. **Cache local non effacé à la déconnexion** (`web/app.js`). `fann-pointage-moi-cache` (identifiant, rôle, services) restait dans le navigateur sur un poste partagé. Il est supprimé à la déconnexion ; le cache du service worker passe en `v7`.
5. **Garde-fou du lanceur Windows inopérant** (`LANCER_FANN_POINTAGE.bat`). Il cherchait `REMPLACER_PAR_UN_SECRET` alors que `.env.example` utilise `replace_me_…` : un `.env` copié sans secrets passait. Il détecte maintenant les deux motifs.
6. **Compte admin à créer à la main sur base neuve**. `npm run admin:postgres -- admin --si-absent` est ajouté : il crée le compte s'il manque et ne touche jamais à un compte existant (mot de passe conservé, vérifié). Le lanceur Windows l'appelle automatiquement.
7. **`package-lock.json` absent** (point bloquant listé dans la passe précédente). Il est généré (18 paquets, tous en `registry.npmjs.org` avec empreintes d'intégrité). Le Dockerfile utilisera donc `npm ci` ; la CI GitHub aussi.

## Ce qui n'est PAS résolu (à lire avant tout usage réel)

- **Le pointage métier n'est toujours pas raccordé à PostgreSQL** : pointages, plannings, badges, absences, rapports et classements répondent `503 migration_metier_incomplete` dans le mode catalogue. **NO-GO pour le pointage officiel** ; GO limité à la gestion du registre agents/services.
- **Docker n'a pas pu être exercé ici** (pas de démon Docker). `docker compose up --build`, le `Dockerfile` et `npm run test:postgres` (tests de concurrence QR) restent à lancer sur le poste cible. L'initialisation de la base a été reproduite à la main dans le même ordre que l'entrypoint (rôle → migrations → seed → droits).
- Tests faits avec Node 22.22 ; la cible déclarée est 22.18+.
- Jeton de session sans état (8 h) : il n'y a pas de route de déconnexion côté serveur, la fin de session est locale. La désactivation d'un compte ou d'un agent révoque bien les jetons (`session_version`).
- Le limiteur de tentatives est en mémoire (une seule instance) et `scryptSync` bloque la boucle d'événements pendant le hachage : acceptable pour un LAN hospitalier à une instance, à revoir avant de monter en charge.
- Pas d'en-tête HSTS : à poser sur le reverse proxy HTTPS (volontairement non codé ici pour ne pas verrouiller un hôte servi en HTTP).
- En mode catalogue, un compte non administrateur reçoit un 403 *après* vérification de son mot de passe (confirme que les identifiants sont valides). Mineur, comportement conservé.
- Au démarrage, toute erreur sur `/api/moi` en mode catalogue renvoie à l'écran de connexion, même si elle est transitoire.

## Fichiers modifiés

`src/api/serveur.ts`, `src/api/routes.ts`, `src/api/catalogue-postgres.ts`, `src/api/creer-admin-postgres.ts`, `src/api/correctifs.test.ts`, `src/api/serveur.test.ts`, `web/app.js`, `web/sw.js`, `LANCER_FANN_POINTAGE.bat`, `.github/workflows/ci.yml`, `package.json`, `package-lock.json` (nouveau), `README.md`, `DEMARRER-ICI-WINDOWS.md`, ce rapport.
