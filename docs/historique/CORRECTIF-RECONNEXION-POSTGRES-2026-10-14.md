> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctif : reconnexion PostgreSQL au démarrage

## Symptôme observé

Les logs de l'application contiennent `ECONNREFUSED ...:5432` depuis `main-postgres-catalogue.ts` alors que PostgreSQL démarre ensuite et annonce `database system is ready to accept connections`. Cela correspond à une tentative de connexion pendant une interruption ou avant que PostgreSQL accepte les connexions. Les lignes PostgreSQL montrent également un arrêt rapide puis un redémarrage ; elles ne permettent pas, à elles seules, d'établir ce qui a déclenché cet arrêt.

## Correctifs intégrés

- Les contrôles PostgreSQL de démarrage réessaient jusqu'à 30 fois les erreurs réseau temporaires, avec une attente progressive plafonnée à 2 secondes entre les essais (environ 54 secondes de pauses cumulées au maximum, auxquelles s’ajoute le temps des requêtes de connexion).
- Les erreurs de migration, de schéma ou d'autorisations ne sont pas masquées par les nouvelles tentatives.
- Le pool PostgreSQL possède un gestionnaire d'erreurs pour les connexions inactives perdues lors d'un redémarrage de la base. Le pool pourra recréer une connexion lors des requêtes suivantes.
- Des tests couvrent les nouvelles tentatives, l'arrêt sur erreur non temporaire et la limite de tentatives.

## Déployer le correctif sous Docker Desktop (Windows / Git Bash)

Depuis le dossier qui contient `compose.yaml` :

```bash
docker compose config --quiet
docker compose up -d --build --force-recreate app
docker compose ps
docker compose logs --tail=100 app
```

Puis vérifier les sondes HTTP :

```bash
curl -i http://127.0.0.1:8787/healthz
curl -i http://127.0.0.1:8787/readyz
```

Les deux sondes doivent retourner HTTP 200 quand l'application et le schéma sont prêts. Si `/healthz` répond mais `/readyz` retourne 503 durablement, consulter les logs de l'application pour identifier une migration ou un accès PostgreSQL manquant.

Si PostgreSQL continue à redémarrer, examiner sa cause séparément :

```bash
docker compose ps -a
docker compose logs --tail=200 db
```

Le correctif ne peut pas empêcher un arrêt volontaire ou une panne durable du moteur. Ne lancez pas `docker compose down -v` pour diagnostiquer ce problème : l'option `-v` supprime les volumes et peut effacer les données de pointage. Le correctif ne nécessite pas de supprimer ni de réinitialiser le volume PostgreSQL.
