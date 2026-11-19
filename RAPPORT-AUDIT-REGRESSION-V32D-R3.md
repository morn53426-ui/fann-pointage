# Audit de régression et de mise en page — FANN POINTAGE v32d r3

Date : 9 novembre 2026

## Défauts repérés et corrigés pendant ce second audit

1. **Actions du registre sur ordinateur** : les boutons « Modifier » et « Supprimer / archiver » étaient rendus sans espacement parce que leur conteneur `catalogue-actions` ne réutilisait pas la classe générique `actions`. Une règle dédiée ajoute désormais un espacement constant de 8 px sur les écrans larges ; le mode en grille reste actif sur les écrans étroits.
2. **Libellés des listes de régimes** : plusieurs choix étaient tronqués dans les listes déroulantes à largeur moyenne. Les libellés visibles ont été raccourcis sans changer les valeurs envoyées à l'API (`general`, `garde`, `urgences`, `mobil`) ; les précisions horaires complètes restent dans les attributs `title` des choix.
3. **Sélecteurs sur tablette paysage / fenêtre moyenne** : les champs de sélection du service et du régime occupent maintenant toute la ligne à l'intérieur de chaque formulaire. Les champs nom/prénom et matricule gardent leur grille à deux colonnes lorsque la largeur le permet.
4. **Cache PWA** : la version est incrémentée à `fann-pointage-v47` afin que les navigateurs récupèrent le CSS et les libellés actualisés.

Aucune route API, requête SQL, migration, donnée, permission ou règle de calcul des plannings/pointages n'a été modifiée. Les événements de formulaire, valeurs de régime et handlers de modification/archivage ont été conservés.

## Vérifications réalisées

- **Chromium responsive** avec une maquette de test reprenant les structures HTML réellement utilisées par le registre et l'émargement : 320, 375, 390, 430, 768, 801, 900, 1 024 et 1 440 px.
- `document.documentElement.scrollWidth` reste égal à la largeur de fenêtre aux 9 formats testés ; pas de débordement horizontal global.
- Jusqu'à 800 px : formulaires empilés, champs sur une colonne, actions sous forme de grille.
- À partir de 801 px : formulaires en deux cartes, sélecteurs de service/régime en pleine largeur et actions en flex avec espacement.
- CSS analysé avec PostCSS : **585 règles**, aucune erreur de syntaxe.
- Tous les fichiers JavaScript et MJS de `web/` passent `node --check`.
- Tests responsivité dédiés : **8 réussis, 0 échec**.
- Suite globale Node : **522 tests détectés, 520 réussis, 2 bloqués au chargement** car le paquet `pg` est incomplet/non installé dans l'environnement de contrôle. Les deux tests concernés sont `src/api/compteurs-postgres.integration.test.ts` et `src/pointage/regles-service.integration.test.ts`.

## Limites — validation encore nécessaire avant production

- L'installation des dépendances (`npm ci`) n'a pas abouti dans l'environnement de contrôle ; `node_modules` était donc incomplet. Le contrôle TypeScript et les deux tests PostgreSQL d'intégration ne sont pas considérés comme validés.
- Le runtime de contrôle est Node.js 22.16.0 alors que `package.json` exige Node.js >= 22.23.4.
- Les aperçus Chromium utilisent une maquette qui reproduit les structures du registre/émargement ; ils ne remplacent pas une recette complète sur l'application connectée à PostgreSQL, avec les vrais comptes/rôles et données.
- Impression réelle des badges/PDF, caméra/QR, notifications, synchronisation hors ligne et affichage iOS/Android physiques restent à tester sur les appareils ciblés.

## Consigne de déploiement

Ne pas écraser la version actuellement en service sans sauvegarde de la base et du dossier applicatif. Déployer d'abord en préproduction, vider/actualiser le cache PWA (la version v47 doit déclencher le renouvellement), tester les rôles, les opérations d'ajout/modification/archivage et les impressions, puis seulement valider la mise en production.
