> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Intégration ciblée de l’affiche sur la page de connexion

Date : 13 octobre 2026

## Modifications limitées

- Ajout de l’affiche fournie par l’utilisateur à `web/images/fann-pointage-publicite.jpg` (JPEG d’origine, sans retouche).
- Dans `web/app.js`, `afficherConnexion()` place cette affiche dans un panneau à gauche du formulaire de connexion existant sur ordinateur. Le formulaire, les champs, l’autocomplete, le gestionnaire `onsubmit` et l’appel `POST /api/connexion` sont conservés.
- Dans `web/styles.css`, ajout des règles de la grille à deux colonnes et des points de rupture à 760 px et 380 px. Sur petit écran, l’affiche se positionne au-dessus avec une hauteur plafonnée.
- Dans `src/api/serveur.ts`, les extensions `.jpg` et `.jpeg` reçoivent le type MIME `image/jpeg`.
- Dans `web/sw.js`, l’image est ajoutée au cache initial et la version du cache passe à `fann-pointage-v6`, afin que la nouvelle ressource soit disponible dans la PWA.
- Dans `src/api/serveur.test.ts`, ajout de contrôles de présence de la ressource, des règles responsives, de la préservation du flux d’authentification et du type MIME JPEG.

Aucune route API, logique serveur d’authentification, schéma SQL ou table PostgreSQL n’a été modifié.

## Vérifications exécutées

- `npm test` : 254 tests réussis, 0 échec.
- `node --check web/app.js` : réussi.
- `node --check web/sw.js` : réussi.
- `node --check web/vendor/qrcode.js` : réussi.
- `node --experimental-strip-types --test src/api/serveur.test.ts` : 9 tests réussis, 0 échec.
- Le test HTTP récupère l’image et confirme `Content-Type: image/jpeg`.

## Limites de vérification

- Le projet ne définit pas de script `build` dans `package.json`; l’interface est servie comme fichiers statiques.
- `npm run typecheck` ne peut pas être validé dans l’environnement de préparation, car les paquets de développement / types Node et certains types du client PostgreSQL ne sont pas installés dans cet environnement.
- Une capture en navigateur headless a été tentée à deux tailles (ordinateur et mobile), mais Chromium n’a pas terminé dans l’environnement de préparation. La structure et les breakpoints ont été contrôlés dans le CSS et les tests automatisés, mais le rendu visuel réel doit encore être confirmé dans le navigateur de déploiement.

## Mise à jour du 15 octobre 2026
- L'affiche a été remplacée par la nouvelle version 16:9 (1672 × 941 px), au même emplacement `web/images/fann-pointage-publicite.jpg`, toujours à gauche du formulaire de connexion. Le formulaire et la logique de connexion sont inchangés.
- Ajustements liés uniquement au nouveau format : `width`/`height` de l'image, `aspect-ratio:16 / 9` dans `web/styles.css`, cache du service worker `fann-pointage-v11`, tests (largeur naturelle 1672, ratio 16:9).
