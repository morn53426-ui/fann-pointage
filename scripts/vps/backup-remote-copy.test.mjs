import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helper = fileURLToPath(new URL('./backup-remote-copy.sh', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'fann-backup-remote-copy-'));

async function fixture(t, name, exitCode) {
  const dir = join(root, name);
  const bin = join(dir, 'bin');
  await mkdir(bin, { recursive: true });
  const archive = join(dir, 'fann-test.tar.enc');
  const argsLog = join(dir, 'rsync-args.log');
  const rsync = join(bin, 'rsync');

  await writeFile(archive, 'archive-chiffree-fictive', { mode: 0o600 });
  await writeFile(rsync, [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$@" > "$FANN_RSYNC_ARGS_LOG"',
    'exit "$FANN_RSYNC_EXIT_CODE"',
    '',
  ].join('\n'), { mode: 0o700 });

  t.after(async () => rm(dir, { recursive: true, force: true }));
  return {
    archive,
    argsLog,
    env: {
      ...process.env,
      PATH: bin + delimiter + (process.env.PATH || ''),
      FANN_RSYNC_ARGS_LOG: argsLog,
      FANN_RSYNC_EXIT_CODE: String(exitCode),
    },
  };
}

function invoke(f, destination = 'backup@example.invalid:/srv/fann') {
  const script = 'source "$1"; fann_backup_copy_remote "$2" "$3"; printf "AFTER_COPY\\n"';
  return spawnSync('bash', [
    '-e', '-u', '-o', 'pipefail', '-c', script,
    'bash', helper, f.archive, destination,
  ], { encoding: 'utf8', env: f.env });
}

test('une copie distante réussie transmet le seul fichier chiffré', async (t) => {
  const f = await fixture(t, 'success', 0);
  const result = invoke(f);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Copie chiffrée distante envoyée/);
  assert.match(result.stdout, /AFTER_COPY/);
  assert.deepEqual((await readFile(f.argsLog, 'utf8')).trim().split('\n'), [
    '-a',
    '--partial',
    '--delay-updates',
    '--partial-dir=.rsync-partial',
    '-e',
    'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
    f.archive,
    'backup@example.invalid:/srv/fann/',
  ]);
});

test('un échec rsync est propagé et conserve la sauvegarde locale', async (t) => {
  const f = await fixture(t, 'failure', 23);
  const result = invoke(f);

  assert.equal(result.status, 23, result.stderr);
  assert.match(result.stderr, /rsync=23/);
  assert.match(result.stderr, /copie locale vérifiée est conservée/);
  assert.doesNotMatch(result.stdout, /AFTER_COPY/);
  assert.equal(await readFile(f.archive, 'utf8'), 'archive-chiffree-fictive');
});

test('une destination vide ne déclenche pas rsync', async (t) => {
  const f = await fixture(t, 'no-destination', 0);
  const result = invoke(f, '');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AFTER_COPY/);
  await assert.rejects(readFile(f.argsLog, 'utf8'), { code: 'ENOENT' });
});

test.after(async () => rm(root, { recursive: true, force: true }));
