import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = resolve(root, '.env');

if (existsSync(target)) {
  console.error('Le fichier .env existe déjà : aucun changement effectué.');
  console.error('Par sécurité, ce script ne remplace jamais une configuration existante.');
  process.exit(1);
}

const secret = (bytes = 32) => randomBytes(bytes).toString('base64url');
const postgresDb = 'fann_pointage';
const postgresUser = 'fann_admin';
const postgresPassword = secret(32);
const postgresAppUser = 'fann_app';
const postgresAppPassword = secret(32);
const postgresPort = 54329;
const lines = [
  '# FANN POINTAGE - configuration locale générée automatiquement',
  '# Ne partagez jamais ce fichier et ne le commitez pas.',
  'FANN_MODE=postgres-catalogue',
  'FANN_MDP_PROVISOIRE=aleatoire',
  `DEMO_MOT_DE_PASSE=${secret(32)}`,
  'HOST=127.0.0.1',
  'PORT=8787',
  'APP_BIND_ADDRESS=127.0.0.1',
  'APP_PORT=8787',
  'TRUST_PROXY=0',
  'ZONE_LAT=',
  'ZONE_LNG=',
  'ZONE_RAYON=150',
  `POSTGRES_DB=${postgresDb}`,
  `POSTGRES_USER=${postgresUser}`,
  `POSTGRES_PASSWORD=${postgresPassword}`,
  `POSTGRES_APP_USER=${postgresAppUser}`,
  `POSTGRES_APP_PASSWORD=${postgresAppPassword}`,
  `POSTGRES_PORT=${postgresPort}`,
  `DATABASE_URL=postgresql://${postgresAppUser}:${postgresAppPassword}@127.0.0.1:${postgresPort}/${postgresDb}`,
  `DATABASE_ADMIN_URL=postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${postgresDb}`,
  `SESSION_SECRET=${secret(48)}`,
  `BADGE_SECRET=${secret(48)}`,
  `ADMIN_INITIAL_MOT_DE_PASSE=${secret(32)}`,
  'PG_POOL_MAX=10',
  'PG_CONNECT_TIMEOUT_MS=5000',
  'PG_IDLE_TIMEOUT_MS=30000',
  'PGSSL=',
  '',
];

writeFileSync(target, lines.join('\n'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
console.log('Fichier .env créé avec des secrets aléatoires distincts pour la base, l’application, les sessions et la signature durable des badges.');
console.log('Ne partagez pas ce fichier. Gardez les mots de passe dans ce dossier uniquement.');
console.log('Mode par défaut : FANN POINTAGE opérationnel avec PostgreSQL (agents, services, pointages, plannings, badges, classements, absences et rapports). Validez les modules sur une vraie base de recette avant la production. Pour la démo fictive, définir FANN_MODE=demo dans .env.');
