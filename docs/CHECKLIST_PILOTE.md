# Check-list du pilote (1 à 2 services, 1 à 2 semaines) — à imprimer

Version cible : `0.2.0-preproduction.47` — utilisez une révision validée de la branche de correction, avec une CI entièrement verte. Cette check-list ne vaut pas autorisation de déploiement : le CHNU Fann doit approuver le pilote.

Service pilote : ____________________  Responsable : ____________________  Début : ___ / ___ / 2026

## A. Avant de commencer (IT)
- [ ] `docker compose ps` : `app` et `db` en `healthy` ; `curl http://127.0.0.1:PORT/readyz` → `ready`
- [ ] `npm run env:reparer -- --separer-badge` exécuté (avant tout vrai badge), puis `docker compose up -d app`
- [ ] HTTPS actif, certificat installé sur les téléphones et postes du pilote
- [ ] Zone de pointage renseignée (ZONE_LAT / ZONE_LNG / ZONE_RAYON) et testée sur place
- [ ] Sauvegarde exécutée à la main avec succès **sur les deux destinations**, restauration de test réussie
- [ ] `backup.key` copiée sur une clé USB gardée en lieu sûr
- [ ] Supervision installée (`FANN-Surveillance`) et alerte testée
- [ ] Mot de passe administrateur fort, compte de secours créé

## B. Données
- [ ] Les agents du service pilote ont le bon service et le bon régime (garde, urgences, général)
- [ ] Plannings réels saisis ; jours fériés déclarés
- [ ] Comptes responsables créés (un par responsable)
- [ ] Un badge imprimé en vrai : recto lisible (prénom, nom, profession, photo), QR scannable à 30 cm

## C. Tests sur le terrain (téléphones réels)
- [ ] Pointage arrivée dans la zone : accepté, heure serveur affichée
- [ ] Pointage hors zone : refusé avec la procédure affichée
- [ ] Pointage sans réseau puis synchronisation : « à vérifier » puis validé par le responsable
- [ ] Poste partagé : badge scanné, arrivée puis départ, double scan refusé
- [ ] Garde de 24 h : l'agent reste connecté toute la garde
- [ ] Badge perdu : révocation et réémission testées
- [ ] Compte bloqué après 5 échecs : l'administrateur le débloque (Comptes utilisateurs → Débloquer la connexion)

## D. Formation des responsables
- [ ] Validation manuelle avec motif obligatoire
- [ ] Absences : à confirmer, décision motivée
- [ ] Un badge est un secret : que faire en cas de perte ou de photo du badge

## E. Suivi quotidien pendant le pilote
| Date | App OK | Sauvegarde OK | Incident / remarque | Visa |
|---|---|---|---|---|
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |

## F. Décision de fin de pilote
- [ ] Aucun incident bloquant non résolu
- [ ] Données personnelles : décision de la direction écrite
- [ ] Autorisation d'étendre aux autres services : ____________________  Date : ___ / ___ / 2026
