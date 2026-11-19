> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Page de connexion et tests Playwright (14 octobre 2026)

## Page de connexion
- L'affiche FANN POINTAGE (inchangée) est à gauche du formulaire dès 761 px de large ; en dessous, elle passe au-dessus, pleine largeur.
- L'affiche n'est jamais rognée ni déformée (ratio 16:9 conservé, `width`/`height` déclarés).
- La mise en page est fluide (`clamp`, grille) et s'étend jusqu'à 1360 px sur grand écran.
- Formulaire : logo CHNUF, sous-titre, bouton Afficher/Masquer le mot de passe, bouton pleine largeur, mention d'accès réservé. Les champs `#identifiant` et `#mdp` et l'appel `POST /api/connexion` sont inchangés.
- Cache du service worker passé à `fann-pointage-v8`.

## Tests Playwright (`e2e/connexion.spec.mjs`)
Le serveur démarre seul en mode démonstration (port 4187, sans PostgreSQL ni donnée réelle).

```bash
npm install
npm run test:e2e:install   # une seule fois : télécharge Chromium
npm run test:e2e
```

14 tests : chargement de l'affiche, libellés et focus, Afficher/Masquer, identifiants invalides, connexion et déconnexion admin, serveur injoignable, et 7 tailles d'écran (1920 à 320 px) + zoom 200 % : pas de défilement horizontal, affiche à gauche ou au-dessus, ratio conservé, cibles tactiles de 44 px minimum. Des captures d'écran sont jointes au rapport.

## Badges professionnels (recto-verso)
- Format CR80 86 × 54 mm. Toutes les tailles sont en `cqw` (unités du conteneur) : mêmes proportions à l'écran, en PDF et à l'impression.
- Recto : bandeau vert avec logo et « Centre Hospitalier National Universitaire de Fann », photo cadrée, NOM en majuscules, prénom, service, matricule, pied « BRANCARDIER · BADGE PERSONNEL », liseré tricolore. Verso : identité, régime, QR encadré avec légende, mention « personnel et non transférable ».
- Le contenu du QR et la logique d'émission ne changent pas. Le filigrane « DÉMONSTRATION » reste sur les badges de démo.
- `e2e/badges.spec.mjs` : 9 tests (format, chargement du QR, absence de débordement, sélection, impression A4 à 86 × 54 mm avec recto puis verso et génération PDF, responsive).
