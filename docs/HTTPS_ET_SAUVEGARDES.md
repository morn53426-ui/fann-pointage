# HTTPS et sauvegardes

> HTTPS/Caddy n'a pas pu être exécuté dans l'environnement de développement (pas de Docker) : fichiers vérifiés statiquement ; **faites un essai sur votre poste**. La sauvegarde `pg_dump`/restauration a été rejouée sur un PostgreSQL 16 réel (voir `docs/PREPARATION_PRODUCTION.md`). Limiteur de connexion en mémoire et conditions de sécurité du proxy : `docs/PREPARATION_PRODUCTION.md` §7.

## HTTPS (indispensable hors `localhost`)
Les navigateurs n'autorisent la caméra (scan du QR) et la géolocalisation que sur une origine sécurisée : `https://…` ou `localhost`. En `http://192.168.x.x`, le pointage par QR et le GPS ne fonctionneront pas.

1. Dans `.env`, ajoutez `FANN_HOSTNAME=` suivi du nom DNS interne ou de l'adresse IP du serveur (ex. `192.168.1.20`).
2. Démarrage : `docker compose -f compose.yaml -f compose.https.yaml up -d`
3. Laissez `APP_BIND_ADDRESS` à `127.0.0.1` : seul le proxy est exposé (port 443). Limitez-le au réseau interne par le pare-feu.
4. Faites confiance au certificat racine du proxy sur chaque poste et téléphone :
   `docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./fann-racine.crt`, puis installez ce fichier comme autorité de confiance.
5. Le proxy renseigne `X-Forwarded-For` et active `TRUST_PROXY=1` : le limiteur de tentatives compte alors chaque poste séparément au lieu de bloquer tout le monde ensemble.

**Dépannage — « La connexion de ce site n'est pas sécurisée / réponse non valide »** (ou `curl` : `SEC_E_INTERNAL_ERROR`) alors que `docker compose ps` est sain : en saisissant une **adresse IP**, le navigateur n'envoie aucun nom de site (SNI) ; le `Caddyfile` fournit donc `default_sni {$FANN_HOSTNAME}` pour que Caddy présente le certificat de cette adresse. Vérifiez que `FANN_HOSTNAME` est la **vraie** adresse du serveur (`ipconfig`, carte Wi-Fi/Ethernet, pas celle de WSL) et testez avec `curl -vk https://ADRESSE` : une réponse `HTTP/1.1 200 OK` prouve que le proxy fonctionne. Windows : autoriser le port 443 (`New-NetFirewallRule … -LocalPort 443 -Profile Private`, PowerShell administrateur) et classer le réseau en « Privé ». Réservez l'adresse IP du serveur dans la box : si elle change, le certificat ne correspond plus.

## Sauvegardes
> Procédure complète, chiffrée et automatique vers le serveur : voir `docs/SAUVEGARDE_SERVEUR.md`.

- Créer une sauvegarde : `bash scripts/sauvegarde-postgres.sh` (dossier `sauvegardes/`, 14 copies conservées). Elle vérifie l'archive avant de la garder.
- Planifiez-la chaque nuit (Planificateur de tâches Windows) et **copiez le dossier hors du serveur** : un disque en panne emporte la base et ses sauvegardes.
- Restauration (testez-la d'abord sur une base vide, jamais pour la première fois un jour d'incident) :
  `docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < sauvegardes/fann-pointage-AAAAMMJJ-HHMMSS.dump`
  puis `npm run db:configure-app-role` pour rétablir les droits du compte applicatif.
- Les sauvegardes contiennent des données personnelles : stockez-les chiffrées et à accès restreint.

## Journal des connexions
Chaque connexion réussie ou échouée est écrite dans `journal_audit` (jamais l'identifiant saisi, seulement l'id d'un compte existant et l'adresse IP) :
`docker compose exec -T db psql -U fann_admin -d fann_pointage -c "SELECT at, action, user_id, ip FROM journal_audit WHERE action LIKE 'connexion%' ORDER BY at DESC LIMIT 20;"`
