# FANN POINTAGE v32d — responsivité et capacité de charge

## Responsivité

La couche `web/styles.css` v32d adapte la largeur du contenu jusqu'à 1 440 px, les cartes KPI, les formulaires, la navigation, les tableaux défilants et les dialogues. Les points de rupture ciblent notamment 900 px, 680 px et 420 px. Les règles `@media print` des badges et feuilles d'émargement ne sont pas modifiées par cette couche.

Le cache PWA passe à `fann-pointage-v44` : les appareils re-téléchargent les fichiers de l'interface après déploiement. Les réponses API ne sont jamais ajoutées au cache PWA.

## Efficacité serveur

- Les fichiers statiques sont conservés dans un cache LRU mémoire limité à 4 Mio par processus. Leur ETag est calculé une seule fois par version du fichier ; les réponses conditionnelles renvoient `304`.
- Caddy continue de compresser les réponses avec zstd/gzip.
- Le pool PostgreSQL a un maximum explicite de connexions, des délais de connexion/inactivité, une durée maximale de requête SQL, un délai de verrou et une coupure des transactions inactives.
- La migration additive `0027_indexes_performance_operational` ajoute des index ciblés pour les plannings actifs par service et l’historique des affectations agent. Les index composites des historiques de pointage existaient déjà et sont réutilisés. Elle ne supprime ni ne réécrit les données métier.
- Les limites CPU/RAM Docker sont réglables avec `APP_MEMORY_LIMIT`, `APP_CPU_LIMIT`, `DB_MEMORY_LIMIT`, `DB_CPU_LIMIT`, `DB_SHM_SIZE`, `MIGRATE_MEMORY_LIMIT` et `MIGRATE_CPU_LIMIT`.

## Dimensionnement prudent

Les valeurs `.env.example` sont des plafonds indicatifs (app 384 Mio, PostgreSQL 1 Gio, un CPU chacun), pas une garantie de capacité. À mesurer sur le VPS réel : RAM disponible, CPU, latence SQL, taille des tables, nombre de connexions et temps de réponse lors d'un pic de pointage. Ajuster progressivement les variables puis observer `docker stats` et `pg_stat_activity`.

`PG_POOL_MAX` doit être dimensionné en fonction des connexions PostgreSQL disponibles. Formule de prudence : somme des `PG_POOL_MAX` de toutes les instances + pools de migration + supervision < `max_connections` de PostgreSQL, en gardant une réserve pour les opérations d'administration. Ne pas augmenter cette valeur uniquement pour « accélérer » l'application.

## Limite actuelle de réplication

**Une seule instance `app` reste requise.** Le limiteur de tentatives de connexion est encore conservé dans la mémoire du processus. Plusieurs instances auraient des compteurs séparés et affaibliraient la protection contre les tentatives réparties. La mise à l'échelle horizontale nécessite d'abord un limiteur partagé (PostgreSQL ou Redis), puis des tests de concurrence et de reprise. Ne pas utiliser `--scale app=N` ni `deploy.replicas` avant cette évolution.

Le cache statique, les index et le pool améliorent la capacité d'une instance, mais ne remplacent pas un test de charge. Avant d'annoncer une capacité à un nombre précis d'agents, réaliser un test représentatif sur une base de recette et un VPS de caractéristiques identiques à la production.

## Déploiement

La migration 0027 est exécutée automatiquement par le service `migrate` lors de `docker compose up -d`, avant le service `app`. Ne pas supprimer les volumes. Après déploiement, contrôler `docker compose ps`, `/readyz`, les journaux de migration, les scans QR et les mises en page sur plusieurs appareils.
