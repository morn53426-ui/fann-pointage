> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Phase 7 — Classement mensuel, audit et exports

## Fonctionnalités

L'API et l'écran « Classement mensuel » permettent :

1. consulter les scores et le classement d'un mois ;
2. afficher le Top 5 ;
3. générer une seule photographie du classement pour un mois entièrement terminé (action administrateur) ;
4. exporter en CSV les rangs et scores du mois, avec une protection contre l'injection de formules ;
5. journaliser la génération dans l'audit de démonstration.

L'API vérifie les rôles côté serveur. Les administrateurs peuvent générer le classement ; les administrateurs et responsables peuvent consulter les résultats. Les anciennes routes de gestion financière ne sont pas disponibles.

Le classement contient des scores et des rangs uniquement. Il n'existe pas de workflow de primes, de sommes à verser, de bénéficiaires financiers ou de références de paiement.

## Limites de production

- Les données et événements de démonstration sont conservés en mémoire ; ils disparaissent au redémarrage.
- L'API n'est pas raccordée au dépôt PostgreSQL malgré la présence des migrations du schéma.
- Les rôles doivent être rattachés à une authentification de production et les contrôles RLS doivent être testés sur une base réelle.
- Les exports CSV ne remplacent pas les essais avec les données et les procédures réelles de l'établissement.
