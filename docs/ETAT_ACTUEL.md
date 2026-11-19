# État actuel du projet (28/10/2026, version 0.2.0-preproduction.44) — point d'entrée unique

> Les documents rangés dans `docs/historique/` (audits, phases, correctifs datés) sont **historiques** : ils décrivent l'état au moment où ils ont été écrits. Ce fichier fait foi.

## Ce qui est en place
- Pointage par QR, heure serveur, géorepérage, mode hors ligne, poste partagé, validation manuelle motivée.
- Régimes séparés : service général, garde (24 h + 48 h de repos), urgences (jour/nuit).
- Absences, rapports (CSV protégés contre l'injection de formules), classement mensuel, badges recto-verso (prénom puis nom).
- Messagerie persistante : diffusion à tous les comptes actifs, à des comptes précis ou à un ou plusieurs services ; filtrage serveur, priorité normale/urgente et suivi des lectures.
- Export JSON métier expurgé depuis l’espace administrateur : exclut GPS précis, adresses, téléphones et photos, mais reste une donnée personnelle et ne remplace pas un dump PostgreSQL complet chiffré.
- Sécurité : comptes scrypt, sessions signées (8 h ; 26 h pour les agents), déconnexion serveur, limiteur de connexion avec déblocage par l'administrateur (écran « Comptes utilisateurs »), CSP stricte, rôle SQL restreint, journal d'audit immuable.
- Exploitation : migrations de schéma (service `migrate`), sauvegardes PostgreSQL chiffrées vers un partage et/ou un serveur SSH, restauration testable, supervision toutes les 15 min. Les migrations `0021_messagerie_diffusion` et `0022_messagerie_destinataires` sont additives et conservent les données existantes.

## Documents à connaître
| Besoin | Document |
|---|---|
| Démarrer sous Windows | `DEMARRER-ICI-WINDOWS.md` |
| Docker, migrations, import initial | `docs/DOCKER.md`, `docs/IMPORT_REGISTRE.md` |
| HTTPS | `docs/HTTPS_ET_SAUVEGARDES.md` |
| Sauvegardes et restauration | `docs/SAUVEGARDE_SERVEUR.md`, `docs/PREPARATION_PRODUCTION.md` |
| Pilote avant ouverture générale | `docs/CHECKLIST_PILOTE.md` |
| Règles métier | `docs/REGIMES.md`, `docs/POINTAGE.md` |

## Décisions qui ne relèvent pas du code
- Protection des données personnelles (photos, adresses, téléphones) : accès, durée de conservation, responsable du traitement — à valider avec la direction du CHNU Fann.
- Serveur de production dédié (idéalement Linux) plutôt qu'un poste Windows.
- Rôle « direction » en lecture seule : à décider selon le besoin réel.

## Vérifications de la livraison 0.2.0-preproduction.25
- Tests automatisés exécutés : 381 réussis, 0 échec ; contrôles de syntaxe JS et migration réussis.
- À rejouer avant production : migrations 0021–0022 sur une base PostgreSQL de recette, restauration complète, Docker, typecheck avec dépendances npm complètes, tests de navigation réelle sur téléphones et contrôle des permissions HTTPS/GPS/caméra.
- L’export JSON réservé à l’administrateur est une copie métier téléchargeable, pas une restauration autonome ; le dump PostgreSQL chiffré reste nécessaire.

## Correctifs de la v32 (audit v31)
- F-01 : affiches QR permanentes refusées pour une adresse http/localhost/tunnel/IP non routable (affiches « TEST — NE PAS AFFICHER » seulement) ; adresse du réseau interne en https : confirmation explicite. Contrôle côté interface (`web/origine-qr.js`) ; le serveur ne connaît pas l'adresse encodée, donc il ne peut pas la contrôler.
- F-02 : mot de passe provisoire **aléatoire par défaut** ; `FANN_ENV=production` refuse le démarrage avec `FANN_MDP_PROVISOIRE=telephone`.
- F-03 : documentation réalignée ; anciens rapports dans `docs/historique/`.
- F-05 : `PATCH /api/zones/:id` (administrateur, motif obligatoire, audit) ; une zone désactivée refuse tout pointage.
- F-06 : création de zone et audit dans une même transaction.
- Reste à faire (hors code) : F-04 recette complète (PostgreSQL réel, Docker, E2E, appareils), F-07 validation service-zone par le CHNU Fann, F-09 gouvernance des données imprimées sur les badges, F-08 limiteur partagé si plusieurs instances.

## Limites connues
- Le serveur d'application exécute le TypeScript avec `--experimental-strip-types` ; une compilation en JavaScript reste à faire avant une exploitation à long terme.
- Le limiteur de connexion est en mémoire (réinitialisé à chaque redémarrage) ; l'administrateur peut débloquer un compte, et `docker compose restart app` remet tout à zéro en cas de blocage de l'administrateur lui-même.
- `web/app.js` (un seul fichier d'interface) devra être découpé quand le projet grossira.
- Les scripts PowerShell (sauvegarde, restauration, supervision) n'ont pas été exécutés par leur auteur : l'essai complet de `docs/SAUVEGARDE_SERVEUR.md` est obligatoire.
