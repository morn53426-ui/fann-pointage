# Tests réels PostgreSQL — FANN POINTAGE

## Lancer les tests

Prérequis : Docker Desktop installé et démarré, puis Node.js 22.23.4 ou supérieur.

Depuis le dossier du projet :

```bash
npm run test:postgres
```

Le script utilise un Compose et un volume **temporaires**, non partagés avec l'application :

1. construit PostgreSQL 17 et applique les migrations 0001 à 0011 ainsi que le seed fictif ;
2. exécute `supabase/tests/001_contraintes.sql` avec `ON_ERROR_STOP` ;
3. crée deux connexions concurrentes tentant d'utiliser le même QR et vérifie que l'une seule réussit ;
4. vérifie qu'un seul pointage et une seule consommation QR survivent à cette course ;
5. insère un marqueur, redémarre PostgreSQL et vérifie que le marqueur est conservé ;
6. supprime le conteneur **et le volume de test** à la fin.

Le conteneur n'expose aucun port à l'hôte. Le mot de passe Compose est un secret de test jetable, pas un secret de production. Le script utilise un nom de projet dérivé du processus pour éviter de supprimer un volume de l'application.

## Limite importante

Ces tests valident le **schéma SQL PostgreSQL**, ses contraintes, le déclencheur d'utilisation QR et la conservation au redémarrage. Ils ne prouvent pas que les routes HTTP de FANN POINTAGE utilisent PostgreSQL : l'API livrée reste en mode démonstration avec stockage JSON local. Les tests du dépôt applicatif et de l'authentification PostgreSQL doivent venir après le raccordement du dépôt transactionnel à toutes les routes. Ne mettez aucune donnée réelle dans la base de test.
