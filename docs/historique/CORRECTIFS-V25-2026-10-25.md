> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctifs v25 — règles de pointage par service (25 octobre 2026)

Demande : à l'hôpital on peut pointer avec son badge imprimé ou son matricule, au poste de pointage devant un superviseur, ou avec le QR affiché dans SON service. Le QR d'un autre service ne doit pas fonctionner. En rotation, plusieurs agents peuvent faire la même garde.

## Modifié
- **QR d'un autre service refusé** (`src/pointage/service.ts`) : un agent qui scanne le QR (temporaire ou permanent) d'une zone d'un autre service reçoit « QR d'un autre service… » (`qr_autre_service`), rien n'est enregistré, le QR temporaire n'est pas consommé, l'événement `qr_autre_service_refuse` est journalisé. Cela annule la règle v24 « zone d'un autre service acceptée » pour les QR de zone.
- **QR de son service** : la position doit être dans la zone du QR (plus de bascule vers une autre zone).
- **Badge imprimé ou matricule** : inchangé, valables partout dans l'hôpital (zone active de n'importe quel service), cas tracé `pointage_zone_autre_service`.
- **Poste de pointage** (`routes.ts`, `operations-postgres.ts`) : un responsable peut pointer un agent d'un autre service qui lui montre son badge ou donne son matricule. Journal : `agentAutreService`, `serviceAgent`. Auparavant : refus 403 hors de ses services.
- **Rotation** : aucun blocage existant (les chevauchements sont contrôlés par agent) ; test ajouté (3 agents, même garde, même service, arrivée et départ de chacun).
- Interface : libellé « QR affiché dans MON service » ; cache du service worker v32 ; `docs/POINTAGE.md` aligné.

## Vérifié
`tsc --noEmit` OK, 451 tests (450 OK, 1 ignoré : PostgreSQL réel). Tests ajoutés/modifiés : `service.test.ts`, `api.test.ts`, `operations-postgres.test.ts`.
Non recetté : PostgreSQL réel, téléphones. Redémarrer le serveur et rouvrir l'appli (cache).

## Points à valider
- Un responsable pointe désormais des agents hors de son service au poste de pointage (sans GPS, pointage « à vérifier » s'il n'y a pas de poste planifié). Si vous voulez le limiter à certains superviseurs, il faut un droit dédié.
- Un agent affecté à un service ne peut pas pointer par le QR d'un autre service, même pour y faire une garde ponctuelle : il utilise son badge ou son matricule.

## Audit du 25/10/2026 (après livraison)
- **Corrigé (P1)** : au poste de pointage, un responsable ne peut pointer un agent d'un autre service QUE par badge scanné. Le matricule seul (non secret, imprimé, souvent séquentiel) reste limité aux agents de ses services ; sinon un responsable aurait pu fabriquer la présence de n'importe quel agent de l'hôpital. Démo et PostgreSQL, avec tests.
- Vérifié : `npm audit` 0 vulnérabilité, `check:delivery:local` OK, `tsc` OK.

## Suite : ce qui restait (25/10/2026)
- **PostgreSQL réel (PostgreSQL 16)** : migrations 0001→0025 + seed rejouées sur une base neuve, `supabase/tests/001_contraintes.sql` : « TESTS SQL OK ».
  - **Bug de test corrigé** : le test SQL `TRUNCATE pointages` échouait depuis la migration 0025 (la table `anomalies_suivi` référence `pointages`, PostgreSQL contrôle la clé étrangère avant le déclencheur). Le test truncate maintenant les deux tables. Le banc Docker `npm run test:postgres` échouait donc à l'étape [1/4].
  - **Nouveau test d'intégration** `src/pointage/regles-service.integration.test.ts` (lancé avec `FANN_TEST_DATABASE_URL`) : rotation (deux agents, même garde, même service), QR permanent et temporaire d'un autre service refusés (rien d'enregistré, QR non consommé, événement d'audit), matricule accepté dans la zone d'un autre service (la base l'accepte), poste de pointage : badge accepté et tracé, matricule seul refusé pour un responsable hors de ses services. Résultat : OK.
- **Navigateur (Playwright, Chromium)** : 39 tests e2e OK.
- **Affiches QR** : avertissement affiché avant impression si l'adresse encodée est temporaire ou non sécurisée (ngrok et autres tunnels gratuits, localhost, réseau local, http). Cache du service worker : v33.
- **Reste hors de portée d'ici** : téléphones réels (précision GPS en intérieur, caméra iPhone), choix de l'adresse définitive, droit dédié pour les superviseurs de poste si vous le souhaitez.

## Correctif affiches QR : une affiche = une page A4
- L'avertissement « adresse temporaire » (ngrok…) était imprimé avec l'affiche et la faisait déborder sur une 2ᵉ page : il est désormais masqué à l'impression (`hors-impression`).
- Hauteur d'affiche fixée à 268 mm (au lieu de 277 mm) avec `overflow:hidden`, QR 100 mm, contenu centré : tient sur une seule page A4 même avec les en-têtes/pieds du navigateur (Safari iOS).
