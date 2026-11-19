> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctifs v21 — FANN POINTAGE 0.2.0-preproduction.26

Ce lot corrige les cinq défauts bloquants de l'audit de pré-production v20, plus deux points non bloquants (route inconnue, ciblage de la messagerie).

## 1. Mot de passe administrateur
- Règle unique dans `src/api/mot-de-passe.ts` : **administrateur = 9 caractères minimum** (un code de 9 chiffres reste accepté ; un mot de passe plus long ou généré aussi). Suites triviales refusées (`123456789`, `111111111`).
- Appliquée à la création d'un compte, à la réinitialisation par l'administrateur (selon le rôle du compte visé), au changement par l'utilisateur et au script `admin:postgres`.
- Responsables et agents : mot de passe provisoire posé par l'administrateur à 6 caractères minimum ; mot de passe choisi par la personne : 8 minimum.
- Les mots de passe administrateur **déjà existants** ne sont pas modifiés : la règle s'applique au prochain changement.

## 2. Compte agent automatique à la création du badge
- À la création de la fiche (formulaire « Badges »), si matricule (3 caractères minimum) et téléphone (6 chiffres minimum) sont renseignés : compte `brancardier` créé dans la même transaction. **Identifiant = matricule** (insensible à la casse), **mot de passe provisoire = téléphone en chiffres** (`+221 77 123 45 67` → `771234567`), changement obligatoire.
- À la connexion, le téléphone peut être saisi avec espaces, tirets ou indicatif.
- Sans téléphone, sans matricule, ou identifiant déjà pris : la fiche est créée quand même et la réponse indique pourquoi il n'y a pas de compte.
- Ajouter ou corriger le téléphone/matricule plus tard crée le compte s'il n'existe pas ; corriger le matricule met à jour l'identifiant.
- Agents déjà enregistrés : bouton **« Créer les comptes agents manquants »** (écran Comptes) ou `POST /api/comptes-agents`.
- Aucun mot de passe n'est renvoyé par l'API ni écrit dans le journal d'audit.

## 3. Changement de mot de passe
- `PATCH /api/moi` `{motDePasseActuel, nouveauMotDePasse}` : vérifie l'ancien, limite à 5 essais / 15 min, révoque toutes les sessions, renvoie un jeton neuf.
- Compte à mot de passe provisoire : **toute route sauf `/api/moi` et `/api/deconnexion` répond 403 `changement_mot_de_passe_requis`** ; l'interface affiche l'écran de changement obligatoire. Les mots de passe réinitialisés par l'administrateur (pour un autre compte) sont aussi provisoires.
- Menu « Mon mot de passe » pour un changement volontaire.

## 4. Journalisation des erreurs serveur
- Toute erreur 500 écrit une ligne `[ERREUR 500] ref=… MÉTHODE /chemin ip=… code=… : message | début de pile`. La réponse client contient la même `reference` (8 caractères). Jamais de corps de requête, d'en-têtes, de paramètres d'URL ni de jeton.
- Erreurs hors requête (`unhandledRejection`, `uncaughtException`) également journalisées ; l'erreur fatale ferme le serveur proprement (Docker redémarre).
- Consulter : `docker compose logs --tail=200 app | grep "ERREUR"`.

## 5. Retrait d'un message
- `DELETE /api/messages/:id` (administrateur) : archivage (`archive_le`), la ligne, les lectures et l'audit sont conservés. Idempotent ; 404 si inconnu ; 403 pour les autres rôles.
- Le message disparaît immédiatement des listes des destinataires et ne peut plus être marqué lu. `GET /api/messages?archives=1` (administrateur) l'affiche comme retiré. Bouton « Retirer ce message » + case « Afficher aussi les messages retirés ».

## Autres
- Route inexistante en mode PostgreSQL : 404 (plus 503).
- Ciblage de la messagerie : une seule définition SQL partagée (liste, lecture, vérification) et date de Dakar au lieu de `CURRENT_DATE`.
- Migration additive **0023** (colonne `doit_changer_mot_de_passe`, faux par défaut) ; `/readyz` exige désormais 10 migrations.
- Cache du service worker : `fann-pointage-v24`.

## Vérifications (Node 22.22, PostgreSQL 16)
- `npm ci`, `tsc --noEmit`, **400 tests** (19 nouveaux + 381 existants adaptés), `npm audit --omit=dev` : 0 vulnérabilité, `check-delivery` OK.
- Migrations 0001→0023 sur base vierge, 0023 rejouée sans erreur.
- `scripts/recette-v21.mjs` contre le serveur réel sur PostgreSQL : **13 étapes réussies** (admin faible refusé, création d'agents, comptes, blocage puis changement de mot de passe, message ciblé, isolation, retrait).
- Erreur 500 provoquée sur la vraie base : ligne de journal avec référence et code `42P01`.

## Non vérifié
Docker/Caddy et le kit VPS sur un vrai serveur ; interface web dans un navigateur réel (syntaxe contrôlée seulement, aucun test Playwright) ; iPhone/Android, caméra, GPS ; images PostgreSQL 17 / Node 22.18.

## Mise à jour d'une installation existante
Sauvegarde chiffrée d'abord, puis `docker compose build app migrate && docker compose up -d` (le service `migrate` applique 0023). Ensuite, en administrateur : écran Comptes → « Créer les comptes agents manquants », et communiquer aux agents : identifiant = matricule, mot de passe = numéro de téléphone.

## Compteurs (ajout)
Boutons dans l'en-tête : **Messages non lus** (agents et responsables) et **Anomalies (48 h)** (administrateur et responsables). Mise à jour à la connexion, à chaque changement d'écran, toutes les 30 s et au retour sur l'onglet ; le nombre s'affiche aussi dans le titre de l'onglet, le bouton clignote et le téléphone vibre quand un nouveau élément arrive. Cache du service worker : `fann-pointage-v25`.
