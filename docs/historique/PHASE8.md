> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Phase 8 — Tests et sécurité

## Vérifications reproductibles

Depuis la racine du projet :

```bash
npm install
npm test
npm run typecheck
npm run test:security
```

Les tests couvrent les trois régimes, les cycles et durées de repos, les calculs et départages de scores, le Top 5, les accès API, les sessions, l'idempotence des pointages, les contrôles statiques RLS/migrations, l'export CSV et les fichiers de la PWA. Les tests statiques et HTTP ne remplacent pas les essais dans Safari/Chrome sur les appareils réellement utilisés.

Les contrôles statiques SQL vérifient certaines protections et la cohérence élémentaire des fichiers, mais n'exécutent pas le schéma. Les migrations ne sont pas considérées comme validées tant qu'elles n'ont pas été appliquées à une base de test PostgreSQL réelle.

## Essais restant à effectuer avant production

- Appliquer séquentiellement les migrations `0001` à `0011` sur une base PostgreSQL jetable puis exécuter `supabase/tests/001_contraintes.sql`.
- Ajouter les essais d'intégration RLS avec des comptes de chaque rôle et plusieurs services ; vérifier qu'un client authentifié ne peut pas écrire directement les scores ou le classement.
- Tester les accès concurrents et les tentatives de génération du même mois.
- Tester sur des téléphones réels le GPS intérieur/extérieur, la caméra, le QR dynamique, les interruptions réseau et la reprise hors ligne.
- Réaliser un test de charge, une revue de sécurité externe et une restauration de sauvegarde avant le pilote.

Ces contrôles ne certifient pas la conformité juridique ni l'aptitude à un usage hospitalier de production. Tant que le dépôt PostgreSQL et l'authentification de production ne sont pas raccordés, la démonstration ne doit contenir que des données fictives.

## Résultats historiques de vérification de la livraison du 9 octobre 2026

- `npm test` : **186/186 tests réussis**.
- `npm run test:security` : **49/49 tests réussis**.
- La vérification TypeScript ad hoc passe avec le compilateur global TypeScript 5.8.3 et les définitions Node déjà présentes dans l’environnement d’audit. Le chemin utilisé est spécifique à cet environnement, pas à reprendre tel quel sur Windows.
- `node --check web/app.js`, `node --check web/sw.js` et `node --check web/vendor/qrcode.js` : réussis.
- `npm run typecheck` n'a pas pu fonctionner dans cet environnement car les dépendances locales, dont `@types/node`, n'ont pas pu être installées; l'installation npm a expiré et le cache hors ligne ne contenait pas les paquets.
- Les migrations SQL passent des contrôles statiques automatisés, mais n'ont pas été appliquées à PostgreSQL dans cet environnement (`psql` et Docker absents). La suite `supabase/tests/001_contraintes.sql` reste à exécuter sur une base jetable.

L'environnement disposait de Node.js 22.16.0 alors que le projet déclare Node.js 22.18 ou supérieur. Les validations d'intégration, d'appareils réels et de déploiement demeurent obligatoires avant la production.


## Livraison mise à jour du 12 octobre 2026

La note [`ETAT_LIVRAISON_SENIOR_2026-10-13.md`](ETAT_LIVRAISON_SENIOR_2026-10-13.md) contient les résultats actuels : 215 tests Node réussis, sans échec. Le typecheck TypeScript ne peut pas être validé dans l’environnement actuel parce que `@types/node` n’est pas installé. La migration `0011` et les tests SQL ne sont **pas** certifiés par une exécution sur un vrai serveur PostgreSQL dans l’environnement courant.
