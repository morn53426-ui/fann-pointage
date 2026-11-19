import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'fann-backup-restore-e2e-'));
await chmod(temp, 0o700);

const token = randomBytes(8).toString('hex');
const container = `fann-restore-e2e-${token}`;
const image = `fann-restore-e2e:${token}`;
const restoreDatabase = `fann_restore_ci_${token}`;
const adminPassword = randomBytes(24).toString('base64url');
const appPassword = randomBytes(32).toString('base64url');
const fakeAgentId = randomUUID();
const sourceDatabase = 'fann_pointage_test';
const sourceUser = 'fann_test';
const realDocker = findExecutable('docker');
const fakeBin = join(temp, 'bin');
const cipherFile = join(temp, 'archive.tar.enc');
const keyFile = join(temp, 'backup.key');
const wrappedCipherFile = join(temp, 'archive.enc');
const archiveTar = join(temp, 'archive.tar');
const verifiedCipherFile = join(temp, 'verified-cipher.enc');
const verifiedTar = join(temp, 'verified.tar');
const wrapperFile = join(fakeBin, 'docker');

let containerStarted = false;
let imageBuilt = false;

function findExecutable(name) {
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(directory, name + extension.toLowerCase());
      try {
        const check = spawnSync(process.platform === 'win32' ? 'cmd' : 'test',
          process.platform === 'win32' ? ['/c', 'if', 'exist', candidate, 'exit', '/b', '0'] : ['-x', candidate],
          { stdio: 'ignore' });
        if (check.status === 0) return candidate;
      } catch { /* try the next PATH entry */ }
    }
  }
  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: options.encoding === null ? null : 'utf8',
    input: options.input,
    env: options.env || process.env,
    stdio: options.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    timeout: options.timeout || 120_000,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') throw new Error(`Commande introuvable : ${command}`);
    throw result.error;
  }
  if (!options.allowFailure && result.status !== 0) {
    const detail = options.inherit ? '' : `\n${result.stdout?.toString() || ''}\n${result.stderr?.toString() || ''}`;
    throw new Error(`Échec (${result.status}) : ${command} ${args.join(' ')}${detail}`);
  }
  return result;
}

function docker(args, options = {}) {
  return run(realDocker, args, options);
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    // pg_isready seul peut répondre trop tôt, avant la fin des scripts initdb.d.
    const probe = docker(['exec', container, 'psql', '-U', sourceUser, '-d', sourceDatabase, '-At', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT count(*) FROM app_schema_migrations WHERE version='0027_indexes_performance_operational'"], { allowFailure: true, timeout: 5_000 });
    if (probe.status === 0 && probe.stdout.trim() === '1') return;
    await wait(2_000);
  }
  const logs = docker(['logs', container], { allowFailure: true, timeout: 10_000 });
  throw new Error(`PostgreSQL temporaire n'a pas terminé son initialisation jusqu'à 0027.\n${logs.stdout || ''}\n${logs.stderr || ''}`);
}
function psql(database, sql, options = {}) {
  return docker([
    'exec', container, 'psql', '-U', sourceUser, '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql,
  ], options);
}

async function main() {
  if (!realDocker) throw new Error('Docker est requis pour la recette PostgreSQL isolée.');
  run(realDocker, ['--version']);

  console.log('[1/8] Construction du schéma PostgreSQL de test à partir des migrations du dépôt.');
  docker(['build', '-f', 'Dockerfile.postgres', '-t', image, '.'], { inherit: true, timeout: 8 * 60 * 1000 });
  imageBuilt = true;

  console.log('[2/8] Démarrage PostgreSQL sur tmpfs, sans volume Docker ni exposition réseau publique.');
  docker([
    'run', '-d', '--rm', '--name', container,
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,size=512m',
    '-p', '127.0.0.1::5432',
    '-e', `POSTGRES_DB=${sourceDatabase}`,
    `-e`, `POSTGRES_USER=${sourceUser}`,
    '-e', `POSTGRES_PASSWORD=${adminPassword}`,
    '-e', 'POSTGRES_APP_USER=fann_app',
    '-e', `POSTGRES_APP_PASSWORD=${appPassword}`,
    '-e', 'PGDATA=/var/lib/postgresql/data/pgdata',
    image,
  ]);
  containerStarted = true;
  await waitForPostgres();

  const mounts = docker(['inspect', '-f', '{{range .Mounts}}{{.Type}}:{{.Destination}} {{end}}', container]).stdout.trim();
  if (mounts.split(/\s+/).some((entry) => entry.startsWith('volume:'))) {
    throw new Error(`Refus de continuer : un volume Docker a été monté dans le conteneur temporaire (${mounts}).`);
  }
  if (!mounts.includes('tmpfs:/var/lib/postgresql/data')) {
    throw new Error(`Le stockage PostgreSQL n'est pas le tmpfs attendu : ${mounts}`);
  }

  console.log('[3/8] Insertion d’un agent fictif, création du dump et chiffrement/authentification de l’archive.');
  psql(sourceDatabase, `INSERT INTO agents (id, nom, prenom) VALUES ('${fakeAgentId}', 'AgentTest', 'RestaurationCI')`);
  const sourceCounts = psql(sourceDatabase,
    `SELECT (SELECT count(*) FROM agents) || ':' || (SELECT count(*) FROM services) || ':' || (SELECT count(*) FROM app_schema_migrations)`).stdout.trim();
  assert.match(sourceCounts, /^\d+:20:\d+$/, `Données source de test inattendues : ${sourceCounts}`);

  const dump = docker(['exec', container, 'pg_dump', '-U', sourceUser, '-d', sourceDatabase, '-Fc'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  }).stdout;
  assert.ok(Buffer.isBuffer(dump) && dump.length > 0, 'pg_dump a produit une archive vide.');
  const staging = join(temp, 'staging');
  await mkdir(staging, { mode: 0o700 });
  await writeFile(join(staging, 'base.dump'), dump, { mode: 0o600 });
  await writeFile(join(staging, 'env.sauvegarde'),
    'FANN_TEST_ONLY=true\nPOSTGRES_DB=fann_pointage_test\n# Valeurs fictives, aucun secret réel.\n',
    { mode: 0o600 });
  await writeFile(keyFile, randomBytes(48).toString('base64url'), { mode: 0o600 });

  run('tar', ['-C', staging, '-cf', archiveTar, 'base.dump', 'env.sauvegarde']);
  run('openssl', [
    'enc', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-salt',
    '-pass', `file:${keyFile}`, '-in', archiveTar, '-out', cipherFile,
  ]);
  run('bash', [
    '-c', 'source "$1" && fann_backup_wrap_ciphertext "$2" "$3" "$4"',
    'bash', join(root, 'scripts/vps/backup-crypto.sh'), cipherFile, keyFile, wrappedCipherFile,
  ]);

  console.log('[4/8] Restauration complète via le script officiel (HMAC avant déchiffrement).');
  await import('node:fs/promises').then(({ mkdir: makeDir }) => makeDir(fakeBin, { mode: 0o700 }));
  const wrapper = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ "$#" -lt 5 || "$1" != "compose" || "$2" != "exec" || "$3" != "-T" || "$4" != "db" ]]; then',
    '  echo "Commande Compose inattendue dans le test de restauration." >&2',
    '  exit 64',
    'fi',
    'shift 4',
    'exec "$FANN_REAL_DOCKER" exec -i "$FANN_RESTORE_TEST_CONTAINER" "$@"',
  ].join('\n');
  await writeFile(wrapperFile, wrapper, { mode: 0o700 });
  await chmod(wrapperFile, 0o700);

  const restoreEnv = {
    ...process.env,
    PATH: fakeBin + delimiter + (process.env.PATH || ''),
    FANN_REAL_DOCKER: realDocker,
    FANN_RESTORE_TEST_CONTAINER: container,
    BACKUP_KEY_FILE: keyFile,
    COMPOSE_FILE: 'compose.yaml',
  };
  const restored = run('bash', [
    join(root, 'scripts/vps/restaurer-sauvegarde-chiffree.sh'),
    wrappedCipherFile,
    'test',
  ], { env: restoreEnv, timeout: 180_000 });
  console.log(restored.stdout.trim());

  console.log('[5/8] Vérification cryptographique indépendante et restauration du dump issu de l’archive chiffrée.');
  run('bash', [
    '-c', 'source "$1" && fann_backup_extract_ciphertext "$2" "$3" "$4"',
    'bash', join(root, 'scripts/vps/backup-crypto.sh'), wrappedCipherFile, verifiedCipherFile, keyFile,
  ]);
  run('openssl', [
    'enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000',
    '-pass', `file:${keyFile}`, '-in', verifiedCipherFile, '-out', verifiedTar,
  ]);
  const extractedDump = run('tar', ['-xOf', verifiedTar, 'base.dump'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  }).stdout;
  assert.deepEqual(extractedDump, dump, 'Le dump extrait ne correspond pas au dump sauvegardé.');
  
  docker(['exec', container, 'createdb', '-U', sourceUser, restoreDatabase]);
  const restoredClone = docker([
    'exec', '-i', container, 'pg_restore', '-U', sourceUser, '-d', restoreDatabase,
    '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction',
  ], { input: extractedDump });
  void restoredClone;

  console.log('[6/8] Exécution des migrations jusqu’à 0027, puis second passage idempotent.');
  const portText = docker(['port', container, '5432/tcp']).stdout.trim();
  const portMatch = portText.match(/:(\d+)$/);
  assert.ok(portMatch, `Port PostgreSQL temporaire introuvable : ${portText}`);
  const port = Number(portMatch[1]);
  const adminUrl = `postgresql://${sourceUser}:${adminPassword}@127.0.0.1:${port}/${restoreDatabase}`;
  const migrationEnv = {
    ...process.env,
    DATABASE_ADMIN_URL: adminUrl,
    POSTGRES_APP_USER: 'fann_app',
    POSTGRES_APP_PASSWORD: appPassword,
    PGSSL: '',
  };

  const migrationsBefore = psql(restoreDatabase, 'SELECT count(*) FROM app_schema_migrations').stdout.trim();
  const migrationOne = run(process.execPath, [join(root, 'scripts/migrate-catalogue.mjs')], { env: migrationEnv, timeout: 120_000 });
  console.log(migrationOne.stdout.trim());
  const migrationTwo = run(process.execPath, [join(root, 'scripts/migrate-catalogue.mjs')], { env: migrationEnv, timeout: 120_000 });
  console.log(migrationTwo.stdout.trim());
  const migrationsAfter = psql(restoreDatabase, 'SELECT count(*) FROM app_schema_migrations').stdout.trim();
  assert.equal(migrationsAfter, migrationsBefore, 'Le second passage a modifié le nombre de marqueurs de migration.');
  assert.equal(psql(restoreDatabase,
    "SELECT count(*) FROM app_schema_migrations WHERE version='0027_indexes_performance_operational'").stdout.trim(),
  '1', 'La migration 0027 est absente après restauration.');

  console.log('[7/8] Configuration et vérification des privilèges du rôle fann_app.');
  const roleConfig = run(process.execPath, [join(root, 'scripts/configurer-role-application.mjs')], {
    env: migrationEnv,
    timeout: 120_000,
  });
  console.log(roleConfig.stdout.trim());

  const roleFlags = psql(restoreDatabase,
    "SELECT (NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls)::text FROM pg_roles WHERE rolname='fann_app'").stdout.trim();
  assert.equal(roleFlags, 'true', 'Le rôle fann_app a des privilèges élevés inattendus.');

  const appRead = docker([
    'exec', '-e', `PGPASSWORD=${appPassword}`, container, 'psql',
    '-h', '127.0.0.1', '-U', 'fann_app', '-d', restoreDatabase,
    '-v', 'ON_ERROR_STOP=1', '-At',
    '-c', `SELECT count(*) FROM agents WHERE id='${fakeAgentId}'`,
  ]).stdout.trim();
  assert.equal(appRead, '1', 'fann_app ne peut pas lire l’agent fictif restauré.');

  const ddlAttempt = docker([
    'exec', '-e', `PGPASSWORD=${appPassword}`, container, 'psql',
    '-h', '127.0.0.1', '-U', 'fann_app', '-d', restoreDatabase,
    '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE TABLE public.fann_restore_forbidden (id integer)',
  ], { allowFailure: true });
  assert.notEqual(ddlAttempt.status, 0, 'fann_app ne doit pas pouvoir créer des tables.');

  const auditDeleteAttempt = docker([
    'exec', '-e', `PGPASSWORD=${appPassword}`, container, 'psql',
    '-h', '127.0.0.1', '-U', 'fann_app', '-d', restoreDatabase,
    '-v', 'ON_ERROR_STOP=1', '-c', 'DELETE FROM public.journal_audit',
  ], { allowFailure: true });
  assert.notEqual(auditDeleteAttempt.status, 0, 'fann_app ne doit pas pouvoir supprimer le journal d’audit.');

  console.log('[8/8] Comparaison des données et nettoyage du conteneur éphémère.');
  const targetCounts = psql(restoreDatabase,
    `SELECT (SELECT count(*) FROM agents) || ':' || (SELECT count(*) FROM services) || ':' || (SELECT count(*) FROM app_schema_migrations)`).stdout.trim();
  assert.equal(targetCounts, sourceCounts, `Les comptes restaurés diffèrent : source=${sourceCounts}, cible=${targetCounts}`);
  assert.equal(psql(restoreDatabase,
    `SELECT count(*) FROM agents WHERE id='${fakeAgentId}' AND nom='AgentTest' AND prenom='RestaurationCI'`).stdout.trim(),
  '1', 'L’agent fictif de contrôle n’a pas été restauré fidèlement.');

  console.log('SUCCÈS : archive chiffrée authentifiée, restauration PostgreSQL, migrations 0027 idempotentes et privilèges fann_app vérifiés.');
}

try {
  await main();
} catch (error) {
  console.error(`TEST DE RESTAURATION CHIFFRÉE ÉCHOUÉ : ${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  if (containerStarted) {
    const removed = spawnSync(realDocker, ['rm', '-f', container], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000,
    });
    if (removed.status !== 0 && !/No such container/i.test(removed.stderr || '')) {
      console.error('ATTENTION : le conteneur PostgreSQL de test n’a pas pu être supprimé automatiquement.');
      process.exitCode = 1;
    }
  }
  if (imageBuilt) {
    const removed = spawnSync(realDocker, ['image', 'rm', image], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000,
    });
    if (removed.status !== 0) console.error('AVERTISSEMENT : image temporaire non supprimée ; aucun volume PostgreSQL n’a été utilisé.');
  }
  await rm(temp, { recursive: true, force: true });
}
