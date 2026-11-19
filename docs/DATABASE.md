# Base de données et migrations

## Appliquer les migrations

Base PostgreSQL 15+ ou projet Supabase de préproduction. Depuis Git Bash, Linux ou macOS :

```bash
for f in supabase/migrations/*.sql; do
  echo "Application de $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || exit 1
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

Le seed insère des services fictifs et les pondérations initiales des scores. Le test SQL doit être exécuté **uniquement dans une base jetable** ; il termine par `ROLLBACK` :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/001_contraintes.sql
```

Ces commandes ne raccordent pas à elles seules l'API de démonstration à PostgreSQL.

## Protections principales prévues

- Un planning doit correspondre à l'affectation validée de l'agent ; les durées des postes sont contrôlées et aucun chevauchement par agent n'est autorisé.
- Le régime de chaque nouveau service doit être choisi explicitement.
- Les pointages sont prévus pour être écrits par le serveur, avec une clé d'idempotence ; la vue `v_pointages` masque les coordonnées selon le rôle.
- Les tables `parametres_scores`, `scores_mensuels` et `classements_mensuels` enregistrent les pondérations, scores sur 100, classement complet et Top 5. Les classements mensuels sont uniques par mois ; leur photographie est immuable et leur écriture est réservée au serveur.
- Le journal d'audit est conçu en ajout seul et alimenté par des triggers. Il peut contenir des données de pointage sensibles : la conservation et l'accès doivent être encadrés.

## Limites connues

- Les migrations n'ont pas été exécutées sur un serveur PostgreSQL dans cet environnement. Les contrôles lancés dans Node sont statiques uniquement.
- Les politiques RLS nécessitent des essais de bout en bout avec plusieurs rôles et services.
- Le dépôt de l'API reste en mémoire : appliquer le schéma ne rend pas automatiquement les routes persistantes. Le dépôt PostgreSQL, la gestion transactionnelle et le raccordement de l'authentification doivent être réalisés et testés avant toute donnée réelle.
- Les coordonnées de pointage doivent être collectées au moment du pointage uniquement, avec une politique explicite de conservation et une revue de conformité au Sénégal.
