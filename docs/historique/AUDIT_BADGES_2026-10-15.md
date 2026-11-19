> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Audit et évolution du badge — 15 octobre 2026

## Demandes traitées
| Demande | Réalisation |
|---|---|
| Recto : la **profession** à la place du nom du service | Le recto affiche la profession de l'agent (champ `profession`). Si elle n'est pas renseignée, « BRANCARDIER » est affiché (métier historique de l'application) : les badges existants restent corrects sans saisie. |
| Pied de page : « **AVEC SENDIMBEUL SARL** » à la place de « BRANCARDIER » | Fait. « BADGE PERSONNEL » reste à droite. |
| Verso : **nom, prénom, adresse, numéro** + **QR à côté** | Liste étiquetée (NOM, PRÉNOM, ADRESSE, TÉL., matricule) à gauche, QR à droite. Le régime et le service (informations internes) ne sont plus imprimés au verso. |
| Éléments **modifiables** | Bouton « Modifier le badge » : fenêtre avec nom, prénom, matricule, profession, adresse, téléphone et **aperçu recto-verso en direct**. Les mêmes champs existent à la création du badge. Remplace les anciens `prompt()` du navigateur. |

## Données et sécurité
- Migration `0016_badge_profession_contact` : 3 colonnes **facultatives** (aucune donnée existante touchée), contraintes de longueur et de format du téléphone. À appliquer : `npm run migrate:catalogue` puis `npm run db:configure-app-role`. L'application vérifie la migration au démarrage et dans `/readyz`.
- Validation **côté serveur** (modes PostgreSQL et démonstration) : profession ≤ 60, adresse ≤ 160 (l'interface limite à 100 pour tenir sur le badge), téléphone 3–30 caractères (chiffres, `+ ( ) . / - espace`). Caractères de contrôle supprimés. Valeur vide = champ effacé ; champ absent = inchangé (un changement de photo n'efface donc rien).
- Rendu : tout passe par `textContent` (aucun HTML injecté). Textes ≥ 6 pt à l'impression (test automatique), texte long tronqué proprement par des points de suspension (adresse : 4 lignes) sans jamais déborder.
- En mode PostgreSQL, la liste des badges (avec adresse et téléphone) reste réservée à l'**administrateur**. En mode démonstration (non destiné à la production), les responsables voient les badges de leur périmètre.

## Défauts constatés pendant l'audit
| Gravité | Constat | Action |
|---|---|---|
| Moyenne | `.env.example` **absent de l'archive** reçue (déjà signalé dans les audits précédents) ; un test échouait (`ENOENT`) | Fichier recréé (sans secret, valeurs `replace_me_…`) |
| Moyenne | Le journal d'audit des agents stockait l'**image base64 de la photo** (jusqu'à 110 Ko) à chaque création/modification | La photo est remplacée par `"photo": true/false` dans `journal_audit` (test ajouté) |
| Faible | Cache du service worker | Version passée à `v12` pour rafraîchir les postes déjà installés |

## Vérifications
- `npm test` et `tsc --noEmit` : voir le résultat final dans le message de livraison.
- Playwright (Chromium) : création d'un agent par le formulaire, édition avec aperçu, validation du téléphone, impression A4 (86 × 54 mm, recto puis verso), 6 pt minimum, pas de débordement, responsive.
- Contrôle visuel du badge avec des données normales et extrêmes (nom composé, profession longue, adresse longue, deux numéros).

## Non vérifié ici
- La migration 0016 et les requêtes SQL n'ont **pas** été exécutées sur une vraie base PostgreSQL (pas de PostgreSQL/Docker dans cet environnement) : tests avec clients simulés et relecture du SQL. Lancez `npm run test:postgres` ou une recette sur la base réelle avant la production.
- Impression sur imprimante à badges réelle : à valider sur le matériel du CHNU Fann (format 86 × 54 mm).
- Les points « reste à faire » de `AUDIT_2026-10-15.md` (scrypt, limiteur de tentatives persistant, secrets à régénérer) restent d'actualité.


## Correctif v15 mobile — écran blanc et impression (19 octobre 2026)

- **Cause de l'écran blanc confirmée dans le code** : `vueBadges()` passait `statutImpression` à la construction de la liste avant que la variable déclarée avec `const` soit initialisée. Cela déclenchait une `ReferenceError` dès l'ouverture de la vue. La déclaration a été déplacée avant le premier usage.
- **Résilience UI** : `naviguer()` affiche maintenant un message d'erreur lisible si une vue lève une exception pendant son rendu, au lieu de laisser le contenu principal vide. L'erreur technique reste disponible dans la console.
- **Session hors ligne** : le profil de session en cache n'est plus réutilisé lorsque `/healthz` n'a pas confirmé explicitement le mode démo. Dans ce cas, le jeton et le profil en cache sont effacés et l'écran de connexion est présenté. La file de pointages en attente dans IndexedDB n'est pas supprimée.
- **PWA** : version du cache du service worker incrémentée de `v19` à `v20` pour forcer le téléchargement des fichiers web corrigés.
- **Tests ajoutés/renforcés** : la recette Playwright des badges échoue désormais explicitement en cas d'erreur JavaScript lors de l'ouverture de la vue ; un scénario valide aussi qu'un mode serveur inconnu ne réutilise pas un profil privilégié périmé. Le scénario PDF existant contrôle toujours deux pages pour un badge (recto puis verso) et vérifie la taille du PDF.

La recette Playwright, le test PostgreSQL réel et l'impression sur une imprimante physique doivent encore être exécutés dans l'environnement de déploiement avant la production.
