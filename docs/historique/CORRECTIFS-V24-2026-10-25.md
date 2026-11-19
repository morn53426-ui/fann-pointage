> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctifs v24 — FANN POINTAGE (25 octobre 2026)

## Corrigé
- **Bug de couleur (écran « Choisissez votre mot de passe »)** : le style dégradé vert du formulaire de connexion s'appliquait aussi au bouton « Se déconnecter » (texte vert sur fond vert, illisible). Le bouton secondaire est maintenant blanc, bord et texte verts.
- **En-tête sur iPhone** : la zone de sécurité (encoche / barre d'état) est portée par l'en-tête vert, le titre ne passe plus sous l'horloge.
- **Libellé du mot de passe provisoire** : il ne dit plus « votre numéro de téléphone » (le code peut être aléatoire, `FANN_MDP_PROVISOIRE=aleatoire`). Il indique « celui remis par l'administration ».
- **Pointage dans le périmètre d'un autre service** : le serveur accepte désormais le pointage dès que la position est couverte par une zone active de l'hôpital, même si la zone est celle d'un autre service (QR ou pointage personnel). Le cas est tracé (`pointage_zone_autre_service`). Reste refusé : hors de toutes les zones, GPS refusé/imprécis/ancien, zone du QR désactivée.
- **QR imprimables par service, valables des mois** : QR permanent signé (HMAC, sans expiration, stable à chaque impression). Page « QR de pointage » → « Affiches QR permanentes par service » : une affiche A4 par zone, impression / PDF. Le QR ne prouve pas l'identité (compte obligatoire) ni la présence (GPS contrôlé par le serveur).
- Cache du service worker : v31 (les téléphones récupèrent le correctif).

## À savoir avant d'imprimer
- Le QR contient l'adresse de l'application. Utiliser l'adresse DÉFINITIVE (domaine fixe). Une adresse ngrok gratuite change : les affiches imprimées ne fonctionneraient plus.
- Révoquer une affiche : désactiver la zone. Révoquer toutes les affiches : changer `BADGE_SECRET` (invalide aussi les badges).
- Les QR permanents ne sont pas à usage unique : protection par GPS, intervalle minimal entre deux pointages, clé d'idempotence, séquence arrivée/départ.

## Vérifié
`tsc --noEmit` OK, 445 tests OK (nouveaux : `correctifs-v24.test.ts`, QR permanent et zones inter-services dans `service.test.ts` et `api.test.ts`), `node --check web/*.js`, `check:delivery:local`.
Non recetté ici : PostgreSQL réel (la requête `zonesActives` est simple mais à passer en recette), Playwright, téléphones.

## Complément (même jour)
- QR temporaire scanné alors que la position est couverte par la zone d'un autre service : le jeton n'est plus rattaché au pointage (le déclencheur PostgreSQL 0011 exigeait que la zone du pointage soit celle du QR et aurait rejeté l'enregistrement). Test ajouté.
- `docs/POINTAGE.md` aligné sur la nouvelle règle.
- IMPORTANT : le message « QR d'un autre service » venait de l'ancienne version. Il faut redémarrer le serveur avec cette archive (et vider le cache du téléphone / rouvrir l'appli).
