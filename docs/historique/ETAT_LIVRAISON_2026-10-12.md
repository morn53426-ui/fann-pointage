> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

> **Document historique — remplacé par la livraison 0.2.0-preproduction.1.** Il décrit la version photo/import précédente et ses résultats de test (206 tests). Pour l’état actuel, les nouveaux tests, le CSV des absences, la migration 0010, et les blocages en production, consulter [`ETAT_LIVRAISON_SENIOR_2026-10-12.md`](ETAT_LIVRAISON_SENIOR_2026-10-12.md). Ne pas interpréter les résultats historiques comme une validation des nouvelles modifications.

# État de livraison — FANN POINTAGE

Date : 12 octobre 2026  
Nature : prototype amélioré / préproduction. Ce document ne certifie pas l'aptitude à l'exploitation clinique ou administrative.

## Changements inclus dans cette archive

- Module **Badges à imprimer** : photo requise pour les nouvelles fiches, ajout/remplacement de photo après création, coordonnées, service/régime, QR individuel, impression recto-verso et retrait des mentions « FANN POINTAGE » / « SENDIMBEUL SARL » des faces imprimées. L’import compresse l’image localement et affiche un message explicite pour les fichiers HEIC/HEIF. Le QR n'est pas une preuve cryptographique d'identité.
- Fiches agents : ajout, modification d'identité, désactivation et historique conservé pour les fiches créées manuellement. Un agent désactivé ne doit plus pointer.
- Gestion des plannings : création par période et par agent selon son régime, vérification des chevauchements/repos, suppression limitée aux postes manuels futurs sans pointage.
- Calendrier des jours fériés : création/suppression par l'administrateur. Le calendrier est volontairement laissé vide : il faut saisir et vérifier les dates officielles. Changer le calendrier ne met pas automatiquement à jour les plannings déjà générés.
- Comptes nominatifs de démonstration : création de responsable par service ou compte de brancardier lié à un agent, mot de passe haché avec scrypt, désactivation, réinitialisation administrateur et réactivation contrôlée. Les changements de compte incrémentent une version de session afin que les jetons antérieurs restent invalides après réactivation.
- Persistance JSON locale quand `DATA_DIR` est configuré : fiches et photos ajoutées, services, plannings manuels, jours fériés, comptes créés/modifiés, pointages et journal. Les fichiers sont écrits par remplacement temporaire dans le volume local.
- Règle du service général : postes 08 h–16 h tous les jours sauf jours fériés explicitement enregistrés. Les cycles de garde et d'urgences restent distincts.
- Démarrage : `FANN_MODE` accepte uniquement `demo`; un démarrage avec `production` ou une autre valeur est refusé intentionnellement tant que le dépôt de production n'est pas raccordé.
- Documentation : procédure Windows, stockage, étapes de validation et limites clarifiés.

## Vérifications dans l'environnement de préparation

- Tests Node (`node --experimental-strip-types --test "src/**/*.test.ts"`) : **206 réussis, 0 échec**. Ils incluent le remplacement de la photo via PATCH et la limite HTTP dédiée aux modifications d’agent.
- Syntaxe JavaScript du navigateur et du service worker (`node --check web/app.js` et `node --check web/sw.js`) : réussie.
- La vérification TypeScript (`npm run typecheck`) n’a pas pu être terminée dans cet environnement : les dépendances et les types Node ne sont pas installés localement. Après décompression, installez les dépendances (`npm install`), puis exécutez `npm run typecheck`.
- Tests de planification : service général avec jour férié, cycle de garde 24 h/48 h, équipe urgences jour/nuit, permissions comptes/calendrier, persistance JSON et session invalidée après réinitialisation/désactivation/réactivation.

## Non vérifié dans cet environnement

- Construction et démarrage Docker : Docker n'était pas disponible dans l'environnement de création, donc l'image et le conteneur n'ont pas pu être exécutés ici.
- Impression sur les imprimantes réelles : alignement recto-verso, marges et lisibilité du QR à vérifier sur papier de test et sur le matériel choisi.
- Caméra, PWA, réseau sans fil et synchronisation hors ligne : tests sur ordinateur, Android et iPhone à effectuer sur site.
- Charge, restauration d'une sauvegarde et tests end-to-end sur un PostgreSQL en exécution : non exécutés.

## Blocages avant production

1. **PostgreSQL n'est pas raccordé à l'API.** Le service DB inclus dans Compose initialises seulement le schéma/seed ; les routes applicatives continuent d'utiliser un magasin mémoire et le JSON local. Il faut développer un dépôt PostgreSQL transactionnel utilisé par toutes les routes, avec contraintes, migrations pilotées et idempotence.
2. **Authentification de production absente.** Les comptes partagés préchargés restent réservés à la démo. Il faut un fournisseur d'identité éprouvé, stockage durable/révocation de sessions, procédures utilisateur, secrets de production et test des rôles.
3. **Sauvegarde et reprise non certifiées.** Les écritures JSON de démonstration ne remplacent pas des sauvegardes automatiques chiffrées, hors serveur, avec restauration testée.
4. **Conformité et règles métier à valider.** La direction doit approuver les régimes, exceptions, calendrier, tolérances, règles de score et procédure d'absence. Les obligations sénégalaises de protection des données personnelles, notamment les photos et données de pointage/localisation, doivent être examinées avant collecte réelle.
5. **Validation matérielle et pilote requis.** Tester les imprimantes, l'alignement, la lecture des QR, les appareils, les interruptions réseau, les contrôles d'accès, la charge et la procédure de secours.

## Recommandation

Utiliser cette archive pour démo, revue fonctionnelle et tests avec des données fictives seulement. **Ne pas saisir de photos ou informations réelles du personnel, ne pas diffuser les comptes de démo et ne pas exposer le serveur via ngrok pour un usage opérationnel** avant la fin des blocages ci-dessus.
