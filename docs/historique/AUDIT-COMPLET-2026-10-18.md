> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Audit complet — FANN POINTAGE 0.2.0-preproduction.18 (18/10/2026)

Périmètre : code `src/`, interface `web/`, migrations SQL, Docker/compose, scripts, tests, dépendances.
Méthode : lecture du code, `npm audit`, recherche de motifs dangereux, exécution de tous les tests exécutables hors Docker (typecheck, 323 tests unitaires, 95 tests de sécurité, e2e process) y compris avec l'horloge décalée sur les 7 jours de la semaine.
Non vérifié ici (à relancer sur la machine de recette) : Docker/PostgreSQL réels, Playwright, caméra et GPS sur téléphone.

## Corrigé dans cette version

| # | Gravité | Constat | Correction |
|---|---|---|---|
| 1 | Moyenne | Aucun délai explicite sur le serveur HTTP (connexions lentes type slowloris) | `headersTimeout` 15 s, `requestTimeout` 30 s, `keepAliveTimeout` 5 s, 50 en-têtes max + test |
| 2 | Moyenne | Démarrage sans compte administrateur : toute connexion répond « Identifiants invalides » sans explication | Avertissement explicite au démarrage avec la commande à lancer |
| 3 | Moyenne | Commandes `curl` et documentation sur le port 8787 en dur alors que `APP_PORT` pouvait valoir 8788 | `npm run health` lit `APP_PORT` ; README et guide Windows corrigés |
| 4 | Moyenne | Premier test Playwright en échec au démarrage à froid (60 s) | Préchauffage du serveur et de Chromium, délais adaptés |
| 5 | Moyenne | Régression des règles Urgences sur les données de démonstration (poste actif manquant certains jours) | Jeu de démonstration aligné sur aujourd'hui ; test e2e adapté ; vérifié sur 7 jours simulés |
| 6 | Fonctionnelle | Règles Urgences obsolètes (nuit : 12 h de repos, un poste par jour) | Nouvelle rotation : jour 36 h de repos, nuit 60 h, règle du vendredi (mardi 08 h), passages d'équipe dimanche → nuit et vendredi de nuit → dimanche de jour, tests, documentation, export du tableau |
| 7 | Moyenne | Vérificateur de repos : un départ tardif ne déclenchait pas de conflit quand le poste suivant suivait le calendrier théorique | Le repos est recalculé depuis la fin réelle du poste (test) |

## Points conformes (aucune action)

- Dépendances : une seule dépendance d'exécution (`pg`), `npm audit` : 0 vulnérabilité.
- SQL : toutes les valeurs utilisateur sont paramétrées ; les seules interpolations sont des fragments constants.
- Mots de passe : scrypt avec sel ; comparaison en temps constant ; hash factice pour les comptes inconnus (pas d'énumération par le temps de réponse).
- Sessions : jetons signés HMAC avec version de compte ; déconnexion et désactivation révoquent immédiatement ; 8 h (administrateur, responsable), 26 h (agent).
- Limitation des connexions : par compte + IP et par IP, mémoire bornée ; déblocage réservé à l'administrateur avec trace.
- Interface : aucun `innerHTML` ni `eval`, tout passe par `textContent` ; CSP stricte (`script-src 'self'`, `frame-ancestors 'none'`) ; jeton en `sessionStorage` ; service worker sans cache de l'API.
- Droits : brancardier, responsable (limité à ses services) et administrateur contrôlés côté serveur sur chaque route ; badges versionnés vérifiés par hash en base.
- Base : RLS activée sur chaque table (testé), fonctions `SECURITY DEFINER` avec `search_path` fixé, aucun `GRANT ALL` ni accès public, rôle applicatif distinct du rôle de migration.
- Docker : utilisateur non privilégié, système de fichiers en lecture seule, `cap_drop: ALL`, `no-new-privileges`, limites mémoire/processus, compte administrateur de la base jamais transmis au conteneur applicatif.
- Exports CSV : neutralisation des formules (`=`, `+`, `-`, `@`).

## Risques restants (décision ou action de votre part)

| Gravité | Risque | Recommandation |
|---|---|---|
| Haute (avant mise en service) | Le mot de passe administrateur actuel est un mot de passe d'exemple, affiché dans une conversation | Générer un mot de passe aléatoire : `node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"`, le mettre dans `.env`, puis `npm run admin:postgres -- admin --reinitialiser-mot-de-passe` |
| Haute | Règles Urgences validées : l'équipe de nuit se vide (tout agent de nuit passe en jour après un vendredi et n'y revient pas) ; repos de 24 h lors des passages (voir `docs/REGIMES.md`) | Réaffectation des agents vers la nuit par l'administration, ou variante `--apres-passage nuit` |
| Moyenne | Le limiteur de connexions est en mémoire et partagé par IP : derrière ngrok ou la passerelle Docker sans `TRUST_PROXY=1`, tous les utilisateurs partagent la même IP et 30 échecs bloquent tout le monde 15 min | Mettre l'application derrière le proxy HTTPS fourni (`compose.https.yaml`) avec `TRUST_PROXY=1` |
| Moyenne | Exécution en production avec `--experimental-strip-types` (fonction expérimentale de Node) | Compiler en JavaScript avant livraison finale |
| Moyenne | Registre des absences, rapports SQL et plannings PostgreSQL « à valider sur une vraie base de recette » (message de démarrage) | Recette sur la base réelle avant mise en service |
| Moyenne | Aucune authentification à deux facteurs ; mot de passe minimal de 14 caractères sans règle de complexité | Politique de mots de passe ou double authentification pour les comptes administrateur |
| Basse | Le profil (nom, rôle) est gardé en `localStorage` pour le mode hors ligne ; effacé à la déconnexion | Acceptable ; éviter les téléphones partagés sans déconnexion |
| Basse | Photos des agents stockées en base (JPEG ≤ 128 Ko) : donnée personnelle | Sauvegardes chiffrées (script fourni) et accès limité |
| Basse | Les builds Docker sont reconstruits à chaque lancement (3 à 4 min) | Ne reconstruire que si le code change (`docker compose up -d` sans `--build`) |
| Info | La caméra du téléphone exige HTTPS | Déjà géré par ngrok ou le proxy HTTPS |
