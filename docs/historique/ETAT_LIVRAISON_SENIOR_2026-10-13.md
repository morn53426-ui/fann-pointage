> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

> **Note de version — 14 octobre 2026 :** ce rapport décrit l’état observé le 13 octobre 2026. Une révision ultérieure raccorde désormais les routes de pointage, planning, badges, QR, historique, anomalies, tableau de bord et classement au dépôt PostgreSQL et applique les contrôles de rôle côté serveur. Voir `docs/AUDIT_CORRECTIFS_OPERATIONS_POSTGRES_2026-10-14.md`. Ces nouvelles routes restent à valider sur une vraie instance PostgreSQL ; cette note ne vaut pas certification de production.

# État de livraison — FANN POINTAGE (13 octobre 2026)

## Modifications de cette édition

- Ajout d'un workflow CI GitHub Actions pour installer les dépendances, vérifier TypeScript, lancer les tests et contrôler la syntaxe JavaScript de la PWA.
- Correction du rétrécissement TypeScript du jeton de badge lors de sa première génération.
- Ajout d'un script PowerShell de restauration d'une sauvegarde de démonstration, avec confirmation destructive explicite, validation JSON et vérification SHA-256 lorsque le fichier checksum existe.
- Les instructions Windows demandent de générer un `.env` local à partir de `.env.example`; le `.env` personnel ne doit pas être distribué dans l'archive.

## Vérifications locales

- `npm test`: 215 tests réussis, 0 échec.
- `npm run test:security`: 62 tests réussis, 0 échec.
- `npm run typecheck`: non validé dans l'environnement local, car les dépendances de développement (`@types/node`) ne sont pas installées. Le workflow CI les installera avant le contrôle.
- Docker Compose et migrations PostgreSQL réels : non exécutés dans cet environnement.

## Limites majeures non résolues

- L'API utilise toujours `MagasinDemo` et un fichier JSON local. PostgreSQL n'est pas le dépôt opérationnel de l'API ; le profil `database` fournit uniquement le schéma.
- La restauration du fichier JSON ne constitue pas une procédure de sauvegarde/restauration PostgreSQL de production.
- Les comptes et mots de passe sont encore ceux du mode démonstration ; le mode production est explicitement refusé par l'application.
- Les tests de charge, les tests réels sur imprimante/lecteur QR, la restauration en environnement isolé et les essais de sécurité réseau restent à exécuter.

## Décision de livraison

Cette archive convient aux essais locaux avec données fictives. Elle n'est pas certifiée pour l'exploitation officielle ou pour des données personnelles réelles. La prochaine étape majeure doit être le raccordement transactionnel de toutes les routes à PostgreSQL, avec tests d'intégration sur un serveur PostgreSQL réel, avant de qualifier le système de prêt à la production.

## Suite des travaux — configuration GPS Compose

- Correction : `ZONE_LAT`, `ZONE_LNG` et `ZONE_RAYON` sont désormais transmises au conteneur `app` depuis `.env`.
- Documentation : `.env.example` et `docs/DEPLOIEMENT.md` expliquent la configuration, le rayon en mètres et le risque de conserver une zone fictive.
- Tests : le test de déploiement vérifie que les variables sont bien présentes dans Compose et dans l'exemple de configuration.
- Vérification après cette modification : `npm test` — 215 tests réussis, 0 échec.
- Limite : Docker Compose n'est pas disponible dans cet environnement ; la résolution effective de `docker compose config` et le test GPS sur le site doivent être faits sur la machine de déploiement.

## Prochaine étape obligatoire

La prochaine réalisation majeure reste l'intégration transactionnelle de PostgreSQL dans toutes les routes métier. Cette modification n'est pas incluse dans cette livraison : elle exige une refonte contrôlée des accès directs aux collections mémoire, un dépôt PostgreSQL, des transactions/idempotence, une stratégie de migration des données démo, et des tests d'intégration contre un serveur PostgreSQL réel. Le projet demeure strictement en mode démo.


## Suite des travaux — contrat SQL pointage/QR

- Ajout de la migration `0011_contrat_pointage_application.sql` : colonnes `poste_code`, `captured_ts`, `qr_token_id`, index adaptés et déclencheur SQL qui consomme le QR dans la même transaction que l'insertion du pointage.
- Le déclencheur refuse un QR inconnu, expiré, associé à une autre zone ou réutilisé par le même agent. Les conflits concurrents sont arbitrés par la contrainte unique de `qr_token_uses`.
- Ajout de scénarios SQL dans `supabase/tests/001_contraintes.sql` : consommation atomique, absence de pointage orphelin après un doublon, QR expiré et zone incohérente.
- Ajout de `docs/CONTRAT-POSTGRES.md`, qui décrit les correspondances du modèle métier et les travaux encore nécessaires.
- Le script Windows crée désormais `.env` s'il manque, avec deux secrets aléatoires distincts ; le fichier reste exclu de l'archive. Le guide `DEMARRER-ICI-WINDOWS.md` est complété.
- `npm test` : 215 réussis, 0 échec ; `npm run test:security` : 62 réussis, 0 échec. `node --check` passe pour `web/app.js`, `web/sw.js` et `web/vendor/qrcode.js`.
- `npm run typecheck` reste bloqué dans cet environnement par l'absence des dépendances installées (`@types/node` et types des modules `node:*`). Docker et `psql` ne sont pas disponibles ici ; les migrations et les nouveaux tests SQL n'ont pas été exécutés sur une véritable instance PostgreSQL.

## Limite inchangée

La migration prépare et sécurise le futur contrat, mais l'API utilise toujours `MagasinDemo` et la persistance JSON locale. La production reste explicitement désactivée ; le prochain chantier majeur est le dépôt PostgreSQL branché à toutes les routes, avec tests réels de transaction et d'authentification.


## Suite des travaux — tests HTTP et reprise après redémarrage (13 octobre 2026)

- Ajout de `scripts/test-e2e-process.mjs`, exécutable sans dépendance npm externe avec `npm run test:e2e:process`. Il lance le vrai serveur HTTP dans un processus enfant, en environnement isolé temporaire.
- Le scénario réalise une connexion admin/responsable/brancardier, valide les erreurs d’authentification et les `401/403`, vérifie la portée service, pointe l’arrivée puis le départ sur un poste des urgences actif, teste l’idempotence et le refus d’une seconde arrivée.
- Après arrêt puis redémarrage du processus avec le même répertoire JSON, le jeton de session précédent est refusé, les nouvelles connexions fonctionnent, les deux pointages sont reconnus avec les mêmes identifiants, et le fichier ne contient qu’une arrivée et un départ correspondant au scénario.
- Vérifications finales : `npm test` — 215 réussis ; `npm run test:security` — 62 réussis ; `npm run test:e2e:process` — 17 contrôles HTTP réussis.
- Tous les scénarios utilisent des identifiants et données fictifs dans un répertoire temporaire supprimé en fin de test. Aucun système hospitalier réel n’a été contacté.

## Limite non levée

Cette vérification valide la reprise du processus applicatif et du fichier JSON local uniquement. Elle ne remplace pas des tests sur PostgreSQL réel, des transactions concurrentes, une panne de base de données, une coupure pendant une écriture ou un essai de restauration de sauvegarde. `docker` et `psql` ne sont pas disponibles dans cet environnement, et l’API n’utilise toujours pas PostgreSQL. Le mode production demeure désactivé. Voir `docs/VERIFICATION_E2E_2026-10-13.md`.

## Phase suivante — banc réel PostgreSQL (13/10/2026)

- Ajout de `compose.postgres-test.yaml` : conteneur PostgreSQL 17 isolé, sans port publié.
- Ajout de `npm run test:postgres` : applique les migrations et seed au démarrage, exécute les contraintes SQL, lance deux insertions concurrentes sur le même QR, puis redémarre PostgreSQL et confirme la conservation d'une écriture.
- Le script supprime son projet Compose et le volume de test en fin d'exécution.
- Vérifications locales : `npm test` (après ajout du test de garde du runner), `npm run test:security`, `npm run test:e2e:process`, et `node --check` sur les scripts applicatifs.
- Limite : Docker/psql ne sont pas présents dans l'environnement de préparation ; les tests contre PostgreSQL n'ont donc **pas** été exécutés ici. Ils sont reproductibles sur la machine de développement avec Docker Desktop.
- Cette étape ne raccorde pas encore l'API au schéma relationnel : l'API reste en mode démonstration avec persistance JSON. Le dépôt transactionnel et l'authentification PostgreSQL demeurent obligatoires avant toute utilisation réelle.


## Suite des travaux — première tranche du dépôt PostgreSQL (13 octobre 2026)

- Ajout de `src/pointage/postgres.ts`, implémentation transactionnelle du contrat `Depots` pour le moteur de pointage : lecture de l’agent et de son affectation en vigueur, lecture de zone et du planning actif, recherches d’idempotence et d’usage QR, insertion du pointage dans une transaction SQL, consommation QR via le trigger, journalisation et validation manuelle avec motif.
- Ajout de tests unitaires pilotés par un faux client SQL : conversions numériques, lecture d’affectation, requêtes paramétrées, ordre BEGIN/COMMIT, rollback et gestion de la contrainte d’idempotence.
- Ajout de la dépendance de production `pg` et des paramètres de connexion documentés dans `.env.example`.
- Vérification locale : les nouveaux tests unitaires passent avec le client SQL simulé. La suite complète doit être relancée dans l’environnement du développeur avec Node 22.18+ et les dépendances installées.
- Limite impérative : **le nouveau dépôt est une première tranche et n’est pas encore branché au routeur HTTP**. L’authentification, le chargement complet des données et plusieurs routes utilisent encore `MagasinDemo` / JSON. Le serveur doit continuer à refuser le mode autre que `demo`. Aucune intégration PostgreSQL de bout en bout ni aucune connexion réelle à une base n’a été exécutée ici, car Docker, `psql` et l’accès au registre npm ne sont pas disponibles.

- Défaut de fin de processus corrigé dans `scripts/test-e2e-process.mjs` : le runner quittait parfois avec succès affiché mais conservait le processus Node ouvert à cause des connexions fetch keep-alive. Il se termine désormais après arrêt et nettoyage de ses serveurs temporaires.
- Après ajout du dépôt : `npm test` — 222 tests réussis ; `npm run test:security` — 63 réussis ; `npm run test:e2e:process` — 17 contrôles réussis ; `npm run test:postgres:unit` — 6 réussis ; `node --check` passe sur les scripts PWA et E2E.
- `npm run typecheck` toujours non validé : les paquets du projet ne sont pas installés dans cet environnement (dont `@types/node`, `pg` et `@types/pg`), et le registre npm n’est pas accessible depuis la machine de préparation.


## Phase authentification PostgreSQL (13 octobre 2026)

- Ajout de la migration `0012_identifiants_application.sql` : identifiant normalisé unique, hash scrypt contrôlé, version de sessions révocable, RLS et refus d'accès aux rôles clients.
- Ajout de `src/api/auth-postgres.ts` : chargement des comptes, création atomique profil/credentials/services, mise à jour du mot de passe, révocation des sessions et désactivation. Les changements de credentials sont audités sans enregistrer le hash.
- Ajout de neuf tests SQL simulés couvrant requêtes paramétrées, transactions, validation des comptes et révocation.
- Vérification locale : `npm test` — 233 réussis ; `npm run test:security` — 65 réussis ; `npm run test:e2e:process` — 17 contrôles HTTP ; `npm run test:auth:postgres` — 9 réussis.
- Limites : dépôt d'authentification non raccordé aux routes HTTP ; tests SQL simulés seulement ; Docker/PostgreSQL réels et TypeScript non validés ici. La production reste désactivée.


## Mise à jour 0.2.0-preproduction.6 — 13 octobre 2026

- Ajout d’un mode `postgres-auth` explicitement activé pour tester la connexion et l’identité à partir de PostgreSQL.
- Le routeur HTTP choisit le dépôt d’authentification PostgreSQL lorsqu’il est injecté, revalide les comptes et la version de session à chaque requête et récupère les services visibles depuis la base. Aucun repli vers les comptes de démo n’est autorisé dans ce mode.
- Ajout d’une commande de création initiale d’administrateur qui reçoit le mot de passe via variable d’environnement et ne l’imprime pas.
- Les routes métier autres que `/api/moi` sont bloquées en `503 migration_metier_incomplete` : le dépôt de pointage, les agents, les plannings et les autres données ne sont pas encore raccordés.
- Résultats de cette livraison : `npm test` : 240/240 ; `npm run test:security` : 81/81 ; `npm run test:auth:postgres` : 15/15 ; `npm run test:e2e:process` : 17 contrôles HTTP réussis (sur stockage de démonstration JSON).
- Limites : le test PostgreSQL réel n’a pas été lancé (Docker/psql absents). `npm run typecheck` reste bloqué par les dépendances absentes dans l’environnement (`@types/node`, `pg` et types liés) ; il doit être relancé après `npm install`. Aucune validation en production n’est revendiquée.
