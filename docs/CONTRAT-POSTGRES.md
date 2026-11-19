# Contrat PostgreSQL du pointage — phase de préparation

## État réel

La migration `0011_contrat_pointage_application.sql` rapproche le schéma SQL du modèle TypeScript. Une première implémentation du dépôt métier se trouve désormais dans `src/pointage/postgres.ts` : elle lit agents, affectations, zones, plannings, historique, QR consommés, compte les refus hors zone et réalise l’insertion du pointage avec transaction, idempotence et audit. Les tests unitaires simulant l’interface PostgreSQL se trouvent dans `src/pointage/postgres.test.ts`.

**Les dépôts de pointage et de comptes sont encore des couches préparatoires et ne sont pas raccordés au routeur HTTP.** Le serveur `src/api/main.ts` doit donc continuer à refuser le mode autre que `demo`. Les comptes, profils, badges, plannings générés depuis l’interface, absences, classements, photos et autres collections utilisent encore `MagasinDemo` / JSON. La présence de `DATABASE_URL` ou du module `pg` ne doit pas être interprétée comme une activation de la production.

## Correspondance des champs

| Modèle applicatif | Colonne PostgreSQL | Règle |
|---|---|---|
| `posteId` | `pointages.poste_code` | Identifiant métier texte du moteur de régime ; différent de `planning_id` (UUID relationnel). |
| `capturedTs` | `pointages.captured_ts` | Heure d'appareil facultative, jamais considérée comme officielle avant validation manuelle. |
| `tokenHash` | `qr_tokens.token_hash` puis `pointages.qr_token_id` | Résoudre le hash côté serveur ; ne stocker ni le jeton brut ni un hash recopié dans `pointages`. |
| consommation d'un QR | `qr_token_uses` | Le déclencheur SQL crée l'usage dans la même transaction que l'insertion du pointage. |
| `serverTs` | `pointages.server_ts` | Heure officielle établie côté serveur. |
| `idempotencyKey` | `pointages.idempotency_key` | L'unicité `(agent_id, idempotency_key)` existante reste la barrière anti-doublon. |

## Garanties préparées

- QR inconnu, QR associé à une autre zone ou QR non actif à l'heure serveur : insertion refusée.
- Un même QR ne peut pas être consommé deux fois par le même agent, y compris avec deux insertions concurrentes : la clé primaire de `qr_token_uses` est l'arbitre final.
- L'insertion du pointage et celle de la consommation QR sont atomiques : une erreur du déclencheur annule la transaction d'insertion.
- La consommation est enregistrée à `server_ts`, et non à l'heure locale de la base.

## Tests qui restent obligatoires

1. Exécuter toutes les migrations sur une base PostgreSQL jetable (PostgreSQL n'est pas disponible dans l'environnement de préparation utilisé pour cet archive).
2. Ajouter ou exécuter des tests d'intégration réels pour les insertions concurrentes, l'idempotence, les QR expirés, les incohérences de zone et le rollback atomique.
3. Implémenter puis raccorder un dépôt transactionnel à toutes les routes, pas uniquement à `traiterPointage`.
4. Tester restauration et redémarrage, authentification persistante, droits/RLS et parcours de validation manuelle avant toute donnée réelle.

## Dépôt PostgreSQL (première tranche)

- `DepotPointagePostgres` implémente le contrat `Depots` du moteur de pointage. Il utilise des requêtes paramétrées et s’attend à recevoir les UUID natifs de `agents`, `services`, `zones_pointage` et `plannings`.
- Pour l’insertion, le dépôt ouvre une transaction, vérifie l’existence et la fenêtre de validité du QR haché, insère le pointage, relit la ligne, puis commit. La consommation du QR est atomique via le trigger de migration `0011`. Toute erreur avant le commit déclenche un rollback.
- Les erreurs de violation de la contrainte d’idempotence sont converties en `ErreurDoublon`; un conflit de consommation QR concurrente reste un échec d’enregistrement, sans pointage orphelin grâce à la transaction SQL.
- Les tests unitaires peuvent s’exécuter sans PostgreSQL : `npm run test:postgres:unit`. Ils vérifient les requêtes paramétrées, les conversions, l’ordre transactionnel, le commit et le rollback. Ils ne remplacent pas `npm run test:postgres`, qui doit être exécuté avec Docker pour tester le moteur PostgreSQL.
- La prochaine sous-phase doit introduire un contexte applicatif authentifié par PostgreSQL/Supabase, charger les profils/services/agents/plannings du dépôt, puis migrer chaque route. Tant qu’une route nécessaire utilise encore les collections de `MagasinDemo`, le mode production reste interdit.


## Authentification persistante — première tranche (migration 0012)

La migration `0012_identifiants_application.sql` ajoute une table de credentials liée à `profiles` : identifiant normalisé unique, hash scrypt, version de session et timestamps. RLS est activée; les rôles clients `anon` et `authenticated` n’ont aucun accès à cette table. Le nouveau `DepotAuthentificationPostgres` sait charger les comptes, créer un compte et ses services de manière transactionnelle, changer un mot de passe, incrémenter la version des sessions, révoquer les sessions et désactiver un compte. Les actions qui modifient les credentials/session_version sont accompagnées d’un audit sans inclure le hash du mot de passe.

Les tests de `src/api/auth-postgres.test.ts` simulent les requêtes SQL; ils ne valident pas l’exécution en vraie base. [Historique, remplacé] À l’époque de cette migration, le dépôt n’était pas encore utilisé par `/api/connexion`, `/api/moi` ou les contrôles d’accès. Depuis, l’authentification PostgreSQL est raccordée (`src/api/main-postgres-catalogue.ts`, migrations `0012` à `0025`). Ancien texte : les sessions n’étaient pas encore persistées ni révoquées depuis cette table dans le serveur livré. La production reste désactivée. Voir `docs/PHASE_AUTH_POSTGRES_2026-10-13.md`.
