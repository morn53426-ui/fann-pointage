> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctifs v22 — FANN POINTAGE 0.2.0-preproduction.27

Ce lot répond aux trois points moyens M1, M2, M3 de l'audit avant production de la v21 (le point M4, sauvegarde, est organisationnel : voir « Reste à faire »).

## M1 — Comptes agents « pré-activés »
- **Le mot de passe provisoire expire au bout de 7 jours** (compte agent créé avec le téléphone, ou mot de passe réinitialisé par l'administrateur). Passé ce délai, même avec le bon mot de passe : `403 mot_de_passe_provisoire_expire`, aucun jeton émis ; une session ouverte avant l'échéance ne peut plus rien faire (ni changer le mot de passe) sauf se déconnecter. L'administrateur réinitialise le mot de passe (nouveau délai de 7 jours).
- Migration additive **0024** : colonne `identifiants_application.provisoire_depuis` posée/effacée par un déclencheur (aucune requête applicative modifiée). Les comptes déjà provisoires au moment de la migration démarrent leur délai à cet instant.
- Journal d'audit : `connexion_provisoire_reussie` (première connexion avec le mot de passe provisoire) et `connexion_provisoire_expiree`.
- `GET /api/utilisateurs` (administrateur) renvoie `doitChangerMotDePasse` et `provisoireExpire` pour repérer les comptes jamais activés ou expirés.
- `/readyz` exige désormais 11 migrations et la colonne 0024.

## M2 — Mot de passe administrateur et attaque répartie
- Refusés (administrateur et mot de passe choisi par la personne) : moins de 4 caractères différents (`000000001`, `121212121`), liste de mots de passe courants, en plus des répétitions et suites déjà refusées. Longueur minimale inchangée (9).
- Plafond global **par compte** : 30 échecs / 15 min toutes adresses IP confondues → 429, en plus de 5 par IP + compte. Compromis : un tiers peut bloquer un compte pendant 15 min ; l'administrateur dispose de `POST /api/connexions/debloquer`.

## M3 — Script VPS
- `scripts/vps/02-generer-env.sh` applique la même règle que l'application (9 caractères minimum, 4 caractères différents) : l'erreur apparaît tout de suite, plus après le démarrage.

## Interface
Message dédié « mot de passe provisoire expiré » à la connexion ; déconnexion automatique si l'échéance tombe en cours de session. Cache du service worker : `fann-pointage-v26`.

## Vérifications (Node 22.22, PostgreSQL 16)
- `tsc --noEmit` ; **409 tests** (400 existants + 9 nouveaux) ; `node --check web/app.js` ; `bash -n` du script VPS.
- Base PostgreSQL réelle : 0001→0023 puis 0024 par le runner sur une base « v21 » contenant un compte provisoire et un compte définitif → seul le provisoire reçoit une date ; rejeu sans erreur.
- Serveur réel : `recette-v21.mjs` 13/13 ; compte créé → date posée ; date reculée de 8 jours → 403 sans jeton + ligne d'audit ; liste administrateur correcte ; réinitialisation → date rafraîchie, connexion possible ; changement de mot de passe → date effacée ; 31 échecs → 429.

## Non vérifié
Docker/Caddy/scripts VPS sur un vrai serveur ; exécution de `02-generer-env.sh` (syntaxe contrôlée seulement) ; téléphones réels ; restauration d'une sauvegarde réelle.

## Reste à faire avant la production (hors code)
1. **Ne créer / communiquer les comptes agents qu'à la remise du badge** (le délai de 7 jours limite l'exposition, il ne l'annule pas : le téléphone est imprimé au verso du badge).
2. **Sauvegarde (M4)** : destination distante, clé de chiffrement copiée hors serveur, test de restauration d'une archive réelle.
3. Importer le registre réel (le serveur affiche « 0/54 » tant qu'il ne l'est pas) et vérifier que `/api/rapports` n'expose à un agent que ses propres données.

## Mise à jour d'une installation v21
Sauvegarde chiffrée d'abord, puis `docker compose build app migrate && docker compose up -d` (le service `migrate` applique 0024). Les comptes agents encore jamais activés ont 7 jours à compter de cette mise à jour.

## Signal sonore, vibration et notification sur l'écran « Pointage » de l'agent
- `web/app.js` (`vuePointage`) : bip + vibration à la lecture du QR/badge par la caméra ; au résultat, signal (ok / à vérifier / refusé) et notification système ; signal « ko » si saisie manquante ou erreur réseau.
- Case « Bip et vibration à chaque pointage » et bouton « Activer les notifications » (même module `signal-station.js`, réglage mémorisé sur l'appareil).
- Test statique ajouté dans `src/api/signal-station.test.ts`. Non testé sur un vrai téléphone : vibration et notification dépendent du navigateur (Android Chrome oui ; iOS exige la PWA installée).

### Suite de l'audit (signal agent)
- `signal-station.js` : option `arrierePlanSeulement` ; l'écran agent n'envoie la notification système que si la page est masquée (bip et vibration conservés). Le poste partagé est inchangé.
- Cache du service worker : `fann-pointage-v27`.
- Nouveau test Playwright `e2e/signal-agent.spec.mjs` (compte `agent-n1`) + test unitaire.
- Défaut corrigé : l'en-tête (logo, titre, compteurs, Déconnexion) mesurait environ 490 px et faisait déborder TOUTES les pages sur téléphone (cause des 2 tests « pas de défilement horizontal » de `e2e/badges.spec.mjs`). `web/styles.css` : l'en-tête passe à la ligne sous 560 px.
- Nouveau test `e2e/responsive-entete.spec.mjs` : aucun débordement horizontal à 320 et 390 px (admin : tableau de bord, anomalies, badges ; agent : pointage).
