import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve('.env');
if (!existsSync(envPath)) throw new Error('.env absent. Exécutez npm run setup:env pour créer une configuration neuve.');
const original = readFileSync(envPath, 'utf8');
const values = new Map();
for (const line of original.split(/\r?\n/)) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (match) values.set(match[1], match[2]);
}
const get = (k, d = '') => values.has(k) ? values.get(k) : d;
const db = get('POSTGRES_DB', 'fann_pointage');
const adminUser = get('POSTGRES_USER', 'fann_admin');
const adminPass = get('POSTGRES_PASSWORD');
const port = get('POSTGRES_PORT', '54329');
if (!adminPass || /[\r\n]/.test(adminPass)) throw new Error('POSTGRES_PASSWORD absent ou invalide ; aucun changement n’a été effectué.');
if (get('POSTGRES_APP_USER', 'fann_app') !== 'fann_app') throw new Error('POSTGRES_APP_USER doit être fann_app ; aucun changement n’a été effectué.');
const appPass = get('POSTGRES_APP_PASSWORD') || randomBytes(32).toString('base64url');
// Reprendre l'ancien SESSION_SECRET lors de la première mise à niveau conserve les QR/badges déjà signés.
// Ensuite BADGE_SECRET est indépendant et stable même si les secrets de session sont renouvelés.
const oldSessionSecret = get('SESSION_SECRET');
const sessionSecret = oldSessionSecret && !oldSessionSecret.includes('replace_me') && /^[A-Za-z0-9_-]{32,}$/.test(oldSessionSecret) ? oldSessionSecret : randomBytes(48).toString('base64url');
const configuredBadgeSecret = get('BADGE_SECRET');
const badgeSecret = configuredBadgeSecret && !configuredBadgeSecret.includes('replace_me') ? configuredBadgeSecret : sessionSecret;
if (!/^[A-Za-z0-9_-]{32,}$/.test(badgeSecret)) throw new Error('BADGE_SECRET invalide ; aucun changement n’a été effectué.');
if (!/^[A-Za-z0-9_-]{32,}$/.test(appPass)) throw new Error('POSTGRES_APP_PASSWORD invalide ; aucun changement n’a été effectué.');
const oldDatabaseUrl = get('DATABASE_URL');
const adminUrl = get('DATABASE_ADMIN_URL') || oldDatabaseUrl;
if (!adminUrl) throw new Error('DATABASE_URL manquant : impossible de préserver la connexion administrateur pour les migrations.');
const appUrl = `postgresql://fann_app:${appPass}@127.0.0.1:${port}/${db}`;
const replacements = new Map([
  ['POSTGRES_DB', db], ['POSTGRES_USER', adminUser], ['POSTGRES_APP_USER', 'fann_app'],
  ['POSTGRES_APP_PASSWORD', appPass], ['POSTGRES_PORT', port], ['DATABASE_URL', appUrl],
  ['FANN_MODE', 'postgres-catalogue'],
  ['BADGE_SECRET', badgeSecret],
  ['DATABASE_ADMIN_URL', adminUrl], ['SESSION_SECRET', sessionSecret],
]);
const replaced = new Set();
const lines = original.split(/\r?\n/).map((line) => {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (!match || !replacements.has(match[1])) return line;
  replaced.add(match[1]);
  return `${match[1]}=${replacements.get(match[1])}`;
});
for (const [key, value] of replacements) if (!replaced.has(key)) lines.push(`${key}=${value}`);
const backup = `${envPath}.backup-runtime-role-${new Date().toISOString().replace(/[:.]/g, '-')}`;
writeFileSync(backup, original, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
const temporary = `${envPath}.tmp`;
writeFileSync(temporary, lines.join('\n').replace(/\n*$/, '\n'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
renameSync(temporary, envPath);
console.log(`Configuration mise à jour. Sauvegarde conservée dans ${backup}.`);
console.log('FANN_MODE est réglé sur postgres-catalogue pour éviter de démarrer silencieusement les données de démonstration.');
console.log('DATABASE_URL utilise maintenant fann_app ; DATABASE_ADMIN_URL conserve la connexion d’administration locale.');
console.log('BADGE_SECRET est conservé séparément : ne le changez pas lors d’une rotation de SESSION_SECRET, sinon les badges actifs devraient être réémis.');
console.log('Sur une base existante, exécutez npm run db:configure-app-role avant de relancer Docker Compose.');
