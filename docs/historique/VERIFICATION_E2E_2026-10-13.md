> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Rapport de vérification de bout en bout — 13 octobre 2026

## Résultat

- **215/215 tests automatisés du projet** : réussis.
- **17 contrôles HTTP de bout en bout supplémentaires** : réussis avec deux processus séparés du serveur.
- **PostgreSQL réel** : non testé dans cet environnement (Docker et `psql` indisponibles). Le service reste explicitement en mode démo et utilise la sauvegarde JSON locale.

## Exécution reproductible

Depuis la racine du projet, avec Node.js et sans dépendance npm supplémentaire :

```bash
npm test
npm run test:security
npm run test:e2e:process
```

Le test de processus utilise `node:fetch`, lance `src/api/main.ts` sur un port libre et crée ses données fictives dans un dossier temporaire. Il n'utilise ni compte réel ni données de l'hôpital et supprime le dossier temporaire à la fin.

## Scénarios vérifiés en HTTP

1. Une route privée sans jeton retourne `401`.
2. Un mauvais mot de passe est refusé avec `401` ; une connexion administrateur valide retourne un profil correspondant au rôle.
3. L'administrateur peut consulter les agents.
4. Un brancardier ne peut pas consulter la liste des agents ni le tableau de bord, et ne peut pas utiliser le poste de pointage partagé (`403`).
5. Un responsable ne peut pas pointer un agent d'un service qu'il ne gère pas (`403`).
6. Avec le responsable authentifié et un badge de démo correspondant au poste des urgences actif, une arrivée est acceptée (`201`).
7. Le rejeu de la même clé d'idempotence renvoie le même identifiant de pointage ; une nouvelle clé pour une seconde arrivée sur ce poste est refusée (`409`).
8. Le départ après l'arrivée est accepté (`201`).
9. Après arrêt et redémarrage du serveur avec le même répertoire de données, l'ancien jeton de session est refusé (`401`) et il faut se reconnecter.
10. Après reconnexion, les deux clés d'idempotence sont reconnues comme déjà traitées : mêmes identifiants, sans nouvel événement. Le fichier sauvegardé ne contient qu'une arrivée et qu'un départ correspondant à ce test.

Le test choisit automatiquement l'équipe de jour ou de nuit en fonction de l'heure de Dakar afin de rattacher les événements à un poste de démonstration alors actif.

## Ce que ces tests ne prouvent pas

- Ils n'établissent pas une connexion à PostgreSQL et n'évaluent donc pas les contraintes SQL, transactions concurrentes, migrations, pool de connexions ou reprise après perte du serveur de base de données.
- Le test de reprise couvre la fin du processus applicatif puis son redémarrage avec le même fichier JSON. Il ne simule pas une coupure électrique au milieu de l'écriture, une panne de disque ou la corruption du système de fichiers.
- Ils ne constituent pas une homologation de sécurité ni une autorisation de déployer le système sur les données réelles du personnel.

## Conditions avant exploitation hospitalière

1. Raccorder toutes les routes métier à un dépôt PostgreSQL transactionnel ; ne pas activer le mode de production tant qu'il n'est pas disponible.
2. Exécuter les migrations sur une instance PostgreSQL isolée et tester les contraintes et transactions concurrentes.
3. Réaliser des essais de restauration de sauvegarde et de reprise avec perte réelle de la base de test.
4. Tester l'authentification, la rotation/révocation des sessions, les rôles et la portée de service avec des comptes de test nominatifs fictifs.
5. Réaliser une recette métier supervisée avant toute utilisation officielle.
