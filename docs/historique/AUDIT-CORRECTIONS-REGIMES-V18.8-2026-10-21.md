> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Audit et correctifs — FANN POINTAGE v18.8 (rapport historique)

> Ce rapport décrit l’état v18.8. Un audit de suivi a trouvé un correctif supplémentaire dans le chemin PostgreSQL ; consulter `AUDIT-REGRESSION-V18.9-2026-10-21.md` pour les constats et vérifications de la version courante.

Date : 21 octobre 2026

## Changements réalisés

### 1. Service général
- Horaire standard : 08 h–16 h, du lundi au vendredi.
- Aucun poste généré le samedi, le dimanche ou un jour férié déclaré.
- Le serveur refuse aussi le déplacement manuel d'un poste général vers un samedi ou un dimanche : la règle ne repose donc pas uniquement sur l'interface.
- L'heure de fin anticipée déjà prévue (10 h à 16 h) reste disponible.
- Dans la voie de démonstration (`src/api/routes.ts`), suppression du remplacement redondant de `joursTravailles`. Le chemin PostgreSQL contenait encore un remplacement similaire ; ce résidu a été corrigé dans v18.9 et est documenté dans le rapport de suivi.

### 2. Gardes classiques
- La garde 08 h–08 h le lendemain reste une durée de 24 h.
- Les 48 h de repos sont conservées et contrôlées avant la prochaine garde.
- Les jours fériés et les week-ends ne suppriment pas les gardes classiques.

### 3. Équipe Mobil
- Équipe de jour : 08 h–16 h, du lundi au vendredi, hors jours fériés par défaut. Les exceptions déjà présentes restent explicites.
- Équipe de nuit : 16 h–08 h le lendemain, suivie de 56 h de repos. La prochaine prise est à 16 h, 72 h après le début de la précédente.
- Le formulaire de création d’agent propose maintenant le régime Mobil. Le régime par défaut du service sélectionné préremplit les nouvelles fiches, sans écraser le régime d’un agent existant.
- Le service Mobile utilise `mobil` comme régime par défaut.

### 4. Régimes par défaut du catalogue
Les services Kinésie, Imagerie, Psychiatrie, CDIM/SG, Morgue, Cardiologie médicale, Réa polyvalente et Chirurgie plastique sont définis avec le service général par défaut. Les services mixtes (Pneumologie, Maladies infectieuses, ORL, Gériatrie, Neurologie/Hospitalisation, CTCV, Neurochirurgie et Cardiologie médicale) continuent à accepter un régime individuel `general` ou `garde`. Le régime de chaque agent reste explicite ; la migration ne réécrit pas les affectations individuelles ni les plannings historiques.

### 5. Accueil des urgences
Aucune règle du moteur Urgences ni aucun cycle de son planning n’a été modifié. Les postes 08 h–20 h et 20 h–08 h, ainsi que les cycles et contrôles propres aux urgences, sont laissés indépendants.

### 6. Migration de base de données
La nouvelle migration `0020_regles_calendrier_services.sql` :
- fixe le défaut des jours travaillés du service général à lundi–vendredi ;
- ramène les configurations de sept jours à cinq jours uniquement lorsqu’elles correspondent exactement à l’ancien défaut ;
- met à jour les régimes par défaut listés, sans réécrire les affectations individuelles ou les plannings ;
- est appelée par `npm run migrate:catalogue` après la migration 0019 ;
- est vérifiée au démarrage de l’application PostgreSQL.

Pour un serveur existant, la migration doit être appliquée avec le mécanisme habituel de déploiement (`npm run migrate:catalogue` ou le service de migration Docker), puis la configuration habituelle du rôle runtime doit être vérifiée.

### 7. Régression de test corrigée
Deux assertions de `src/api/serveur.test.ts` attendaient encore `fann-pointage-v22`, alors que `web/sw.js` utilisait déjà `fann-pointage-v23`. Les assertions ont été alignées sur la version existante ; le service worker n’a pas été ramené à une ancienne version.

## Vérifications effectuées

- Tests automatisés Node : **370 réussis, 0 échec**.
- `node --check web/app.js` : OK.
- `node --check scripts/migrate-catalogue.mjs` : OK.
- `node scripts/check-delivery.mjs` : OK avant empaquetage ; contrôle de l’archive effectué après création.
- TypeScript strict avec `noUnusedLocals` et `noUnusedParameters` : OK en utilisant les types Node disponibles localement et une déclaration temporaire pour `pg`. Le registre npm n’était pas joignable (`EAI_AGAIN`), donc les vraies dépendances ne pouvaient pas être réinstallées pour le `npm run check` standard.
- La migration SQL n’a pas été exécutée sur un PostgreSQL vivant dans cet environnement ; son ordre et ses invariants sont couverts par les contrôles statiques, mais la recette sur la base de déploiement reste nécessaire.

## Limites de nettoyage du code

Les déclarations locales/imports inutilisés contrôlables par TypeScript ne génèrent aucun avertissement avec les options `noUnusedLocals` et `noUnusedParameters`. Aucun module complet n’a été supprimé sur la seule base de son nom ou d’une absence de référence textuelle, pour éviter de supprimer des points d’entrée ou des fonctions appelées dynamiquement.
