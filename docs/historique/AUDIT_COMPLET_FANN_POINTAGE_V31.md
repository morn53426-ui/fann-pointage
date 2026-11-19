> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# AUDIT TECHNIQUE COMPLET — FANN POINTAGE v31

**Archive examinée :** `FANN-POINTAGE-PROFESSIONNEL-v31-HTTPS-IP.zip`  
**Date de l'audit :** 28 octobre 2026  
**Version déclarée dans `package.json` :** `0.2.0-preproduction.43`  
**Port applicatif par défaut :** 8787  
**Périmètre :** code source fourni, configuration Docker, configuration d'environnement, migrations SQL, tests présents, générateur de QR/PDF, documentation et scripts de livraison.

> **Verdict :** le projet contient des protections utiles et un nombre important de tests automatisés qui passent. Il ne peut toutefois pas être déclaré prêt pour une production hospitalière sur la base de cet audit seul. Plusieurs anomalies opérationnelles sont confirmées, en particulier l'impression de QR permanents après un simple avertissement, le mode de mot de passe provisoire par défaut et des consignes de déploiement obsolètes. La recette PostgreSQL réelle, le typecheck complet, l'audit des dépendances et les essais physiques n'ont pas pu être certifiés dans cet environnement.

## 1. Résumé exécutif

| Priorité | Constat | État |
|---|---|---|
| **P1 — élevée** | Le générateur peut imprimer des QR permanents avec une URL locale ou en HTTP après avoir seulement affiché un avertissement. | Confirmé dans le code |
| **P1 — élevée** | Les mots de passe provisoires des agents sont dérivés du téléphone par défaut. | Confirmé dans le code/configuration |
| **P1 — élevée** | Plusieurs guides de démarrage/déploiement décrivent un ancien état du projet et contredisent le code de la version `.43`. | Confirmé dans la documentation |
| **P1 — validation bloquante** | Les tests PostgreSQL réels, le build Docker, le typecheck complet, l'audit npm et les tests E2E sur navigateur/téléphone ne sont pas certifiés. | Bloqués par l'environnement / restent à faire |
| **P2 — moyenne** | L'interface/API ne propose pas de désactivation/édition d'une zone, alors que l'écran indique de désactiver la zone pour révoquer une affiche QR. | Confirmé dans les routes fournies |
| **P2 — moyenne** | La création d'une zone et l'écriture de son journal d'audit ne sont pas atomiques. | Confirmé dans le code |
| **P2 — moyenne** | Le code de version `.43`, le guide Windows, les audits et plusieurs documents `.25` à `.30` coexistent sans matrice claire indiquant ce qui est encore applicable. | Confirmé |
| **P2 — résiduel documenté** | Le limiteur de connexions est en mémoire et se réinitialise au redémarrage ; il n'est pas partagé entre plusieurs instances. | Confirmé et déjà documenté |

## 2. Anomalies prioritaires

### F-01 — QR permanents imprimables malgré une URL locale/non sécurisée

**Priorité : P1 — élevée**  
**Fichier :** `web/app.js`, lignes 908–935.

Le générateur accepte les protocoles `http:` et `https:` (l. 912–915). Il repère ensuite certains tunnels temporaires, les noms locaux, certaines plages IP privées et tout protocole autre que HTTPS (l. 926–930), mais affiche seulement un avertissement. Il ajoute ensuite le bouton **« Imprimer / PDF »** sans bloquer l'impression (l. 931–935).

Cela permet de créer des affiches destinées à rester en place pendant des mois avec une URL qui ne fonctionnera pas depuis les téléphones ou qui ne permettra pas les API caméra/géolocalisation. Le PDF `badge service.pdf` analysé séparément dans l'échange précédent contenait des liens en `http://127.0.0.1:8788/#/pointage?qr=...`, qui constituent précisément le type de configuration à empêcher en production.

**Correction recommandée :**
1. En production, refuser la préparation et l'impression d'affiches permanentes si l'URL n'est pas HTTPS et si elle pointe vers localhost, une IP de boucle locale, une adresse privée/locale ou un tunnel temporaire.
2. Conserver au besoin un mode local distinct, explicitement marqué **TEST — NE PAS AFFICHER**, qui ne peut pas être confondu avec les affiches de production.
3. Détecter aussi les formes IPv6 de boucle locale/privées et les plages locales additionnelles ; ne pas se contenter d'un avertissement heuristique.
4. Exiger une confirmation séparée seulement après validation d'une origine de production, et écrire la valeur d'origine dans un diagnostic visible.
5. Ajouter des tests automatisés qui vérifient que l'impression est impossible pour `localhost`, `127.0.0.1`, une IP privée en HTTP, une URL de tunnel et toute URL HTTP. Ajouter le test positif pour l'URL HTTPS de production.
6. Garder une validation côté serveur/configuration, sans construire l'origine depuis un en-tête `Host` non fiable.

**Critère d'acceptation :** aucune affiche de production ne peut être générée/imprimée si l'origine n'a pas été validée comme accessible aux téléphones ciblés.

### F-02 — Mot de passe provisoire prévisible par défaut

**Priorité : P1 — élevée**  
**Fichiers :** `src/api/auth-postgres.ts`, lignes 65–70 et 90–125 ; `compose.yaml`, ligne 17 ; `.env.example`, lignes 6–8.

`modeProvisoire()` choisit `telephone` sauf si `FANN_MDP_PROVISOIRE=aleatoire` est explicitement défini. Le compose utilise également `${FANN_MDP_PROVISOIRE:-telephone}`. Dans ce mode, le mot de passe provisoire est calculé à partir des chiffres du téléphone de l'agent. Le compte est obligé de changer ce mot de passe à la première connexion, ce qui est une mesure utile, mais ne supprime pas le risque de première connexion avant ce changement. Le numéro de téléphone est par ailleurs prévu sur le badge imprimé par le projet.

Si un identifiant/matricule est connu et que le téléphone est visible ou connu, le mot de passe temporaire est prévisible. Pour une application qui contrôle des présences nominatives, le défaut n'est pas recommandé en production.

**Correction recommandée :**
1. Pour les déploiements de production, imposer `FANN_MDP_PROVISOIRE=aleatoire` (code généré de manière cryptographiquement sûre, communiqué séparément du badge).
2. Refuser le démarrage en production si le mode sûr n'est pas explicitement configuré ; à défaut, afficher une alerte de démarrage non contournable dans le guide d'installation.
3. Éviter que le mot de passe et les éléments d'identification nécessaires à la connexion soient tous visibles sur le même support physique.
4. Conserver l'obligation de changement, l'expiration, le hachage et la révocation de session existants.
5. Ajouter un test de configuration de production qui vérifie que le mode `telephone` n'est pas accepté silencieusement.

**Critère d'acceptation :** un environnement de production neuf n'utilise jamais le téléphone comme mot de passe provisoire par défaut.

### F-03 — Documentation de démarrage contradictoire avec la version livrée

**Priorité : P1 — élevée (risque opérationnel)**  
**Fichiers :** `DEMARRER-ICI-WINDOWS.md`, lignes 3–8 ; `docs/DEPLOIEMENT.md`, autour des lignes 7 et 63 ; `docs/REGIMES.md`, ligne 39 ; `docs/CONTRAT-POSTGRES.md`, autour de la ligne 47 ; `package.json`, version 0.2.0-preproduction.43.

Le guide Windows affirme que les API de pointage, planning, badges, rapports et classements ne sont pas activées sur PostgreSQL. D'autres documents plus anciens présentent encore l'API comme une démo en mémoire ou indiquent que l'authentification PostgreSQL n'est pas raccordée. Pourtant, le code livré démarre `src/api/main-postgres-catalogue.ts`, exige le mode PostgreSQL et vérifie plusieurs migrations `0013` à `0025`; les tests de routes couvrent les opérations persistantes.

Ces documents semblent provenir d'étapes antérieures. Leur présence dans la même archive que le code `.43` rend le chemin de mise en service ambigu et peut conduire à appliquer une procédure erronée ou à prendre une décision de production sur une mauvaise description du produit.

**Correction recommandée :**
1. Désigner un guide canonique correspondant à `0.2.0-preproduction.43`.
2. Réviser `DEMARRER-ICI-WINDOWS.md`, `docs/DEPLOIEMENT.md`, `docs/REGIMES.md`, `docs/CONTRAT-POSTGRES.md`, `docs/ETAT_ACTUEL.md` et `docs/PREPARATION_PRODUCTION.md` pour supprimer ou archiver les passages périmés.
3. Déplacer les rapports historiques dans `docs/historique/` et les marquer clairement **historique — ne pas utiliser pour installer la version courante**.
4. Générer automatiquement le numéro de version dans le rapport d'audit et le README depuis `package.json` lorsque possible.
5. Documenter un seul ordre de démarrage, migrations, création du rôle applicatif, variables HTTPS, sauvegarde et restauration.

**Critère d'acceptation :** aucune documentation recommandant une autre architecture ou un mode démo ne reste présentée comme guide de la version courante.

### F-04 — Recette de production incomplète : blocage de qualification, pas preuve d'un bug d'exécution

**Priorité : P1 — blocage de mise en production**

Le code requiert Node.js `>=22.23.4` (`package.json`, l. 7–9) alors que l'environnement d'audit dispose de Node `22.16.0`. L'installation complète de npm a été interrompue par des erreurs DNS/registre et le répertoire `node_modules` est incomplet. En conséquence :

- `npm run typecheck` ne passe pas dans cet environnement parce que les définitions `@types/node` et `pg` ne sont pas disponibles ; cela ne prouve pas que le typecheck échouerait après une installation correcte.
- Deux fichiers de tests d'intégration ne démarrent pas car le paquet `pg` manque : `src/api/compteurs-postgres.integration.test.ts` et `src/pointage/regles-service.integration.test.ts`. Les échecs constatés sont des erreurs de chargement de dépendance, pas des assertions métier ratées.
- Docker et `psql` ne sont pas installés dans l'environnement d'audit ; les tests sur la vraie base, la construction des images, les migrations exécutées, les droits effectifs et la restauration n'ont pas pu être vérifiés ici.
- Les tests E2E Playwright, la caméra, la géolocalisation, le certificat HTTPS de l'environnement réel et les imprimantes réelles restent à tester.
- L'audit de vulnérabilités npm n'a pas pu être exécuté en raison de l'indisponibilité du registre réseau.

**Actions obligatoires sur une CI connectée avec Node 22.23.4 ou supérieur :**

```bash
npm ci
npm run typecheck
npm test
npm run test:security
npm run audit:prod
npm run test:postgres
npx playwright install chromium
npm run test:e2e
```

Puis effectuer la recette décrite dans `docs/PREPARATION_PRODUCTION.md` sur une **base jetable**, vérifier les migrations à deux passages, tester les droits du rôle `fann_app`, restaurer effectivement une sauvegarde et tester les téléphones du site.

**Critère d'acceptation :** tous les contrôles de CI passent, et les essais PostgreSQL/HTTPS/appareils sont documentés avec leurs sorties réelles.

## 3. Anomalies moyennes et améliorations importantes

### F-05 — Révocation d'une affiche QR non accessible depuis l'interface

**Priorité : P2 — moyenne**  
**Fichiers :** `web/app.js`, ligne 946 ; `src/api/routes.ts`, lignes 138–196 ; `src/api/operations-referentiel.ts`, lignes 104–120.

L'interface indique : « Pour révoquer une affiche (perte, vol), désactivez la zone. » Cependant, les routes exposées pour `/api/zones` n'acceptent que `GET` et `POST`. Le dépôt fourni permet de lister les zones actives et d'en créer, mais ne présente pas de route d'édition/désactivation de zone. Il est donc impossible à un administrateur de révoquer individuellement une affiche depuis cette API/UI. Changer `BADGE_SECRET` invaliderait l'ensemble des QR permanents signés par ce secret, ce qui est une mesure globale et disruptive.

**Correction recommandée :** ajouter une action de désactivation/réactivation réservée à l'administrateur, avec transaction, motif obligatoire, audit, confirmation UI et tests. Un QR associé à une zone désactivée doit être refusé au scan. Ajouter aussi une procédure d'urgence si un secret doit être renouvelé globalement.

### F-06 — Création de zone et journal d'audit non atomiques

**Priorité : P2 — moyenne**  
**Fichier :** `src/api/operations-referentiel.ts`, lignes 110–115.

`creerZone()` insère la zone via `ops.pool.query(...)`, puis appelle `ops.audit(...)` séparément. Si l'écriture du journal échoue après l'insertion, l'appel peut retourner une erreur alors que la zone existe déjà, et l'action n'a pas été auditée. Cela peut produire une zone orpheline du point de vue du journal et une réponse qui ne reflète pas l'état réel.

**Correction recommandée :** réaliser l'insertion et l'audit dans une même transaction PostgreSQL (`BEGIN`, insert, audit, `COMMIT`, avec `ROLLBACK` en erreur), à l'image des fonctions d'émission/révocation de badge qui utilisent déjà une transaction.

**Critère d'acceptation :** si l'audit échoue, la création est annulée ; la réponse API et l'état PostgreSQL restent cohérents.

### F-07 — Étiquettes des zones du PDF à confirmer avec le référentiel réel

**Priorité : P2 — moyenne, en attente d'une source métier faisant autorité**

Dans le PDF `badge service.pdf` analysé séparément, les sept affiches montraient les libellés suivants :

- ACCUEIL URGENCES — `Zone1`
- IMAGERIE — `ZONE TESTE 0`
- KINÉSIE — `ZONE TESTE 0`
- MALADIES INFECTIEUSES — `zone 0`
- MOBILE — `ZONE TESTE 0`
- NEUROLOGIE/HOSPITALISATION — `zone 0`
- PNEUMOLOGIE — `zone 0`

Les textes « ZONE TESTE 0 » sont des libellés de test inadaptés à une affiche finale. Cependant, la base de production et la table de correspondance officielle du CHNU Fann ne font pas partie de l'archive fournie ; l'audit ne peut donc pas déterminer par supposition quelle zone réelle chaque service doit utiliser.

**Correction recommandée :** consulter le référentiel approuvé du site, vérifier chaque association service-zone-coordonnées, rejeter la génération des affiches si les valeurs sont vides ou proviennent d'un jeu de test, puis régénérer et décoder les 7 QR. Ne pas remplacer toutes les zones par une valeur arbitraire.

### F-08 — Limiteur de tentatives de connexion en mémoire

**Priorité : P2 — résiduel documenté**  
**Référence :** `docs/PREPARATION_PRODUCTION.md`, lignes 88–101.

Le limiteur utilise des compteurs en mémoire qui se réinitialisent au redémarrage et ne se partagent pas entre plusieurs instances. La documentation décrit correctement cette limitation et déconseille de faire tourner plusieurs réplicas. Pour un futur déploiement répliqué ou exposé au-delà du réseau interne, déplacer les compteurs vers un stockage partagé (PostgreSQL/Redis) et garder une protection au proxy. Ce n'est pas une anomalie nouvelle si l'architecture reste strictement mono-instance selon les restrictions documentées.

### F-09 — Données personnelles imprimées sur le badge à revoir avec l'établissement

**Priorité : point de gouvernance à confirmer**

Le code du catalogue prend en charge la profession, l'adresse et le téléphone et les tests vérifient la persistance de ces champs. Le numéro de téléphone est utilisé par défaut pour le mot de passe provisoire et des informations de contact peuvent être imprimées. Il convient de confirmer avec le CHNU Fann quelles informations doivent être visibles en clair sur un badge porté publiquement. Ce point est à valider au regard des règles internes de confidentialité et de minimisation des données, sans retirer un champ métier avant accord de l'établissement.

## 4. Contrôles positifs observés

- Le projet sépare le rôle PostgreSQL applicatif `fann_app` du rôle d'administration/migration ; les commentaires et compose évitent de transmettre le compte d'administration à l'application.
- Le compose standard limite par défaut les ports de l'application et de PostgreSQL à `127.0.0.1`; l'application utilise un système de fichiers en lecture seule, un répertoire temporaire limité, `cap_drop: ALL`, `no-new-privileges`, des limites PID et mémoire.
- Le serveur exige `FANN_MODE=postgres-catalogue` pour le point d'entrée PostgreSQL et vérifie la présence des migrations requises avant de démarrer.
- Les migrations SQL ont un test vérifiant la séquence, la RLS et la journalisation de tables sensibles. Les données nominatives réelles ne sont pas incluses dans l'archive d'après le contrôle de livraison et l'inspection des migrations/seed présents.
- Les contrôles statiques de syntaxe des scripts frontend ciblés ont réussi (`web/app.js`, `web/sw.js`, module QR local).
- `node scripts/check-delivery.mjs --local` a réussi : aucun chemin privé interdit ni motif de secret n'a été détecté dans le contrôle exécuté.
- Les tests unitaires couvrent de façon utile l'authentification, les autorisations par rôle, la prévention du double pointage, les QR falsifiés, les règles de planning, les exports CSV et les migrations.

## 5. Résultats des tests exécutés pendant cet audit

### Tests réussis

Dans les lots de tests ciblés exécutés avec Node `22.16.0` et `--experimental-strip-types`, **486 sous-tests ont réussi**, répartis sur plusieurs groupes portant notamment sur :

- règles métier partagées, QR, pointage, géolocalisation et régimes horaires ;
- configuration serveur, routes, en-têtes et couverture des routes PostgreSQL ;
- authentification PostgreSQL, changement de mot de passe, sessions et hachage ;
- opérations PostgreSQL simulées, absences/rapports, référentiel et messages ;
- API, autorisations, anomalies, administration du planning, compteurs et régressions précédentes ;
- catalogue persistant, badges, classements, dashboard, migrations SQL, sauvegarde des règles et exports.

Les fichiers `web/app.js`, `web/sw.js` et `web/vendor/qrcode.js` ont également passé `node --check` lors des vérifications effectuées. Le contrôle de livraison a réussi.

### Tests non validés ou bloqués

- Deux fichiers de test d'intégration échouent avant l'exécution des assertions, car le paquet `pg` est absent de l'installation incomplète (`ERR_MODULE_NOT_FOUND`).
- Le typecheck TypeScript est bloqué par l'absence de fichiers de types (`@types/node` et types du paquet `pg`).
- La suite globale `npm test` n'a pas fourni de bilan complet dans le temps alloué ; les chiffres ci-dessus sont ceux des lots ciblés effectivement terminés.
- Aucun test PostgreSQL sur un serveur réel, aucune construction Docker et aucune restauration effective n'ont été réalisés ici : `docker` et `psql` ne sont pas disponibles.
- Les tests Playwright/E2E et essais sur Android/iOS, caméra, GPS, certificat HTTPS du site et imprimante ne sont pas certifiés.
- `npm audit` n'a pas été validé, car le registre npm était inaccessible dans cet environnement.

**Interprétation importante :** les 486 réussites sont un signal positif, mais ne signifient pas « 486 tests de bout en bout réussis » et ne remplacent pas les tests d'intégration PostgreSQL et les essais sur site.

## 6. Plan de correction recommandé, dans l'ordre

1. **Bloquer l'impression de QR non sûrs** en production et écrire les tests de non-régression correspondants.
2. **Imposer le mode de mot de passe provisoire aléatoire** en production et vérifier que le code est transmis séparément du badge.
3. **Aligner tous les guides sur la version `.43`**, archiver clairement les guides historiques et produire une procédure de déploiement unique.
4. **Rendre la révocation d'une zone/QR accessible et auditée** depuis l'interface administrateur.
5. **Rendre la création de zone et l'audit atomiques** avec une transaction PostgreSQL.
6. **Faire valider les sept correspondances service-zone** par l'établissement puis régénérer le PDF et décoder chaque QR.
7. Installer les dépendances à partir du lockfile dans une CI connectée et Node compatible, puis faire passer typecheck, tests complets, audit npm, Docker, tests PostgreSQL et Playwright.
8. Effectuer la recette sur une base de test, tester les permissions et le parcours complet depuis un autre téléphone, valider HTTPS/GPS et restaurer une sauvegarde.
9. Obtenir l'approbation métier des régimes, des coordonnées des zones, des renseignements imprimés sur les badges et du pilote d'un service avant généralisation.

## 7. Verdict final

**État recommandé : PRÉPRODUCTION — corrections et recette obligatoire avant mise en production hospitalière.**

L'architecture contient des choix techniques corrects et de nombreux tests utiles. Les risques prioritaires sont corrigeables sans réécrire l'ensemble du projet. En revanche, il serait imprudent de déclarer ce ZIP « sans bug » ou « prêt à lancer en production » tant que les QR de production ne sont pas protégés contre une mauvaise origine, que la méthode des mots de passe provisoires n'est pas sécurisée par défaut, que la documentation n'est pas unifiée et que les validations PostgreSQL/Docker/E2E n'ont pas été réalisées dans un environnement complet.

**Aucune correction source n'a été apportée à l'archive dans le cadre de cet audit : ce document rapporte les constats et les travaux à mener sur la version fournie.**
