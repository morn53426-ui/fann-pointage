#!/usr/bin/env bash
# Construit et démarre FANN POINTAGE sur le VPS, crée le compte « admin » s'il est absent, puis contrôle la santé.
# Usage : bash scripts/vps/03-demarrer.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DC="docker compose -f compose.yaml -f compose.vps.yaml"

[ -f .env ] || { echo "Fichier .env absent : lancez d'abord scripts/vps/02-generer-env.sh." >&2; exit 1; }
lire() { grep -m1 "^$1=" .env | cut -d= -f2-; }
domaine="$(lire FANN_HOSTNAME)"; port="$(lire APP_PORT)"; port="${port:-8787}"
[ -n "$domaine" ] || { echo "FANN_HOSTNAME est vide dans .env." >&2; exit 1; }
for v in POSTGRES_PASSWORD POSTGRES_APP_PASSWORD SESSION_SECRET BADGE_SECRET; do
  case "$(lire $v)" in ''|*replace_me*) echo "$v n'est pas renseigné correctement dans .env." >&2; exit 1;; esac
done

# Avertissement (non bloquant) : le DNS doit pointer vers ce serveur, sinon Let's Encrypt échouera.
ip_dns="$(getent ahostsv4 "$domaine" 2>/dev/null | awk 'NR==1{print $1}' || true)"
ip_srv="$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"
if [ -n "$ip_dns" ] && [ -n "$ip_srv" ] && [ "$ip_dns" != "$ip_srv" ]; then
  echo "ATTENTION : $domaine pointe vers $ip_dns, mais ce serveur a l'IP $ip_srv. Corrigez le DNS avant d'attendre le certificat." >&2
elif [ -z "$ip_dns" ]; then
  echo "ATTENTION : $domaine ne se résout pas encore en DNS. Le certificat ne pourra pas être obtenu tant que l'enregistrement A n'existe pas." >&2
fi

echo "==> Construction des images"
$DC build app migrate
echo "==> Démarrage"
$DC up -d

echo "==> Attente de l'application (jusqu'à 4 minutes)"
ok=0
for _ in $(seq 1 48); do
  if curl -fsS "http://127.0.0.1:${port}/readyz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done
if [ "$ok" -ne 1 ]; then
  echo "L'application n'est pas prête. Diagnostic :" >&2
  $DC ps -a >&2
  $DC logs --tail=60 migrate app >&2
  exit 1
fi
echo "Application prête (readyz = 200)."

echo "==> Compte administrateur « admin » (créé seulement s'il est absent)"
ADMIN_INITIAL_MOT_DE_PASSE="$(lire ADMIN_INITIAL_MOT_DE_PASSE)"
export ADMIN_INITIAL_MOT_DE_PASSE
# Le mot de passe est transmis par l'environnement du processus (-e sans valeur), jamais en ligne de commande.
$DC exec -T -e ADMIN_INITIAL_MOT_DE_PASSE app node --experimental-strip-types src/api/creer-admin-postgres.ts admin --si-absent

echo "==> Contrôle HTTPS public (le certificat peut demander une minute)"
https=0
for _ in $(seq 1 12); do
  if curl -fsS --max-time 10 "https://${domaine}/healthz" >/dev/null 2>&1; then https=1; break; fi
  sleep 10
done
if [ "$https" -eq 1 ]; then
  echo "OK : https://${domaine} répond avec un certificat valide."
else
  echo "HTTPS pas encore opérationnel. Vérifiez le DNS, les ports 80/443 et : $DC logs --tail=50 proxy" >&2
fi
echo "Connexion : https://${domaine}   (compte admin ; mot de passe = ADMIN_INITIAL_MOT_DE_PASSE dans .env)"
