> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Phase 6 — Calcul des points et classement mensuel

## Fonctionnalités

Le moteur de domaine se trouve dans `src/classement/` :

- `types.ts` définit les mesures mensuelles, règles, scores et photographie du classement ;
- `regles.ts` définit les pondérations et l'ordre de départage ;
- `moteur.ts` calcule un score sur 100 et un ordre déterministe ;
- `classement.ts` produit un classement mensuel complet et extrait les cinq premiers ;
- `export.ts` exporte un CSV protégé contre l'injection de formules.

Les pondérations initiales sont : présence 40 points, ponctualité 20, absences injustifiées confirmées 15, pointages complets 10, anomalies 10 et pointages hors zone 5. Ces règles sont des paramètres de démonstration à faire valider avant un usage officiel.

Chaque génération conserve les scores disponibles, l'ordre complet, la version des règles et le **Top 5**. Le classement est déterministe : les critères de départage sont appliqués dans l'ordre configuré, puis l'identifiant d'agent sert de dernier critère stable. Si moins de cinq agents sont disponibles, le Top 5 contient ceux qui existent ; si cinq agents ou plus existent, il en présente cinq.

Aucune prime, somme à verser, liste de bénéficiaires, référence de paiement ou validation financière n'est calculée ou enregistrée par le logiciel. Le résultat est uniquement un score, un rang et un export CSV de classement.

Une absence « à confirmer » n'est pas convertie automatiquement en absence injustifiée. Le traitement de données de production doit agréger les absences qui ont réellement été vérifiées et confirmées par un responsable.

## Limites avant production

- L'API de démonstration conserve le classement en mémoire ; un redémarrage supprime les données. Le schéma PostgreSQL des scores et classements est préparé, mais le dépôt PostgreSQL n'est pas encore branché à l'API.
- La génération est une action explicite d'administrateur pour un mois entièrement terminé, avec un seul classement par mois.
- Les règles et pondérations doivent être approuvées par l'administration avant tout usage officiel.
