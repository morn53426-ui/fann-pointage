# Phase 9 — Préparation du déploiement

## État actuel (0.2.0-preproduction.44)

Docker : image applicative non-root, port local uniquement par défaut, healthcheck, limites de ressources, service `migrate` et base PostgreSQL. Voir [`DOCKER.md`](DOCKER.md). **L’API utilise PostgreSQL** (`FANN_MODE=postgres-catalogue`, point d’entrée `src/api/main-postgres-catalogue.ts`) : agents, services, pointages, plannings, badges, zones/QR, absences, rapports, classements, messagerie. Le mode `demo` (magasin en mémoire) n’est qu’une démonstration fictive.

Le dépôt contient une PWA en français, son manifeste, un service worker et un encodeur QR local. L’authentification est persistante (comptes scrypt, sessions signées). Les migrations ont été exercées sur PostgreSQL lors de la recette v18 ; elles doivent être rejouées sur le poste de déploiement. Les essais sur téléphone, GPS, HTTPS et impression restent à faire.

Procédure unique de mise en service : `DEMARRER-ICI-WINDOWS.md` (postes Windows), `docs/DEPLOIEMENT_VPS.md` (serveur public) et `docs/PREPARATION_PRODUCTION.md` (recette). En exploitation réelle, définir `FANN_ENV=production`.

## Liste de contrôle avant pilote

### Produit et règles

- [ ] faire valider par écrit les trois régimes, les horaires de poste et de repos, les jours fériés et toutes les exceptions ;
- [ ] faire approuver les critères et pondérations du score ainsi que les règles de départage du classement mensuel ;
- [ ] faire valider le parcours des absences et anomalies par l'administration ;
- [ ] créer un compte par utilisateur avec le rôle minimal nécessaire et interdire les comptes partagés ;
- [ ] former les responsables et conserver une procédure de secours manuelle.

### Données et sécurité

- [ ] implémenter puis raccorder toutes les routes à un dépôt PostgreSQL transactionnel de production (le profil Docker PostgreSQL fourni initialise uniquement le schéma et ne rend pas l'API persistante) ;
- [ ] appliquer les migrations `0001` à `0011` sur une base de préproduction neuve et exécuter `supabase/tests/001_contraintes.sql` sur une base jetable ;
- [ ] remplacer l'authentification de démonstration par un fournisseur validé, raccorder les profils, garder les clés privilégiées exclusivement côté serveur ;
- [ ] vérifier les politiques RLS avec de vrais jetons de chaque rôle, y compris les accès directs à la base ;
- [ ] tester les écritures idempotentes, les conflits de planning et l'audit en ajout seul ;
- [ ] définir le responsable de traitement, les finalités, la base juridique, les durées de conservation, les droits des personnes et la procédure d'incident ; obtenir une revue de conformité au Sénégal avant de collecter des positions ;
- [ ] limiter la collecte GPS au nécessaire et ne pas activer de localisation continue ;
- [ ] configurer TLS/HTTPS, secrets aléatoires, proxy de confiance, limitation des requêtes, journaux sans secrets et rotation des secrets.

### Base, sauvegardes et surveillance

- [ ] choisir un hébergement disponible, dimensionné, avec région, support et coût adaptés à un hôpital ;
- [ ] automatiser des sauvegardes chiffrées et tester régulièrement une restauration complète ;
- [ ] définir les objectifs de perte maximale de données (RPO) et de reprise (RTO) ;
- [ ] surveiller les erreurs 5xx, l'espace disque, les connexions, la dérive d'horloge et les erreurs de tâches planifiées ;
- [ ] n'ajouter une tâche de génération automatique que lorsque le service de calcul est persistant, idempotent et couvert par des essais de reprise.

### Téléphones et exploitation

- [ ] tester sur les appareils réellement utilisés à Fann (Android/Chrome et iPhone/Safari) ;
- [ ] vérifier l'installation PWA, le QR, les permissions, les interruptions réseau et les appareils à faible mémoire ;
- [ ] calibrer les rayons GPS sur site et définir la vérification manuelle lorsque le bâtiment rend la position imprécise ;
- [ ] réaliser un test de charge et un pilote restreint avec des données fictives ;
- [ ] nommer le support technique et documenter la procédure de pointage en cas de panne.

## Exécution locale (données fictives uniquement)

```bash
npm install
npm test
npm run typecheck
npm run test:security
npm run demo
```


## Poste partagé et mode hors ligne (prototype)

- Préparer un ordinateur/tablette dédié au service et imprimer les badges de démonstration depuis **Badges à imprimer**. Les QR imprimés contiennent des codes à scanner dans la vue **Poste partagé** ; le badge ne constitue pas une authentification cryptographique.
- Aucun téléphone personnel des agents n'est nécessaire. Utiliser une caméra autorisée, un lecteur QR USB ou une saisie du code sur le poste commun.
- Le mode hors ligne de l'interface suppose que l'application a déjà été chargée et que le responsable est encore authentifié dans cet onglet. La file IndexedDB est propre au navigateur/appareil, pas au serveur ; garder un registre papier de secours.
- Une fois le réseau revenu, synchroniser, puis vérifier chaque événement hors ligne et ajouter un motif de validation. Les événements en attente ne doivent pas compter dans les indicateurs de présence ni le classement. L'horodatage capturé par l'appareil devient utilisable dans les calculs uniquement après validation manuelle ; l'heure de réception serveur reste conservée séparément.
- Le mode démonstration (`FANN_MODE=demo`) n'est pas une solution de production : comptes et plannings fictifs, badges de démonstration. N'y mettez aucune donnée personnelle réelle. Le mode `postgres-catalogue` est le mode opérationnel (préproduction, recette obligatoire).


## Géorepérage GPS en mode démonstration

Les variables `ZONE_LAT`, `ZONE_LNG` et `ZONE_RAYON` de `.env` sont maintenant transmises au conteneur applicatif. Les deux coordonnées doivent être renseignées ensemble, en degrés décimaux, et le rayon en mètres. Si les coordonnées restent vides, `ZONE_RAYON` peut rester défini dans `.env` : il est ignoré et le géorepérage reste désactivé. Pour un essai à l'hôpital, les coordonnées et le rayon doivent être validés sur place par un responsable autorisé.

Si `ZONE_LAT` et `ZONE_LNG` restent vides, le serveur conserve une zone fictive par défaut : **cela ne valide pas le GPS réel**. Ne publiez pas le tunnel ngrok pour un usage opérationnel et ne saisissez pas de données personnelles réelles dans cette version de démonstration.
