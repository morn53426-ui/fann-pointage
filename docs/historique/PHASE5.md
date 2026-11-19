> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Phase 5 — Tableau de bord, anomalies, rapports, API et PWA

## Lancer la démonstration (données fictives, en mémoire)

```bash
npm run demo
PORT=8800 DEMO_MOT_DE_PASSE=mon-mot-de-passe npm run demo
# Exposition explicite sur le réseau local uniquement pour un test contrôlé :
HOST=0.0.0.0 ZONE_LAT=14.6928 ZONE_LNG=-17.4467 npm run demo
```

Ouvrir `http://localhost:8787` (ou le port configuré). Comptes de démonstration : `admin`, `responsable`, `agent-n1`, `agent-u1`, `agent-g1`. Le mot de passe partagé est fourni via `DEMO_MOT_DE_PASSE` et n'est plus affiché dans les journaux.

La démonstration ajoute un historique de pointages fictifs du mois précédent pour tester le classement mensuel. Les données simulées sont réservées aux tests et ne doivent pas être mélangées à des données réelles.

## Fonctionnalités présentes

- Tableau de bord avec indicateurs séparés par régime, repos, retards, pointages incomplets, tentatives hors zone, précision et anomalies.
- Gestion des anomalies : absence à confirmer, incomplet, retard, départ anticipé, hors zone, position suspecte et vérification manuelle motivée.
- Rapports par jour, semaine ou mois, synthèse par agent et export CSV protégé contre les formules.
- API HTTP de démonstration : authentification limitée, sessions signées, vérification des droits côté serveur, en-têtes de sécurité et réponses d'erreur sans détails techniques.
- PWA en français : connexion, pointage, scan caméra si disponible, historique, tableau de bord, rapports, QR dynamique et liens de secours copiables.
- Classement mensuel par points avec scores, classement complet, Top 5 et export CSV.

## Limites connues

- La PWA, le QR, la géolocalisation et la caméra doivent être essayés sur de vrais appareils ; la géolocalisation et l'installation PWA sur téléphone exigent HTTPS (sauf `localhost`).
- Les exports Excel/PDF natifs ne sont pas livrés ; le CSV peut être ouvert dans Excel.
- Les écrans complets d'administration des agents, services, plannings, zones et comptes ne sont pas tous disponibles.
- Les données restent en mémoire et sont effacées à l'arrêt ; l'API de démonstration n'est pas un service de production.
