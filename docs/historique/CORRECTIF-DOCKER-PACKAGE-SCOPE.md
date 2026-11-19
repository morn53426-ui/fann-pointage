> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctif du redémarrage du conteneur applicatif

## Cause détectée

Le Dockerfile copiait `src/` et `web/`, mais pas `package.json`. Le champ `"type": "module"` était donc absent du scope de module dans l'image Node, bien que le code TypeScript utilise `import`/`export` ESM. Cela peut faire échouer l'entrée `src/api/main.ts` et placer le conteneur dans une boucle de redémarrage.

## Correction

Le Dockerfile copie maintenant `package.json` vers `/app/package.json`. Un test dans `src/api/deploiement.test.ts` empêche de réintroduire cette omission.

## Reconstruire sur Windows/Git Bash

```bash
docker compose up --build -d --force-recreate app
docker compose ps
docker compose logs --tail=100 app
```

L'application de démonstration doit passer à `healthy` et le journal doit signaler qu'elle écoute sur `0.0.0.0:8787`. Cette correction ne raccorde pas le serveur de démonstration à PostgreSQL : les routes métier PostgreSQL restent un chantier séparé.

## Secret divulgué

Dans la sortie `docker compose config` partagée, `DEMO_MOT_DE_PASSE` apparaissait en clair. Régénérez uniquement cette valeur dans `.env` avec un nouveau secret aléatoire et recréez le conteneur `app`. Ne transmettez plus les sorties de configuration complètes car elles peuvent contenir des secrets.
