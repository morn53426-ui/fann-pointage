> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctif de démarrage — géorepérage facultatif

## Cause

Le fichier `compose.yaml` transmet un rayon par défaut (`ZONE_RAYON=150`) même lorsque `ZONE_LAT` et `ZONE_LNG` sont vides. La configuration de démonstration traitait auparavant ce rayon isolé comme une erreur fatale, ce qui faisait sortir Node avant d'écouter sur le port 8787 et causait `ERR_CONNECTION_REFUSED`.

## Correction

Le rayon n'a de sens que si les deux coordonnées sont fournies. Si elles sont toutes les deux absentes ou vides, le géorepérage est désactivé et le rayon est ignoré. Une seule coordonnée reste une erreur, de même que les coordonnées ou rayons hors limites lorsque la zone est activée.

## Après extraction

1. Conserver le fichier `.env` déjà présent et ses volumes Docker.
2. Reconstruire uniquement l'application : `docker compose up --build -d --force-recreate app`.
3. Vérifier `docker compose ps -a`, `docker compose logs --tail=60 app` puis `curl -i http://127.0.0.1:8787/healthz`.
4. Ne pas exécuter `docker compose down -v` : le volume PostgreSQL contient déjà un compte administrateur.

Le démarrage local en mode démo n'active pas PostgreSQL pour les routes métier.
