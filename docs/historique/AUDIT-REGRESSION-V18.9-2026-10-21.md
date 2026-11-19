> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Audit de suivi et correctifs — FANN POINTAGE v18.9

Date : 21 octobre 2026  
Version projet : `0.2.0-preproduction.22`

## Synthèse

L’audit a été repris depuis une extraction propre de l’archive v18.8. Il a confirmé une régression que les tests v18.8 ne couvraient pas : la voie PostgreSQL ne suivait pas les mêmes règles de calendrier que la voie de démonstration pour le service général. Trois corrections sont maintenant intégrées et de nouveaux tests ont été ajoutés.

## Constats corrigés

### 1. Priorité élevée — la génération PostgreSQL planifiait aussi le week-end

**Cause :** `src/api/operations-postgres.ts` construisait la configuration générale en réinjectant explicitement `joursTravailles: [1,2,3,4,5,6,7]`. Cette valeur annulait `CONFIG_GENERAL_DEFAUT` et permettait de générer des postes le samedi et le dimanche.

**Correction :** le générateur PostgreSQL utilise désormais le calendrier par défaut centralisé, soit du lundi au vendredi, et continue d’exclure les jours fériés actifs.

**Test ajouté :** génération sur la semaine du 19 au 25 octobre 2026 avec le mercredi 21 déclaré férié ; seuls les postes du lundi, mardi, jeudi et vendredi sont créés.

### 2. Priorité élevée — modification manuelle PostgreSQL contournait la règle week-end

**Cause :** la route `PATCH /api/plannings/:id` refusait le samedi/dimanche dans le mode de démonstration, mais le chemin PostgreSQL ne contrôlait que le jour férié. Un responsable pouvait déplacer un poste général vers un samedi ou un dimanche ; un poste modifié n’était pas couvert par le même contrôle de calendrier.

**Correction :** le chemin PostgreSQL vérifie maintenant le jour ISO avant toute écriture et refuse un déplacement du service général au samedi ou au dimanche. Le contrôle des jours fériés est conservé.

**Tests ajoutés :** refus d’un déplacement vers le samedi 24 octobre et le dimanche 25 octobre 2026 ; aucun `UPDATE plannings` ne doit avoir lieu.

### 3. Priorité moyenne — précision horaire insuffisante lors d’une modification

**Cause :** la voie PostgreSQL ne vérifiait pas les secondes de l’heure de début. Les deux voies pouvaient aussi accepter des millisecondes lorsque la durée restait mathématiquement entière.

**Correction :** les voies PostgreSQL et de démonstration refusent maintenant les débuts contenant des secondes ou millisecondes. Les heures de prise de poste doivent être précises à la minute zéro.

**Tests ajoutés :** refus des instants `08:00:30Z` et `08:00:00.250Z` en modification de planning PostgreSQL.

### 4. Code mort issu de la correction

Le helper local `heureDakar` n’était plus utilisé après le renforcement du contrôle horaire ; il a été supprimé. Aucun module métier entier n’a été effacé sur la base d’une simple recherche textuelle, pour éviter de supprimer des points d’entrée ou du code appelé indirectement.

## Protection du planning des urgences

Aucun fichier du moteur `src/regimes/urgences/` ni aucune migration SQL de cycle des urgences n’a été modifié dans ce lot. Les tests existants des cycles jour/nuit des urgences ont été réexécutés dans la suite complète.

## Résultats reproduits dans cet environnement

- `npm test` : **373 tests réussis, 0 échec** (370 tests préexistants plus 3 tests de régression ajoutés).
- `node --check web/app.js` : réussi.
- `node --check scripts/migrate-catalogue.mjs` : réussi.
- `node --experimental-strip-types --test src/api/operations-postgres.test.ts` : **20 tests réussis, 0 échec**.
- `node --experimental-strip-types --test src/db/migrations.test.ts` : **24 tests réussis, 0 échec**.
- `npm run test:security` : **101 tests réussis, 0 échec**.
- `npm run check:delivery` : réussi, aucun chemin privé interdit ni motif de secret détecté.
- Le test ciblé `src/api/operations-postgres.test.ts` : **20 tests réussis, 0 échec**.

## Limites à ne pas confondre avec une validation complète de production

- Le poste d’audit utilise Node.js `22.16.0`, alors que `package.json` exige `>=22.18`. La suite s’exécute, mais le contrôle final doit être répété sous une version prise en charge.
- `npm run typecheck` n’a pas pu être validé : les dépendances du projet ne sont pas installées dans l’extraction, notamment `@types/node` et `pg`. Les diagnostics TypeScript sont principalement des erreurs de modules/types manquants. Aucune installation officielle (`npm ci`) n’a pu être confirmée depuis cet environnement.
- Docker/CLI PostgreSQL n’est pas disponible ici. Les tests PostgreSQL sont simulés ; les migrations n’ont pas été appliquées à une instance PostgreSQL vivante durant cet audit de suivi.
- Les tests Playwright/E2E et les parcours navigateur réels n’ont pas été exécutés.

## Recette recommandée avant le déploiement

1. Sauvegarder la base de recette et vérifier que la sauvegarde peut être restaurée.
2. Utiliser Node.js `>=22.18`, installer les dépendances avec `npm ci`, puis exécuter `npm run check`, `npm run test:security` et `npm run check:delivery`.
3. Appliquer les migrations sur une base PostgreSQL de recette, vérifier `/readyz` et contrôler que les lignes de planning/historiques existantes restent présentes.
4. Tester un service général sur une semaine incluant samedi, dimanche et un jour férié, puis tenter un déplacement manuel vers chacun de ces jours : les modifications doivent être refusées.
5. Générer une garde Mobil de nuit du lundi 16 h au mardi 08 h, confirmer la prochaine prise jeudi à 16 h, et vérifier que l’accueil des urgences conserve ses cycles 08 h–20 h / 20 h–08 h.

**État :** les régressions détectées dans ce passage sont corrigées et couvertes par des tests automatisés ; la version reste en préproduction jusqu’à la recette PostgreSQL et à l’installation officielle des dépendances.
