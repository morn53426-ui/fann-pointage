> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Rapport d'audit technique — FANN POINTAGE Professionnel v19

**Date :** 22 octobre 2026  
**Périmètre :** archive `FANN-POINTAGE-PROFESSIONNEL-v19-MESSAGERIE-SAUVEGARDE.zip`  
**Type d'audit :** revue de code, configuration et migrations, analyse statique ciblée et tests automatisés. Ce document ne constitue pas un audit d'intrusion externe ni une homologation de production.

## 1. Synthèse pour décision

**État : bon socle technique, mais mise en production à conditionner à une recette réelle PostgreSQL et à une restauration vérifiée.** Aucun échec n'a été observé dans la suite de tests automatisés exécutée. Plusieurs protections importantes sont présentes : authentification par jeton signé, mots de passe hachés avec scrypt, révocation de session, limitation des tentatives, CSP, rôle PostgreSQL runtime séparé et mécanisme de migration.

Le code ne permet toutefois pas de prouver que l'infrastructure de sauvegarde a été installée/configurée sur le serveur réel ni qu'une restauration a été menée avec succès. Le déploiement Docker/PostgreSQL, le navigateur mobile et le réseau HTTPS de l'hôpital n'étaient pas disponibles dans cet environnement.

## 2. Vérifications exécutées

| Vérification | Résultat | Portée / limite |
|---|---|---|
| Suite complète `src/**/*.test.ts` | **377 réussis, 0 échec** | Tests automatisés du dépôt, exécutés avec Node 22.16.0 disponible ici |
| Tests ciblés opérations PostgreSQL, auth et migrations | **55 réussis, 0 échec** | Couvre notamment les droits de diffusion, lecture des messages, export et migration 0021 ; pool simulé pour les tests unitaires |
| Tests purs horaires, régimes, dates et géolocalisation | **50 réussis, 0 échec** | Vérifie plusieurs règles métier importantes |
| Syntaxe JavaScript (`web/app.js`, `web/sw.js`, scripts `.mjs`) | **Réussie** | Ce n'est pas un contrôle de types TypeScript |
| `scripts/check-delivery.mjs` | **Réussi** | Aucun chemin privé interdit ni motif de secret détecté dans les contrôles de livraison |
| `npm run typecheck` | **Non concluant** | Les dépendances/types ne sont pas installés correctement ici ; TypeScript signale des modules/types Node manquants. Ce résultat ne permet pas de conclure à des erreurs de types du code source |
| `npm ci` | **Non terminé** | Installation bloquée par l'accès au registre/dépendance non disponible dans le cache ; le projet exige Node `>=22.18`, mais l'environnement fournit Node `22.16.0` |
| Docker + vraie base PostgreSQL | **Non exécutés** | Docker n'est pas disponible dans l'environnement d'audit |
| Test navigateur / iPhone / Android | **Non exécuté** | À faire sur le déploiement de recette |
| Audit dépendances par `npm audit` | **Non exécuté** | Installation des dépendances incomplète ; vérifier dans l'environnement CI connecté |

Les résultats de tests précédemment cités ne doivent donc pas être interprétés comme un test de production ou comme une preuve de restauration réelle.

## 3. Points positifs confirmés

- Les 377 tests du dépôt passent avec le runtime Node disponible, y compris les tests qui couvrent la création de messages, le blocage d'un responsable qui tente de diffuser, l'export réservé à l'administrateur et la migration 0021.
- Les mots de passe sont hachés avec `scrypt`; les sessions sont signées par HMAC et limitées dans le temps. Le code vérifie encore l'activité du compte et la version de session pour permettre la révocation.
- Les tentatives de connexion sont limitées par identifiant/IP et par IP ; les compteurs restent en mémoire, et `compose.yaml` documente explicitement le déploiement mono-instance requis par cette protection.
- La configuration comprend des en-têtes de sécurité, une CSP restrictive et un proxy HTTPS Caddy avec HSTS dans la surcouche HTTPS.
- Le service applicatif n'utilise pas le compte d'administration PostgreSQL : le service `migrate` applique les migrations/droits à part et l'app se connecte avec `fann_app`.
- Les données API ne sont pas mises en cache par le service worker. La file hors ligne du poste partagé conserve les pointages en attente et ne les supprime qu'après réponse du serveur ; les événements refusés restent consultables.
- Les opérations de pointage prévoient des clés d'idempotence et des contrôles métier afin de réduire les doublons. Des tests contrôlent notamment l'identité personnelle, les périmètres de responsables, le pointage hors ligne et les repos de planning.
- La migration `0021_messagerie_diffusion.sql` est additive, numérotée après `0020`, et son application est vérifiée au démarrage du service PostgreSQL.
- La documentation contient des scripts de dump PostgreSQL, chiffrement AES-256, transmission vers destination distante, rétention et restauration de test. Ils doivent encore être exécutés sur l'environnement cible.

## 4. Constats et risques à traiter

### A-01 — Critique opérationnelle : la stratégie de sauvegarde n'est pas prouvée sur l'installation réelle

**Gravité : élevée avant mise en production (risque de perte de données).** Le code contient le processus de sauvegarde distante chiffrée (`scripts/sauvegarde-serveur.ps1`) et un installateur de tâches planifiées (`scripts/installer-sauvegarde.ps1`). L'audit n'a pas pu vérifier qu'ils sont réellement configurés, qu'une destination distante est accessible, que les tâches s'exécutent ou qu'une restauration complète aboutit. Le script bas niveau `scripts/sauvegarde-postgres.sh`, pris seul, crée un dump non chiffré ; il ne faut pas le confondre avec le workflow chiffré complet.

**Action obligatoire :** configurer `BACKUP_DEST`, protéger `BACKUP_PASSPHRASE_FILE`, installer les tâches planifiées ou l'équivalent serveur, exécuter une sauvegarde, confirmer la copie distante, restaurer dans une base jetable avec le script de restauration et conserver le compte rendu. Faire aussi une sauvegarde avant chaque migration en production.

### A-02 — Élevé en matière de confidentialité : l'export JSON contient des données personnelles et de localisation

L'export `/api/sauvegarde/export` est protégé par le rôle administrateur et exclut les mots de passe, sessions et secrets QR/badges. Il comprend cependant, selon les tables exportées, des noms, adresses, téléphones, photos, informations d'affectation et des coordonnées/localisations précises de pointage. Le fichier téléchargé n'est pas chiffré par l'application.

**Action recommandée :** afficher un avertissement avant téléchargement, limiter l'accès et la durée de conservation du fichier, ne pas le télécharger sur un poste partagé non protégé, et privilégier une sauvegarde PostgreSQL chiffrée pour l'usage opérationnel. Examiner les droits d'accès et la politique de conservation avec la direction.

### A-03 — Moyen : la messagerie n'est pas encore personnalisée

La version v19 ne gère que la diffusion générale. La route `POST /api/messages` exige un administrateur et enregistre le message pour la diffusion ; le schéma `messages_diffusion` n'a pas de champ destinataire/agent/service, et la lecture liste les messages généraux. Le suivi de lecture existe.

**Action :** pour permettre les messages individualisés, ajouter une notion de destinataire (utilisateur, agent ou service), filtrer les messages sur le serveur selon l'utilisateur connecté, vérifier les droits administrateur avant l'envoi, et ajouter des tests de non-divulgation inter-agents. Ne pas se limiter à masquer les destinataires dans l'interface.

### A-04 — Moyen : les politiques RLS de `fann_app` servent surtout de garde-fou d'accès technique, pas d'isolation par agent/service

Dans `scripts/grant-runtime-role.sql`, plusieurs politiques pour le rôle `fann_app` utilisent `USING (true)` et `WITH CHECK (true)`. Les filtrages par rôle et par service sont alors essentiellement portés par les contrôles d'autorisation de l'API. Le rôle runtime reste sans `SUPERUSER` ni `BYPASSRLS`, ce qui est positif, mais les politiques ne limitent pas les lignes au périmètre métier d'un utilisateur.

**Action recommandée :** maintenir les tests d'autorisation côté API et envisager une défense en profondeur par politiques SQL scindées par type de données ou par contexte de requête fiable. Ne jamais exposer directement les identifiants PostgreSQL runtime aux clients. Tester explicitement les tentatives d'accès croisé entre services.

### A-05 — Moyen : la file hors ligne concerne le poste partagé, pas une synchronisation complète de l'application mobile

Le service worker met en cache l'enveloppe statique et ignore `/api/`. La file IndexedDB détectée dans `web/app.js` cible les pointages du poste partagé, avec synchronisation lorsque le réseau revient. Les écrans indiquent qu'un pointage mobile hors connexion n'est pas officiel avant confirmation du serveur, ce qui évite de présenter à tort une opération non synchronisée comme validée.

**Action recommandée :** lors de la recette mobile, vérifier le comportement en perte de réseau, fermeture du navigateur, expiration de session, changement d'utilisateur sur appareil partagé, refus de synchronisation et récupération de file. Ne pas présenter le système comme une synchronisation hors ligne complète des données de l'application.

### A-06 — Moyen : limiteur de tentatives en mémoire

Le limiteur n'est pas partagé entre plusieurs instances. `compose.yaml` précise qu'il faut garder une seule instance de l'application. Le déploiement horizontal ou plusieurs réplicas contourneraient ce contrôle sans limiteur partagé.

**Action :** conserver une seule instance comme prévu, ou déplacer les compteurs dans un stockage partagé (par exemple PostgreSQL/Redis) avant d'augmenter le nombre de réplicas.

### A-07 — Moyen : contrôle de types et vulnérabilités de dépendances à refaire dans un environnement complet

Le dépôt exige Node `>=22.18`, tandis que l'environnement d'audit n'a que Node `22.16.0`. L'installation npm n'a pas pu aboutir ; l'échec de `typecheck` est dû à des déclarations/types Node manquants dans cet environnement. Aucun résultat de `npm audit` exploitable n'a été obtenu.

**Action :** utiliser une CI avec Node 22.18 ou une version maintenue plus récente validée par le projet, lancer `npm ci`, `npm run check`, `npm audit --omit=dev` et construire l'image Docker à partir du lockfile. Traiter chaque avertissement réel avant livraison.

## 5. Plan de recette avant mise en service

1. Créer un environnement de recette distinct et une sauvegarde vérifiée de la base actuelle.
2. Démarrer `db`, appliquer les migrations via `migrate` et confirmer que `0021_messagerie_diffusion` est présente et que l'application est prête (`/readyz`).
3. Tester avec au moins trois comptes : administrateur, responsable d'un service, agent. Vérifier refus des opérations interdites, périmètres de données, déconnexion/révocation de session et absence de fuite de données personnelles.
4. Envoyer une diffusion générale, lire depuis plusieurs comptes, contrôler les compteurs de lecture. Si une messagerie individuelle est requise, la livrer et tester l'isolation avant usage.
5. Tester les pointages jour/nuit, le double envoi, les repos des régimes, l'absence de réseau puis le retour de connexion, sur vrais téléphones et sur le poste partagé.
6. Exécuter le workflow de sauvegarde chiffrée jusqu'au stockage distant puis restaurer une copie dans une base jetable. Vérifier le nombre d'agents, services, plannings, pointages et messages restaurés.
7. Vérifier HTTPS/certificats sur les téléphones, pare-feu, secrets uniques, permissions sur les fichiers de sauvegarde, journaux et tâches planifiées.
8. Garder une fiche de mise en production signée : version déployée, migrations, date de sauvegarde, résultat de restauration, contacts de support et procédure de retour arrière.

## 6. Verdict

**Ne pas conclure à une homologation de production sur la seule base des tests unitaires.** Le socle de code paraît cohérent et sa suite automatisée est verte (377/377). Les principaux points bloquants avant mise en service sont la preuve de sauvegarde/restauration de bout en bout, la validation de l'installation réelle, et les tests d'autorisation/confidentialité en recette. Si les messages individualisés sont attendus, il faut les ajouter avant d'annoncer cette capacité.
