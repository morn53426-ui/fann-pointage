# Check-list du pilote (1 à 2 services, 1 à 2 semaines) — à imprimer

Version cible : `0.2.0-preproduction.47` — branche de consolidation `integration/preproduction-hardening`, proposée par la PR #5 vers `main`. N'utilisez cette révision que lorsque la CI combinée du commit exact est entièrement verte et que la PR a été relue/approuvée. Cette check-list ne vaut pas autorisation de déploiement : le CHNU Fann doit approuver le pilote.

Service pilote : ____________________  Responsable : ____________________  Début : ___ / ___ / 2026

## A. Avant de commencer (IT)
- [ ] Version de préproduction et révision Git vérifiées ; CI complète verte pour la révision déployée.
- [ ] Une archive récente a été restaurée sur un clone isolé ; le clone a migré jusqu'à `0027`, puis un deuxième passage confirme l'idempotence.
- [ ] `docker compose ps -a` : `db` et `app` sains ; le service ponctuel `migrate` termine avec le code 0 ; `/readyz` répond 200.
- [ ] `fann_app` est le rôle runtime ; vérifier qu'il ne peut ni exécuter du DDL ni supprimer les journaux d'audit.
- [ ] `npm run env:reparer -- --separer-badge` exécuté uniquement si la configuration l'exige et avant l'émission des vrais badges ; préserver le `BADGE_SECRET` déjà utilisé pour les badges actifs.
- [ ] HTTPS actif, certificat installé et reconnu sur les téléphones et postes du pilote.
- [ ] Zone de pointage renseignée (`ZONE_LAT` / `ZONE_LNG` / `ZONE_RAYON`) avec coordonnées validées, puis testée sur place.
- [ ] Sauvegarde manuelle réussie ; copie distante vérifiée. Pour les scripts Linux/VPS, l'archive V2 doit passer le contrôle HMAC et le test de restauration ; pour Windows, suivre séparément `docs/SAUVEGARDE_SERVEUR.md`.
- [ ] Clé de déchiffrement copiée hors du serveur et conservée séparément des archives (Linux/VPS : `~/.fann-backup.key` ; Windows : fichier `backup.key` documenté).
- [ ] Supervision installée et alerte d'échec de sauvegarde testée.
- [ ] Mot de passe administrateur fort, comptes de secours identifiés et accès contrôlés.

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
