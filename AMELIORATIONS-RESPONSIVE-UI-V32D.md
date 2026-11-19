# Améliorations responsive et interface — v32d-r1

## Portée

Cette révision renforce l'interface du client web sans modifier les règles métier, les appels API, l'authentification, les droits, les données PostgreSQL ou les formats d'impression.

## Changements

- Harmonisation visuelle des pages authentifiées : palette bleu nuit / vert CHNUF, fonds neutres, cartes, titres et hiérarchie typographique.
- Formulaires : champs plus lisibles, états de focus visibles, tailles tactiles, gestion des cases à cocher et adaptation aux petits écrans.
- Navigation : meilleure lisibilité, état actif plus distinct, défilement horizontal tactile conservé pour les nombreux modules.
- Tableaux : en-têtes hiérarchisés, lignes plus lisibles, défilement horizontal local sur téléphone afin d'éviter le débordement global.
- Actions : boutons cohérents, états hover/focus/disabled et disposition en grille sur mobile.
- Mise en page adaptée aux écrans de téléphone (jusqu'à 320 px), tablettes et grands écrans.
- Respect de `prefers-reduced-motion`.
- Cache PWA incrémenté en `fann-pointage-v45` afin de renouveler les fichiers statiques après mise à jour.
- Métadonnées de page et couleur de thème alignées sur la nouvelle identité visuelle.

## Préservation

Les feuilles d'émargement et les badges gardent leurs règles `@media print`. Les styles ajoutés sont dans `@media screen` et ne redéfinissent pas les gabarits d'impression. Aucun traitement API ou schéma de base de données n'a été modifié.

## Validation à effectuer sur les appareils cibles

- Connexion puis vérification de chaque rôle (administrateur, responsable, brancardier).
- Affichage à 320, 375, 430, 768, 1024 et 1440 px.
- Vérification du menu horizontal, des formulaires, des tableaux longs, du scan caméra et des modales.
- Impression réelle d'un badge recto-verso et d'une feuille d'émargement depuis Chrome/Edge et Safari mobile.
- Contrôle final avec Lighthouse sur mobile et ordinateur ; les scores ne sont pas simulés ni annoncés sans exécution.


## Correctifs complémentaires — v32d-r2 (9 novembre 2026)

Les captures réelles sur téléphone ont mis en évidence des défauts qui subsistaient dans la première couche responsive. Cette révision les corrige :

- Les formulaires « Fiche agent » et « Service » s'empilent sous 800 px au lieu de rester côte à côte.
- Les champs du formulaire et de la feuille d'émargement passent sur une seule colonne sur les petits écrans ; les libellés ne se coupent plus au milieu des mots.
- Les listes « Agents enregistrés » et « Services enregistrés » se présentent sous forme de fiches verticales sur téléphone/tablette portrait, avec libellés visibles et boutons d'action larges. Les tableaux classiques restent en place sur ordinateur.
- Les actions « Modifier » et « Supprimer / archiver » ne sont plus comprimées dans une colonne de tableau trop étroite.
- Les sélecteurs de fichiers sont dimensionnés pour la largeur disponible.
- Cache PWA incrémenté de `fann-pointage-v45` à `fann-pointage-v46`.

La logique métier, les endpoints, les règles de pointage, les données PostgreSQL, les droits et les formats d'impression ne sont pas modifiés. La validation visuelle sur un iPhone physique et les tests multi-rôles en environnement réel restent nécessaires avant la mise en production.
