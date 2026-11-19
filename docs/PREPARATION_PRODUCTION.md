# Préparation à la production — FANN POINTAGE

Version source : `0.2.0-preproduction.25` (messagerie générale/ciblée, suivi de lecture, export JSON expurgé et contrôle renforcé de restauration ; la qualification reste à effectuer). Ce document sépare **ce qui a été vérifié et reproduit** de **ce qui doit encore être validé sur le site**. Tant que la section 5 n'est pas entièrement cochée, la version reste en préproduction.

## 1. Ce qui a été reproduit (résultats réels)

| Contrôle | Résultat | Comment le rejouer |
|---|---|---|
| Version Node requise | Le projet exige Node.js >=22.23.4. L’environnement de modification utilise 22.16.0 : version insuffisante pour une qualification de livraison. | `node --version`, puis installer Node 22.23.4+ |
| `npm ci` / dépendances officielles | Non validé dans cet environnement : les dépendances officielles/versions complètes ne sont pas installées ici. | `npm ci` sous Node 22.23.4+ |
| `npm test` — suite complète après le lot Mobil | **381 tests réussis, 0 échec** | `npm test` |
| `npm run typecheck` | Non qualifié : `node_modules` absent et `npm ci` non abouti dans cet environnement. | `npm ci` puis `npm run typecheck` sous Node 22.23.4+ |
| Syntaxe JavaScript | `node --check web/app.js` et `node --check scripts/migrate-catalogue.mjs` réussis | commandes `node --check` ci-dessus |
| Migrations PostgreSQL 0017/0018/0021/0022 | Tests statiques réussis ; la migration 0021 n’est pas appliquée sur une vraie base PostgreSQL dans cet environnement. | Appliquer sur une copie de recette, puis `npm run db:upgrade` deux fois |
| `npm run test:postgres` | Non exécuté : Docker est absent de cet environnement. | Démarrer Docker Desktop, puis `npm run test:postgres` |
| `npm run test:e2e` | Non exécuté : le runner Playwright Test requis n’est pas disponible dans cet environnement. | Après `npm ci` : `npm run test:e2e` |
| Build applicatif | Aucun script `build` n’est défini dans `package.json`. | `docker compose build` dans un environnement Docker fonctionnel |
| `npm run check:delivery` | OK, aucun chemin privé ni motif de secret détecté | `npm run check:delivery` |

Limites de cette vérification : aucun serveur PostgreSQL/Docker n’était disponible pendant ce lot ; les dépendances npm complètes, les tests Playwright, les appareils réels, la caméra, la géolocalisation, le HTTPS Caddy et l’imprimante restent à valider. Ils figurent dans la section 5.

La version inclut maintenant le ciblage des messages (`tous`, comptes sélectionnés ou services) avec filtrage serveur et priorité normale/urgente. La migration `0022_messagerie_destinataires` est requise ; les tests automatisés ne remplacent pas le contrôle du schéma sur une vraie base.

## 2. Contrôle des routes « non raccordées » (503 `migration_metier_incomplete`)

En mode PostgreSQL, toute route non raccordée répond **503** plutôt que de basculer sur les données de démonstration (refus volontaire). Le test `src/api/couverture-routes-postgres.test.ts` extrait **tous** les chemins `/api/…` appelés par `web/app.js` et vérifie qu'aucun ne tombe sur ce 503. Les tests de code couvrent aussi la messagerie générale, les droits administrateur et l’export JSON ; la migrations 0021/0022 et les nouvelles routes de messagerie ciblée restent à intégrer à la recette PostgreSQL réelle de cette livraison.
Si vous ajoutez un écran, ajoutez sa route à la liste blanche de `routes.ts` : le test échouera sinon.

## 3. Recette PostgreSQL (à refaire sur le poste de déploiement)

```bash
# 1) Base neuve : docker compose up -d db puis
npm run migrate:catalogue && npm run db:configure-app-role
# 2) Copie représentative d'une base existante (jamais la base de production elle-même) :
#    restaurer une sauvegarde dans une base jetable, puis
npm run db:upgrade && npm run db:upgrade     # le 2e passage ne doit rien appliquer
# 3) Tests d'intégration jetables (Docker requis)
npm run test:postgres
# 4) Droits minimaux : toutes ces commandes doivent ÉCHOUER avec le compte fann_app
psql "$DATABASE_URL" -c "DROP TABLE agents" -c "CREATE TABLE x(i int)" \
  -c "DELETE FROM journal_audit" -c "TRUNCATE pointages"
```

## 4. Recette fonctionnelle de bout en bout

À lancer **uniquement sur une base de recette** (le script crée des agents, comptes et pointages de test) :

```bash
FANN_RECETTE_OK=1 ADMIN_INITIAL_MOT_DE_PASSE='…' FANN_URL=http://127.0.0.1:8787 npm run recette:api
```

Couvre : connexion/échec, catalogue, matricule en double, badge, zone, QR dynamique, plannings, pointage poste partagé (idempotence, double pointage refusé, badge falsifié refusé, délai minimal de 2 min), écrans, comptes administrateur/responsable/brancardier, accès hors périmètre (403), désactivation de compte et session révoquée, déconnexion, verrouillage après échecs (429) et déblocage. Il attend ~2 min 05 s entre arrivée et départ (règle métier). Après la recette : redémarrez l'application et vérifiez que les données sont toujours là, puis **supprimez la base de recette**.

## 5. Reste à valider sur le site avant la production (non vérifiable ici)

- [ ] `docker compose up` complet (services `db`, `migrate`, `app`) sur le poste de déploiement ; `docker compose ps` tous sains.
- [ ] `npm ci` puis `npm run typecheck`, `npm run test:security` et `npm audit --omit=dev` dans une CI connectée sous Node 22.23.4+.
- [ ] `docker compose build` puis `docker compose up -d`; services `db`, `migrate`, `app` sains.
- [ ] `npm run test:postgres` (banc Docker jetable) vert après ajout des migrations 0017/0018/0021/0022.
- [ ] Vérifier en base réelle le ciblage : agent destinataire voit le message, autre agent le voit pas, ancien affecté ne voit plus les messages ciblés service, et seul l’admin accède à l’annuaire.
- [ ] Exécuter `bash scripts/restaurer-sauvegarde.sh sauvegardes/nom-de-votre-dump.dump test` sur un dump restauré depuis la destination distante et conserver son journal.
- [ ] Vérifier sur copie de recette le passage du service Mobile de `garde` à `mobil` pour les seules affectations ouvertes, sans altérer les affectations clôturées ni les plannings historiques.
- [ ] Vérifier les cas Mobil : 08–16 du lundi au vendredi, exclusion des jours fériés par défaut, garde 16–08 les jours ouvrés non fériés, garde 08–08 (24 h) si le début tombe un samedi, un dimanche ou un jour férié, repos minimal de 56 h après chaque garde, chevauchements refusés et contrôle backend inter-régimes.
- [ ] Navigateurs mobile **et** desktop : connexion, pointage QR, poste partagé, badges, plannings, rapports. *(Chromium headless : 32 tests verts ; reste à faire sur de vrais téléphones et sur Safari/Firefox si utilisés.)*
- [ ] Mode hors ligne du poste partagé et resynchronisation.
- [ ] Caméra et géolocalisation **en HTTPS** sur les téléphones réels.
- [ ] Impression : badge et feuilles d'émargement sur l'imprimante réelle (page `/imprimer.html`).
- [ ] `FANN_ENV=production` défini dans `.env` et `FANN_MDP_PROVISOIRE` absent ou `aleatoire` (le mode « telephone » est refusé au démarrage en production).
- [ ] Affiches QR : générées depuis l’adresse définitive (https), jamais en mode TEST ; correspondance service-zone-coordonnées validée par le CHNU Fann ; procédure de révocation (désactivation de zone) testée.
- [ ] Certificat HTTPS : nom DNS interne, autorité Caddy installée sur chaque poste/téléphone (voir `docs/HTTPS_ET_SAUVEGARDES.md`).
- [ ] Zone de pointage : coordonnées GPS validées du site saisies par l'administrateur.
- [ ] Régimes et plannings validés avec l’administration du CHNU Fann, notamment les règles Mobil (garde 24 h les week-ends/jours fériés et repos minimal de 56 h).
- [ ] Sauvegarde chiffrée planifiée **et** restauration testée sur le serveur (section 6).
- [ ] Pilote contrôlé (un service, quelques jours) avant déploiement général.

## 6. Sauvegarde et restauration

La preuve qu'une sauvegarde fonctionne est sa **restauration**. Le script de test utilise maintenant `pg_restore --exit-on-error --single-transaction`, restaure dans une base jetable, contrôle la lisibilité des principales tables ainsi qu’un nombre minimal de services, puis supprime la base de test automatiquement :

```bash
bash scripts/sauvegarde-postgres.sh                       # crée, vérifie (pg_restore --list) et conserve 14 copies
# restauration isolée recommandée : validation des tables/compteurs, puis suppression automatique de la base de test
bash scripts/restaurer-sauvegarde.sh sauvegardes/fann-pointage-AAAAMMJJ-HHMMSS.dump test
# Windows avec sauvegarde chiffrée :
# .\scripts\restaurer-sauvegarde.ps1 -Fichier sauvegardes\fann-pointage-AAAAMMJJ-HHMMSS.dump.enc
# Le mode production exige la saisie explicite RESTAURER ; sauvegardez la base courante avant cette étape.
```
Les scripts shell sont lancés par `bash scripts/…` : le bit exécutable n'est pas nécessaire. `.gitattributes` force les fins de ligne LF (un CRLF casserait les scripts dans les conteneurs Linux).

## 7. Limiteur de connexion et proxy — risques et exploitation

**Limiteur en mémoire.** Le verrouillage des connexions (5 échecs / 15 min par compte+IP, 30 par IP) est conservé en mémoire du processus :
- il est **remis à zéro à chaque redémarrage** de l'application (un attaquant qui peut provoquer un redémarrage récupère ses essais) ;
- il n'est **pas partagé** entre instances : **ne lancez qu'une seule instance `app`** (pas de `replicas`, pas de `--scale`). Un test (`couverture-routes-postgres.test.ts`) refuse la configuration contraire ;
- les mots de passe sont hachés (scrypt) et chaque échec/succès est tracé dans `journal_audit` : **supervisez** les `connexion_echec` répétés :
  `docker compose exec -T db psql -U fann_admin -d fann_pointage -c "SELECT ip, count(*) FROM journal_audit WHERE action='connexion_echec' AND at > now() - interval '1 hour' GROUP BY ip ORDER BY 2 DESC LIMIT 50;"`
- **Politique de mots de passe (décision de l'établissement) : administrateur : 9 caractères minimum (v21) ; mot de passe provisoire d'un agent ou d'un responsable : 6 ; mot de passe choisi par la personne : 8. Depuis la v22, les mots de passe à faible variété (ex. `000000001`) et les mots de passe courants sont refusés, et un mot de passe provisoire expire au bout de 7 jours** (`creer-admin-postgres.ts`, `routes.ts`, test `mot-de-passe-minimum.test.ts`). Compensations : hachage scrypt, verrouillage après échecs, journal des connexions à superviser (requête ci-dessus) et un seul accès réseau interne. Le mot de passe admin généré par `npm run setup:env` reste long et aléatoire : privilégiez-le ou changez-le pour un mot de passe robuste connu seulement de l'administrateur ;
- le risque est acceptable pour **une instance sur un réseau interne**. Si l'application devait être exposée au-delà du réseau de l'hôpital ou répliquée, il faudrait un stockage partagé (table PostgreSQL ou Redis) — évolution non incluse dans cette version.

**`X-Forwarded-For`.** L'application lit cet en-tête **uniquement** si `TRUST_PROXY=1`, et retient le **dernier** maillon (celui du proxy). Caddy remplace l'en-tête (`header_up X-Forwarded-For {remote_host}`). Conditions de sécurité :
1. `TRUST_PROXY=1` **uniquement** avec `compose.https.yaml` ;
2. `APP_BIND_ADDRESS` reste `127.0.0.1` : le port de l'application ne doit **jamais** être joignable directement depuis le réseau, sinon n'importe qui peut forger l'en-tête et contourner le limiteur ;
3. avec `TRUST_PROXY=0` (accès direct), tous les clients passant par la passerelle Docker partagent une IP : le verrouillage d'un compte vaut alors pour tous les postes.

**HTTPS interne (`tls internal`).** Le certificat est signé par une autorité **interne** Caddy : les navigateurs ne lui font pas confiance par défaut. Installez `root.crt` sur chaque poste/téléphone (procédure dans `docs/HTTPS_ET_SAUVEGARDES.md`), sinon la caméra et la géolocalisation seront bloquées. Pour un certificat public, utilisez un nom DNS public et remplacez `tls internal` par la configuration ACME de Caddy.
