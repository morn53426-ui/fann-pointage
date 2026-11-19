> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# FANN POINTAGE v17 — 19 octobre 2026

## 1. Affichage « [object HTMLElement] » après un pointage (déjà livré en v16)
`h()` n'aplatissait qu'un niveau de tableau. Corrigé : `flat(Infinity)`.

## 2. Bouton « Lancer l'impression » sans effet sur téléphone
Cause probable : l'application est installée en mode `standalone` (manifest) ; sur téléphone, `window.print()` sur la vue courante ne réagit pas toujours.
Correctif : l'impression passe par une page dédiée `/imprimer.html` (nouvel onglet) avec un bouton « Imprimer / Enregistrer en PDF », un lien de retour et une aide (menu Partager → Imprimer). Utilisée pour les badges (avec repli sur `window.print()`) et pour les feuilles d'émargement.
Non vérifié sur un vrai téléphone : aucun navigateur n'était disponible pour le test.

## 3. Feuilles d'émargement par service (menu « Feuilles d'émargement »)
- Une feuille par service au format du registre papier : en-tête officiel, Arrivée / Descente par jour, « R » pour les repos, cases grisées pour les jours non travaillés, signatures Responsable / CSSI. Deux tableaux par page (lundi–jeudi, vendredi–dimanche), comme sur la feuille papier.
- Export Excel `.xlsx` (un onglet par service, ou le seul service choisi) : `GET /api/emargement?date=AAAA-MM-JJ&format=xlsx`. Classeur écrit sans dépendance (`src/rapports/xlsx.ts`).
- Aperçu JSON : `GET /api/emargement?date=AAAA-MM-JJ` (administrateur : tous les services ; responsable : ses services ; brancardier : refusé).
- Agents sans planning : cases grisées sans « R » (jamais présentés comme un repos) + panneau « Générer le planning » (groupes de garde A/B/C décalés d'un jour, équipe jour/nuit pour les urgences).
- Fichiers : `src/rapports/emargement.ts`, `src/rapports/xlsx.ts`, route dans `src/api/routes.ts`, vue dans `web/app.js`, `web/imprimer.html`, `web/imprimer.js`, styles dans `web/styles.css`.
- Cache du service worker : `fann-pointage-v22`.

## 4. Registre des 54 agents
Le fichier nominatif `registre-initial-fann.sql` est livré À PART (hors du projet, voir `docs/IMPORT_REGISTRE.md`). Il est généré depuis `Liste_brancardiers_FANN.xlsx`. Aperçu sans rien conserver :
`REGISTRE_INITIAL_SQL="/chemin/prive/registre-initial-fann.sql" npm run migrate:catalogue -- --preview-registre`
Application : même commande avec `--apply-registre`. Les agents importés n'ont pas de photo : à ajouter avant d'imprimer les badges.

## Points à valider avec l'établissement
- Régime « SG » (service général) : l'application planifie le service général 7 jours sur 7 hors jours fériés, alors que les feuilles papier montrent le week-end grisé (lundi–vendredi).
- Cardiologie médicale est importée en service général (SG 8 h–16 h) d'après la feuille papier ; la liste Excel ne porte pas la mention « SG » pour ce service.
- Les mentions « externe » / « hospitalisation » (CTCV, Neurologie) ne sont pas conservées sur les feuilles : le registre n'a pas de champ de sous-service.
- Équipe jour/nuit des 7 agents du SAU : à choisir dans le planning.

## Tests
`npm test` : 349 tests passent ; `npx tsc --noEmit` sans erreur. Fichiers de tests ajoutés : `src/rapports/emargement.test.ts`, `src/api/emargement-routes.test.ts`.
