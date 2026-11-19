# Rapport de corrections responsive — FANN POINTAGE v32d-r2

> Ce rapport est complété et remplacé par `RAPPORT-AUDIT-REGRESSION-V32D-R3.md`, qui comprend un contrôle de régression supplémentaire et des résultats de tests mis à jour.

Date : 9 novembre 2026

## Problèmes constatés dans les captures

1. Les formulaires « Fiche agent » et « Service » restaient côte à côte sur téléphone. À environ 430 px de largeur CSS, chaque carte devenait trop étroite et les libellés/champs se coupaient.
2. Le registre des agents affichait un tableau de sept colonnes avec une largeur minimale de 640 px. Les colonnes de gauche étaient coupées sur téléphone et les boutons « Modifier » / « Supprimer / archiver » se retrouvaient comprimés.
3. Le formulaire des feuilles d'émargement conservait plusieurs colonnes sur téléphone, ce qui rapprochait ou faisait se chevaucher visuellement les champs Date et Service.
4. Une règle responsive tardive réintroduisait deux colonnes sur les largeurs intermédiaires (421–680 px), malgré une règle plus ancienne qui prévoyait une seule colonne.

## Correctifs appliqués

- Création d'une grille dédiée aux deux formulaires du registre : deux colonnes sur ordinateur, une seule colonne sous 800 px.
- Passage en une colonne des champs de formulaires, dont ceux des feuilles d'émargement, sous 800 px.
- Transformation des tableaux « Agents enregistrés » et « Services enregistrés » en fiches verticales sur téléphone et tablette portrait. Chaque valeur porte son libellé, les en-têtes restent présents pour l'accessibilité et les actions disposent de boutons à largeur utile.
- Conservation des tableaux à colonnes sur ordinateur, avec défilement local si nécessaire sans élargir la page entière.
- Ajustement des champs de sélection de fichier et des libellés longs.
- Cache PWA incrémenté à `fann-pointage-v46` pour forcer le renouvellement des ressources statiques.

Aucune règle métier, aucun endpoint API, aucune donnée PostgreSQL, aucun droit et aucune règle d'impression n'a été modifié.

## Vérifications exécutées

- Aperçu Chromium piloté par Playwright avec HTML représentatif des écrans du registre, aux largeurs 320, 375, 390, 430, 768, 1 024 et 1 440 px : `document.documentElement.scrollWidth` est resté égal à la largeur de la fenêtre pour chacun de ces formats.
- Sur les formats jusqu'à 768 px, les formulaires se présentent en une colonne et les lignes du registre en fiches ; à 1 024 et 1 440 px, les formulaires et tableaux retrouvent la disposition ordinateur.
- Formulaire d'émargement contrôlé séparément : un champ par ligne jusqu'à 768 px, sans débordement global.
- Analyse CSS : 355 règles analysées, 0 erreur de syntaxe.
- Syntaxe JavaScript contrôlée avec `node --check` pour `web/app.js`, `web/emargement.js` et `web/sw.js`.
- Suite Node exécutée : 520 tests détectés, 518 réussis et 2 tests PostgreSQL bloqués au chargement car le module `pg` était absent/incomplet (`src/api/compteurs-postgres.integration.test.ts` et `src/pointage/regles-service.integration.test.ts`). Ces deux tests ne sont pas une validation PostgreSQL.

## Limites à lever avant la production

- Les deux fichiers de tests d'intégration PostgreSQL (`src/api/compteurs-postgres.integration.test.ts` et `src/pointage/regles-service.integration.test.ts`) n'ont pas été inclus dans les 518 tests exécutés : ils nécessitent la dépendance `pg` installée et une base de test réelle fournie via `FANN_TEST_DATABASE_URL`.
- L'environnement de vérification utilise Node.js 22.16.0, alors que le projet demande Node.js >= 22.23.4. Il faut relancer l'installation et la recette complète avec la version Node déclarée dans `package.json`.
- Les aperçus Chromium valident les structures et les styles représentatifs ; ils ne remplacent pas la recette sur iPhone/iPad physiques, les différents rôles, ni l'impression réelle des badges et feuilles.
