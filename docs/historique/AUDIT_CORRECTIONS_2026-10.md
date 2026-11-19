> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Rapport d’audit et de corrections — FANN POINTAGE

**Date :** 9 octobre 2026  
**Périmètre :** sources TypeScript, API HTTP, PWA, règles de calcul du classement, configuration de démonstration, migrations PostgreSQL/Supabase, tests et documentation.

## Conclusion

Les corrections de code recensées ci-dessous ont été appliquées et vérifiées par les tests exécutables dans cet environnement. La version corrigée passe **190 tests sur 190 (197 après le complément ci-dessous)**, dont **50 tests dans la suite de sécurité**. Aucun moyen de paiement n’est implémenté : ni prestataire, ni page de paiement, ni checkout ou webhook actif, ni référence ou montant à verser. Les scores et classements restent des indicateurs en points.

**Le projet n’est toutefois pas prêt à être déployé comme système hospitalier de production.** La version actuelle est explicitement une démonstration à données fictives, dont l’API et l’état fonctionnel résident en mémoire. La base PostgreSQL/Supabase est documentée par des migrations, mais le dépôt de données de production n’est pas relié au serveur de démonstration.

## Défauts corrigés

### API, sessions et authentification

- Les dates civiles telles que `2026-02-30`, les mois impossibles et l’année `0000` sont refusés au lieu d’être normalisés silencieusement.
- Une session expire strictement à son instant d’expiration. Les jetons comportant des segments surnuméraires sont également rejetés.
- Le limiteur de connexion a une capacité mémoire maximale et évince les clés les plus anciennes lorsqu’il atteint sa limite.
- La limitation s’applique désormais par couple IP/identifiant **et** par IP : changer d’identifiant à chaque tentative ne suffit plus à éviter la limitation.
- Les identifiants et mots de passe trop longs sont refusés, au lieu d’être tronqués silencieusement.
- Une route privée reconnue appelée avec une mauvaise méthode HTTP renvoie `405` et l’en-tête `Allow`; une route inconnue conserve `404`.
- Les paramètres de date, format, régime et statut de localisation invalides sont refusés explicitement par l’API.

### Droits d’accès et confidentialité

- Le classement, le Top 5, les scores, l’audit et l’export CSV exposés à un responsable sont limités aux services qu’il gère. Les rangs sont recalculés dans le sous-ensemble visible afin de ne pas laisser apparaître les rangs mondiaux.
- Les règles RLS réservent aux administrateurs la lecture directe du document JSON global de classement. Les coordonnées des zones ne sont pas exposées directement aux brancardiers.
- Le trigger SQL qui protège les pointages autorise uniquement une validation manuelle encadrée d’un pointage « à vérifier » ou refusé, avec auteur et motif; il empêche de modifier au passage l’heure, l’agent, le service ou les autres données sources.

### Pointage, QR et interface

- Un QR est expiré dès l’instant exact où sa date d’expiration est atteinte.
- Une précision GPS négative ou invalide est traitée comme une donnée indisponible, pas comme une mesure fiable.
- La caméra est arrêtée quand on quitte la vue ou qu’on se déconnecte. Une permission de caméra accordée après avoir quitté la vue ne laisse pas un flux actif; les lancements concurrents du scanner sont évités.
- Le service worker ne supprime plus les caches sans rapport avec FANN POINTAGE et n’enregistre pas les réponses HTTP en erreur.
- Les erreurs de connexion et de pointage donnent des indications plus précises à l’utilisateur.

### Classement et logique métier

- Le nombre d’absences injustifiées est représenté comme **indisponible** tant que ces données ne sont pas raccordées et confirmées; il n’est plus implicitement considéré comme zéro et ne donne pas de bonus fictif.
- Les critères non disponibles sont neutralisés dans la pondération, et les exports les montrent comme « Non disponible ».

### Démarrage de la démonstration

- Le serveur écoute par défaut uniquement sur `127.0.0.1`, au lieu de potentiellement s’exposer à toutes les interfaces réseau.
- Le port, l’hôte et les coordonnées de zone sont validés au démarrage. Les coordonnées doivent être fournies ensemble et le rayon de la zone doit être positif et au plus égal à 100 km.
- Pour un test sur un autre appareil, `HOST=0.0.0.0` doit être déclaré explicitement sur un réseau de confiance; la géolocalisation mobile exige toujours un contexte HTTPS sécurisé hors `localhost`.

## Absence de moyens de paiement

L’inspection des routes et migrations actives n’a pas identifié de prestataire de paiement, de checkout, de transactions ni de webhook de paiement. Le classement est un classement de points, pas un système de primes ou de versements. Des tests de non-régression vérifient notamment que des routes comme `/api/paiement`, `/api/paiements`, `/api/checkout`, `/api/transactions`, `/api/webhooks/stripe`, `/api/webhooks/wave` et `/api/webhooks/orange-money` restent absentes (`404` après authentification dans l’API de démonstration). Les mentions en documentation/commentaires expliquent cette absence; elles n’activent aucun flux financier.

## Résultats de vérification

| Contrôle | Résultat |
|---|---|
| `npm test` | **190 réussis, 0 échec** |
| `npm run test:security` | **50 réussis, 0 échec** |
| Vérification TypeScript globale avec types Node globaux | Réussie, aucune erreur |
| `node --check web/app.js` | Réussi |
| `node --check web/sw.js` | Réussi |
| `node --check web/vendor/qrcode.js` | Réussi |
| Tests statiques des migrations SQL | Réussis dans les tests ci-dessus |
| Suite SQL `supabase/tests/001_contraintes.sql` sur PostgreSQL réel | **Non exécutée** : `psql` et Docker ne sont pas disponibles dans cet environnement |
| Installation locale des dépendances | `npm install` a expiré; la tentative hors ligne a échoué car le cache npm ne contient pas `@types/node`. Pas de `node_modules` local ni de `package-lock.json` ajoutés. |
| `npm run typecheck` standard | Échec d’environnement : dépendances locales absentes (`@types/node` et `tsc` du projet introuvables). Le contrôle avec le compilateur global et les types Node globaux passe. |
| Analyse syntaxique de `compose.yaml` | Réussie avec un parseur YAML ; validation Docker Compose native indisponible |
| Smoke test HTTP `/healthz` | Réussi dans un processus Node local : `{"status":"ok","mode":"demo"}` |
| Construction/démarrage d'une image Docker | Non exécutés : Docker/Compose ne sont pas installés dans cet environnement |
| Test réel sur téléphone, caméra, GPS et HTTPS | Non exécuté ici |

La vérification TypeScript a été lancée avec le compilateur global (`tsc --noEmit --typeRoots /opt/nvm/versions/node/v22.16.0/lib/node_modules/ts-node/node_modules/@types`), car les dépendances du projet n’ont pas pu être installées localement. Le projet déclare Node.js `>=22.18`; l’environnement d’audit disposait de Node.js `22.16.0`. Après installation des dépendances dans l’environnement de développement cible, exécuter les commandes standards ci-dessous, puis exécuter la suite SQL contre une base jetable créée avec les migrations.

## Ce qui reste obligatoire avant production

1. Brancher réellement l’API sur PostgreSQL/Supabase et définir le cycle de vie des données; le magasin en mémoire perd ses données au redémarrage et ne doit pas servir de registre officiel.
2. Utiliser un fournisseur d’authentification de production, la gestion de comptes et de révocation réels, ainsi que des secrets gérés hors du code et hors des journaux.
3. Exécuter les migrations et `supabase/tests/001_contraintes.sql` sur une base PostgreSQL jetable; examiner les résultats réels des politiques RLS et des triggers.
4. Valider l’installation sur appareils réels, les permissions GPS/caméra, HTTPS, les appareils Android/iPhone ciblés et les navigateurs supportés.
5. Mettre en place sauvegardes/restauration, journalisation centralisée, supervision, gestion de proxy/IP de confiance, tests de charge, procédure de mise à jour et plan de retour arrière.
6. Faire valider par les responsables métier les règles de planning et les pondérations de classement avant toute utilisation officielle.

## Commandes à exécuter dans un environnement configuré

```bash
npm install
npm test
npm run typecheck
npm run test:security
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/001_contraintes.sql
```

**Appréciation finale :** les corrections vérifiables de cette livraison sont appliquées et les tests locaux disponibles passent. Il reste des validations d’intégration et de déploiement indispensables; ce rapport ne certifie pas une aptitude à la production hospitalière.


## Complément — Docker (2026-10-09)

- Ajout de `Dockerfile` pour l'API de démonstration (Node 22.18+, utilisateur non-root, racine en lecture seule dans Compose, sans capabilities, limites de processus/mémoire, healthcheck `/healthz`).
- Ajout de `compose.yaml` avec port lié à `127.0.0.1` par défaut et profil indépendant `database` pour PostgreSQL 17.
- Ajout de `Dockerfile.postgres` : migrations `0001`–`0008`, seed de référence et tests SQL copiés dans l'image DB.
- Ajout de `.env.example`, `.dockerignore`, de la documentation `docs/DOCKER.md` et de tests de non-régression pour les assets de conteneur.
- Ajout d'une route liveness `/healthz` qui retourne seulement `status=ok` et `mode=demo`.

**Limite bloquante maintenue explicitement :** l'API initialise `MagasinDemo`, et aucune connexion PostgreSQL ne se fait depuis l'API. Une mise à jour ultérieure conserve les événements de pointage de démonstration et le journal dans un fichier JSON monté en volume Docker, mais les utilisateurs, plannings, zones et classements restent volatils ; ce fichier ne constitue pas un dépôt transactionnel PostgreSQL. Le conteneur de base reste une cible autonome pour l'initialisation et les essais SQL. Une migration des données applicatives vers un dépôt transactionnel réel, une authentification de production et des tests d'intégration sur PostgreSQL restent obligatoires avant un usage réel. Le test SQL n'a pas pu être exécuté ici, car Docker/Compose et `psql` ne sont pas disponibles ; les commandes `docker compose` doivent être lancées sur une machine disposant de Docker Engine/Desktop.


## Complément — audit indépendant du 2026-10-12 (WIP mis à jour)

Vérifications réelles : `npm test` 197/197, `tsc --noEmit` sans erreur avec les vraies dépendances, migrations `0001`–`0009` et `supabase/tests/001_contraintes.sql` exécutés avec succès sur PostgreSQL 16 (les mentions « non exécuté » ci-dessus sont donc obsolètes).

Corrigé dans cette version :
- **Fuite GPS** : `/api/rapports` et `/api/historique` (JSON) ne renvoient plus latitude/longitude qu'à l'administrateur (`rapport.ts`), test de non-régression dans `src/api/correctifs.test.ts`.
- **Verrouillage de connexion derrière Docker** : `X-Forwarded-For` est lu seulement si `TRUST_PROXY=1` (`serveur.ts`, `compose.yaml`). **Limite restante** : sans reverse proxy, toutes les connexions Docker Desktop partagent l'IP de la passerelle ; le blocage 5 échecs/compte et 30 échecs/IP reste donc partagé. À remplacer par un délai progressif avant tout usage en réseau.
- **SQL `0009_correctifs_audit.sql`** : `impact_score` interdit à l'insertion par un agent ; `valide_par` = utilisateur courant ; absences immuables (agent, période, catégorie) ; affectation par un responsable limitée à son périmètre ; `can_see_agent` ignore les affectations futures ; `TRUNCATE` interdit sur `pointages`, `scores_mensuels`, `classements_mensuels`.
- **Secrets** : `.env` régénéré avec de nouveaux secrets (les précédents ont circulé dans l'archive).

Restent ouverts : garde-fous du classement (plage de mois, « non classé », gel), file hors ligne (purge des rejets, auteur réel), anti-fraude GPS côté serveur, alignement schéma SQL / code (`poste_id`, `captured_ts`, `token_hash`), consentement et conservation du GPS, code mort `src/suivi/` et `archive/`.


## Note de version — 12 octobre 2026

Les résultats détaillés ci-dessus décrivent un état historique antérieur de l’application. Ils ne constituent pas une certification de la migration plus récente `0010_regle_service_general_et_badges.sql`, ni des nouvelles routes de planning/absences de l’édition `0.2.0-preproduction.1`. Dans l’environnement de cette livraison, Docker et `psql` ne sont pas installés ; les migrations 0001–0010 et `supabase/tests/001_contraintes.sql` doivent donc encore être exécutés et validés sur une base PostgreSQL de test. Pour les résultats actuels, consultez `ETAT_LIVRAISON_SENIOR_2026-10-12.md`.
