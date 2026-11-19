> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# FANN POINTAGE — Note de livraison technique (préproduction)

Date : 12 octobre 2026

## Correctifs livrés dans cette édition

- Alignement du calendrier du service général : 08 h–16 h tous les jours, sauf les jours fériés déclarés ; migration SQL de correction `0010_regle_service_general_et_badges.sql` et suppression de la virgule SQL erronée dans `0002_core.sql`.
- Renforcement des vérifications serveur lors des modifications de planning : instant ISO strict, heure de début exigée selon le régime, jour férié interdit au service général, durée standard et contrôle des cycles de repos.
- Ajout d'une procédure de décision des absences avec statut initial « à confirmer », motif obligatoire et périmètre du responsable de service ; le classement ne compte que les absences passées au statut « injustifiée ».
- Persistance locale de démonstration pour les agents, photos, services, badges individuels renouvelables, plannings manuels, jours fériés, comptes, absences et classements mensuels.
- Les nouvelles fiches d'agent et leur photo sont sauvegardées en une seule écriture locale afin d'éviter un enregistrement partiel en cas d'erreur d'écriture.
- Rollback mémoire ajouté aux opérations locales de service, agent, photo, jour férié, suppression de planning et désactivation d'agent lorsque l'écriture JSON échoue.
- Renouvellement de badge pour les fiches créées par l'application : le code précédent devient invalide ; les codes hérités des agents fictifs sont conservés uniquement pour les tests de démonstration.
- Le mot de passe de démonstration n'est plus imprimé dans les logs du processus.
- Export CSV du registre des absences ajouté, limité aux services visibles du compte connecté et protégé contre l’injection de formules dans les tableurs.
- Cache PWA renouvelé en `fann-pointage-v5` après les modifications de l’interface.
- Sauvegarde manuelle vérifiée de la démo documentée dans `docs/SAUVEGARDE_DEMO.md` avec le script PowerShell `scripts/sauvegarder-demo.ps1`.
- Ajout de tests de régression pour les horaires de modification de planning, les jours fériés et la migration SQL.

## Vérifications exécutées dans cet environnement

- `npm test` : 212 tests réussis, 0 échec.
- TypeScript strict : vérification réussie via la commande `tsc --noEmit --typeRoots /opt/nvm/versions/node/v22.16.0/lib/node_modules/ts-node/node_modules/@types` dans l'environnement de travail. Un clone normal doit exécuter `npm install` pour disposer des dépendances déclarées localement et utiliser `npm run typecheck`.
- Syntaxe JavaScript de l'interface : contrôler avec `node --check web/app.js`.
- Smoke test du serveur en processus local : `/healthz` retourne 200, connexion admin réussie et export CSV des absences retourne 200.
- `scripts/sauvegarder-demo.ps1` a été relu mais n'a pas été exécuté sur Windows/Docker dans cet environnement.
- L'intégrité et l'extraction de l'archive doivent être contrôlées à la livraison.

## Bloqueurs qui demeurent — ne pas masquer

**Cette archive n'est pas une version de production.** L'API utilise toujours le dépôt mémoire hérité et le fichier JSON local de démonstration. Le conteneur PostgreSQL fourni sert à préparer un schéma et n'est pas un dépôt branché aux routes. La table `badges_agents` créée par migration n'est pas encore utilisée par l'API. La gestion d'identité et les sessions ne sont pas raccordées à un fournisseur de production. Le mode offline est propre à l'appareil/navigateur et exige un processus de synchronisation contrôlée. Les migrations et les contraintes n'ont pas été exécutées sur un véritable serveur PostgreSQL dans cet environnement ; aucune exécution Docker, test de charge, test sur matériel hospitalier, test d'imprimante ou restauration de base PostgreSQL n'est certifié ici.

## Conditions obligatoires avant l'usage réel

1. Implémenter un dépôt PostgreSQL transactionnel utilisé par toutes les routes, puis retirer/refuser le stockage JSON en production.
2. Stocker uniquement les hashes de jetons de badge en base, faire valider les migrations et les politiques RLS avec PostgreSQL réel.
3. Séparer l'authentification de production des comptes fictifs, configurer TLS/HTTPS, les secrets de production et le suivi des erreurs.
4. Définir et tester les sauvegardes chiffrées et une restauration complète de la base.
5. Faire valider les horaires et le classement par la direction, tester les cycles sur plusieurs semaines et faire un pilote avec données fictives.
6. Valider les obligations applicables au Sénégal concernant les photos, données de personnel et éventuellement la géolocalisation.
