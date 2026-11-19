> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctifs et état de validation — FANN POINTAGE v15 mobile

**Version livrée :** `0.2.0-preproduction.19`  
**Date :** 19 octobre 2026

## Correctifs appliqués

1. **Écran blanc « Badges à imprimer »** : correction du `ReferenceError` provoqué par l'utilisation de `statutImpression` avant l'initialisation de la variable `const` dans `web/app.js`. La déclaration est maintenant placée avant la construction de `zoneListe`.
2. **Résilience de l'interface** : `naviguer()` intercepte les exceptions de rendu, écrit l'erreur dans la console et affiche un message de diagnostic exploitable au lieu de laisser le contenu principal vide.
3. **Mode hors ligne** : si `/api/moi` échoue, l'identité en cache est réutilisée uniquement quand `/healthz` confirme explicitement le mode `demo`. Si le mode est inconnu ou PostgreSQL, l'application supprime le jeton et le profil de session en cache et revient à la connexion. La file de pointages en attente IndexedDB reste intacte.
4. **Actualisation PWA** : le cache du service worker passe de `fann-pointage-v19` à `fann-pointage-v20`.
5. **Régression de badge** : les tests E2E des badges vérifient maintenant l'absence d'erreur JavaScript pendant le rendu ; un scénario de session hors ligne vérifie que le cache privilégié n'est pas réutilisé si le mode serveur est inconnu.
6. **Version documentaire** : `package.json`, `package-lock.json` et le README passent à `0.2.0-preproduction.19`. Le test qui contrôle la version du cache service worker a été mis à jour.

## Résultats effectivement exécutés

| Contrôle | Résultat | Limite |
|---|---:|---|
| `npm test` | 342 réussis, 0 échec | Node.js 22.16.0, inférieur au minimum déclaré 22.18 |
| `npm run test:security` | 98 réussis, 0 échec | Tests automatisés dans l'environnement disponible |
| `npm run test:e2e:process` | 17 contrôles validés | Stockage JSON de démo, pas PostgreSQL |
| `npm run check:delivery` | Réussi | Scan du dépôt de livraison extrait |
| `node --check` sur les fichiers JavaScript modifiés | Réussi | Syntaxe uniquement |

## Validations non accomplies

- `npm ci --no-audit --no-fund` n'a pas abouti : connexion/paquet requis (`xtend@4.0.2`) indisponible dans le cache npm hors ligne. Une installation propre doit être refaite avec accès au registre npm.
- TypeScript, Playwright/Chromium et le scénario PDF ajouté n'ont pas été exécutés dans cette session : les dépendances n'étaient pas installées. Le navigateur système est soumis à une politique d'accès aux sites locaux, ce qui a empêché une recette manuelle équivalente.
- Aucun PostgreSQL jetable ni serveur PostgreSQL de recette n'était accessible ; migrations, RLS, concurrence et restauration sont non validées.
- L'impression réelle (format CR80 86 × 54 mm), caméra, GPS et fonctionnement sur appareils Android/iPhone restent à tester sur le matériel cible.

## Risques qui restent ouverts

- Les politiques RLS de `fann_app` continuent d'utiliser des politiques générales (`USING (true)` / `WITH CHECK (true)`). Les autorisations métier sont principalement contrôlées par l'API. Une vraie isolation ligne par ligne ne doit pas être ajoutée sans propager de façon transactionnelle et sûre le contexte utilisateur sur chaque connexion PostgreSQL ; cette évolution nécessite un travail spécifique et des tests d'intégration.
- Les règles métier de rotation des urgences, les coordonnées GPS et le rayon de pointage doivent être validés par les responsables du CHNU Fann.
- L'authentification multifacteur pour l'administration, le limiteur partagé multi-instance et les essais sauvegarde/restauration restent à traiter avant production.

## Recette locale recommandée

Avec Node.js 22.18+, Docker Desktop et l'accès au registre npm :

```bash
npm ci --no-audit --no-fund
npm run check:delivery
npm run typecheck
npm test
npm run test:security
npm run test:e2e:process
npx playwright install chromium
npm run test:e2e
npm run test:postgres
```

`npm run test:postgres` doit utiliser l'environnement jetable prévu par le projet. Ne jamais lancer ces essais contre le registre nominatif de production.
