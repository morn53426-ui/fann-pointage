#!/usr/bin/env bash
# Génère le fichier .env de production avec des secrets aléatoires (aucun secret n'est affiché).
# Usage : bash scripts/vps/02-generer-env.sh <nom.de.domaine> <email-pour-letsencrypt>
# Variable facultative : ADMIN_INITIAL_MOT_DE_PASSE (sinon un mot de passe aléatoire de 24 caractères est généré).
set -euo pipefail
cd "$(dirname "$0")/../.."

domaine="${1:-}"; courriel="${2:-}"
[ -n "$domaine" ] && [ -n "$courriel" ] || { echo "Usage : $0 <nom.de.domaine> <email>" >&2; exit 2; }
[[ "$domaine" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || { echo "Nom de domaine invalide." >&2; exit 2; }
[[ "$courriel" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo "Adresse e-mail invalide." >&2; exit 2; }
[ ! -e .env ] || { echo "Le fichier .env existe déjà : aucun changement (ce script n'écrase jamais une configuration)." >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl est requis." >&2; exit 1; }

# base64url sans remplissage : accepté par les contrôles de l'application (URL-safe).
secret() { openssl rand -base64 "$(( $1 * 3 / 4 + 3 ))" | tr '+/' '-_' | tr -d '=\n' | cut -c1-"$1"; }

pg_admin="$(secret 43)"; pg_app="$(secret 43)"
mdp_admin="${ADMIN_INITIAL_MOT_DE_PASSE:-$(secret 24)}"
[[ "$mdp_admin" != *$'\n'* ]] || { echo "Mot de passe administrateur invalide (retour à la ligne)." >&2; exit 2; }
# Même règle que l'application (src/api/mot-de-passe.ts) : sinon la création du compte « admin » échouerait après le démarrage.
[ "${#mdp_admin}" -ge 9 ] || { echo "Le mot de passe administrateur doit contenir au moins 9 caractères." >&2; exit 2; }
[ "$(printf '%s' "$mdp_admin" | fold -w1 | sort -u | wc -l)" -ge 4 ] || { echo "Mot de passe administrateur trop prévisible (au moins 4 caractères différents)." >&2; exit 2; }

umask 077
cat > .env <<ENV
# FANN POINTAGE — configuration VPS générée le $(date +%F). NE JAMAIS partager ni versionner ce fichier.
# Sauvegardez-le (chiffré) : sans BADGE_SECRET identique, les badges déjà imprimés deviennent invalides.
FANN_MODE=postgres-catalogue
FANN_HOSTNAME=$domaine
ACME_EMAIL=$courriel
HOST=0.0.0.0
PORT=8787
APP_BIND_ADDRESS=127.0.0.1
APP_PORT=8787
TRUST_PROXY=1
DEMO_MOT_DE_PASSE=$(secret 32)

# Zone de pointage : renseignez les coordonnées GPS réelles de l'hôpital (les deux sont nécessaires), sinon le géorepérage est désactivé.
ZONE_LAT=
ZONE_LNG=
ZONE_RAYON=150

POSTGRES_DB=fann_pointage
POSTGRES_USER=fann_admin
POSTGRES_PASSWORD=$pg_admin
POSTGRES_APP_USER=fann_app
POSTGRES_APP_PASSWORD=$pg_app
POSTGRES_PORT=54329
DATABASE_URL=postgresql://fann_app:$pg_app@127.0.0.1:54329/fann_pointage
DATABASE_ADMIN_URL=postgresql://fann_admin:$pg_admin@127.0.0.1:54329/fann_pointage

SESSION_SECRET=$(secret 64)
BADGE_SECRET=$(secret 64)
ADMIN_INITIAL_MOT_DE_PASSE=$mdp_admin

PG_POOL_MAX=10
PG_CONNECT_TIMEOUT_MS=5000
PG_IDLE_TIMEOUT_MS=30000
PGSSL=

# Sauvegardes (voir scripts/vps/sauvegarde-chiffree.sh) : destination rsync/SSH facultative, ex. sauvegarde@serveur:/srv/fann
BACKUP_RSYNC_DEST=
ENV
chmod 600 .env
echo ".env créé (droits 600) pour $domaine."
echo "Étape suivante : renseignez ZONE_LAT / ZONE_LNG dans .env, puis lancez scripts/vps/03-demarrer.sh"
echo "Le mot de passe administrateur se lit dans .env (ADMIN_INITIAL_MOT_DE_PASSE) ; il n'est pas affiché ici."
