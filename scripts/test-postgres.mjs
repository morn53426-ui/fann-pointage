import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const project = `fann-pg-test-${process.pid}`;
const compose = ['compose', '-f', 'compose.postgres-test.yaml', '-p', project];
const db = 'postgres-test';
const sqlArgs = ['-U', 'fann_test', '-d', 'fann_pointage_test', '-v', 'ON_ERROR_STOP=1'];
let stackCreated = false;

function run(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync('docker', [...compose, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: 8 * 60 * 1000,
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('Docker est introuvable. Installez Docker Desktop, démarrez-le, puis relancez npm run test:postgres.');
    }
    throw result.error;
  }
  if (!allowFailure && result.status !== 0) {
    const detail = capture ? `\n${result.stdout ?? ''}\n${result.stderr ?? ''}` : '';
    throw new Error(`Échec de la commande docker ${args.join(' ')} (code ${result.status}).${detail}`);
  }
  return result;
}

function lancerPsql(args, options = {}) {
  return run(['exec', '-T', db, 'psql', ...sqlArgs, ...args], options);
}

// Vérifie la base elle-même (pg_isready peut annoncer que le serveur écoute même
// si le nom de base demandé n'existe pas). Sur certaines installations Windows,
// l'entrypoint a déjà initialisé le cluster sans créer le nom attendu par le test.
// Le repli ne touche qu'au conteneur et au volume jetables de ce banc.
function garantirBaseTest() {
  const sonder = () => run(['exec', '-T', db, 'psql', '-U', 'fann_test', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT 1 FROM pg_database WHERE datname = 'fann_pointage_test'"], { capture: true });
  // Machine lente : l'initialisation de l'entrypoint peut encore tourner. On laisse jusqu'à 60 s avant d'initialiser nous-mêmes.
  for (let essai = 0; essai < 20; essai += 1) {
    if (sonder().stdout.trim() === '1') return;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},3000)']);
  }
  console.warn('Base de test absente : création et initialisation explicites du schéma dans le conteneur jetable.');
  run(['exec', '-T', db, 'psql', '-U', 'fann_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE fann_pointage_test']);
  const shell = `set -eu
export POSTGRES_DB=fann_pointage_test
for f in /docker-entrypoint-initdb.d/*; do
  case "$f" in
    *.sh) "$f" ;;
    *.sql) psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --file="$f" ;;
  esac
done`;
  run(['exec', '-T', db, 'sh', '-c', shell]);
}

function runConcurrentPsql(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const enfant = spawn('docker', [...compose, 'exec', '-T', db, 'psql', ...sqlArgs, ...args], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    enfant.stdout.setEncoding('utf8').on('data', (s) => { stdout += s; });
    enfant.stderr.setEncoding('utf8').on('data', (s) => { stderr += s; });
    enfant.on('error', rejectPromise);
    enfant.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function main() {
  try {
    const versionDocker = spawnSync('docker', ['--version'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (versionDocker.error?.code === 'ENOENT') {
      throw new Error('Docker est introuvable. Installez Docker Desktop, démarrez-le, puis relancez npm run test:postgres.');
    }
    if (versionDocker.status !== 0) throw new Error(`Docker n’est pas disponible : ${versionDocker.stderr ?? 'vérifiez Docker Desktop.'}`);
    // Le nettoyage doit aussi être tenté si le build ou le démarrage échoue à mi-chemin.
    stackCreated = true;
    run(['up', '--build', '-d', '--wait', '--wait-timeout', '120', db]);
    garantirBaseTest();
    console.log('\n[1/4] Exécution des migrations + seed + tests de contraintes PostgreSQL');
    lancerPsql(['-f', '/opt/fann-tests/001_contraintes.sql']);

    console.log('\n[2/4] Test concurrent : deux pointages tentent de consommer le même QR');
    lancerPsql(['-c', `
      INSERT INTO services (id, nom, regime_defaut)
      VALUES ('00000000-0000-0000-0000-0000000000a1', 'TEST concurrency', 'urgences');
      INSERT INTO agents (id, nom, prenom)
      VALUES ('00000000-0000-0000-0000-0000000000b1', 'Agent', 'Concurrence');
      INSERT INTO zones_pointage (id, nom, service_id, latitude, longitude, rayon_m)
      VALUES ('00000000-0000-0000-0000-0000000000d1', 'ZONE TEST', '00000000-0000-0000-0000-0000000000a1', 14.0, -17.0, 150);
      INSERT INTO qr_tokens (id, zone_id, token_hash, issued_at, expires_at)
      VALUES ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000d1', 'fann-test-concurrency-qr', now() - interval '1 minute', now() + interval '1 hour');
    `]);
    const insertion = (id, key) => [`-c`, `INSERT INTO pointages (id, agent_id, service_id, zone_id, qr_token_id, type, validation, idempotency_key, statut_localisation) VALUES ('${id}', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e7', 'arrivee', 'a_verifier', '${key}', 'dans_zone')`];
    const attempts = await Promise.all([
      runConcurrentPsql(insertion('00000000-0000-0000-0000-0000000000e8', 'qr-race-a')),
      runConcurrentPsql(insertion('00000000-0000-0000-0000-0000000000e9', 'qr-race-b')),
    ]);
    const winners = attempts.filter((x) => x.code === 0).length;
    const losers = attempts.filter((x) => x.code !== 0 && /QR déjà utilisé|unique|duplicate key/i.test(`${x.stdout}\n${x.stderr}`)).length;
    assert.equal(winners, 1, `Un seul pointage doit gagner la course concurrente. Résultats : ${JSON.stringify(attempts)}`);
    assert.equal(losers, 1, `Le doublon QR doit être rejeté par la contrainte SQL. Résultats : ${JSON.stringify(attempts)}`);
    const counts = lancerPsql(['-At', '-c', `SELECT (SELECT count(*) FROM pointages WHERE qr_token_id = '00000000-0000-0000-0000-0000000000e7') || ':' || (SELECT count(*) FROM qr_token_uses WHERE token_id = '00000000-0000-0000-0000-0000000000e7')`], { capture: true });
    assert.equal(counts.stdout.trim(), '1:1', `La transaction QR doit laisser exactement un pointage et un usage. Résultat : ${counts.stdout.trim()}`);

    console.log('\n[3/4] Test de conservation d’une écriture après redémarrage PostgreSQL');
    lancerPsql(['-c', `CREATE TABLE IF NOT EXISTS public.fann_test_recovery (id integer PRIMARY KEY, marker text NOT NULL); TRUNCATE public.fann_test_recovery; INSERT INTO public.fann_test_recovery (id, marker) VALUES (1, 'FANN-POSTGRES-RESTART-OK');`]);
    run(['restart', db]);
    run(['up', '-d', '--wait', '--wait-timeout', '120', db]);
    const reprise = lancerPsql(['-At', '-c', 'SELECT marker FROM public.fann_test_recovery WHERE id = 1'], { capture: true });
    assert.equal(reprise.stdout.trim(), 'FANN-POSTGRES-RESTART-OK', 'La base n’a pas conservé l’écriture après redémarrage.');

    console.log('\n[4/4] RÉSULTAT : migrations, contraintes, concurrence QR et reprise PostgreSQL validées.');
    console.log('La base de test est isolée ; aucune donnée réelle n’a été utilisée.');
  } finally {
    if (stackCreated) {
      const cleanup = spawnSync('docker', [...compose, 'down', '--volumes', '--remove-orphans'], {
        cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'inherit', timeout: 120_000,
      });
      if (cleanup.status !== 0) console.error('ATTENTION : vérifiez les conteneurs/volumes de test Docker et supprimez-les si nécessaire.');
    }
  }
}

main().catch((error) => {
  console.error(`TESTS POSTGRESQL ÉCHOUÉS : ${error?.stack ?? error}`);
  process.exitCode = 1;
});
