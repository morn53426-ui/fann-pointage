import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const restoreScript = join(here, 'restaurer-sauvegarde.sh');
const root = await mkdtemp(join(tmpdir(), 'fann-restore-script-tests-'));

async function runRestore(t, { createFails = false } = {}) {
  const dir = await mkdtemp(join(root, 'case-'));
  const bin = join(dir, 'bin');
  const dump = join(dir, 'fixture.dump');
  const log = join(dir, 'docker.log');
  const events = join(dir, 'docker.events');
  await mkdir(bin, { mode: 0o700 });
  await writeFile(dump, 'fixture-only-not-a-real-database-dump');
  await writeFile(log, '');
  await writeFile(events, '');

  const dockerStub = String.raw`#!/usr/bin/env bash
set -euo pipefail
args="$*"
printf '%s\\n' "$args" >> "$DOCKER_LOG"

if [[ "$args" == *"pg_restore --list"* ]]; then
  exit 0
fi

if [[ "$args" == *"createdb -U"* ]]; then
  db="${@: -1}"
  printf 'create-attempt:%s\\n' "$db" >> "$DOCKER_EVENTS"
  if [[ "${FAKE_CREATE_FAIL:-0}" == "1" ]]; then
    exit 17
  fi
  printf 'created:%s\\n' "$db" >> "$DOCKER_EVENTS"
  exit 0
fi

if [[ "$args" == *"dropdb -U"* ]]; then
  db="${@: -1}"
  printf 'dropped:%s\\n' "$db" >> "$DOCKER_EVENTS"
  exit 0
fi

if [[ "$args" == *"SELECT (SELECT count(*) FROM agents)"* ]]; then
  printf '1|1|0|0|0|0'
  exit 0
fi

if [[ "$args" == *"to_regclass"* ]]; then
  printf '27'
  exit 0
fi

exit 0
`;
  const dockerPath = join(bin, 'docker');
  await writeFile(dockerPath, dockerStub, { mode: 0o700 });
  await chmod(dockerPath, 0o700);

  const result = spawnSync('bash', [restoreScript, dump, 'test'], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      DOCKER_LOG: log,
      DOCKER_EVENTS: events,
      FAKE_CREATE_FAIL: createFails ? '1' : '0',
    },
  });

  const recordedEvents = (await readFile(events, 'utf8')).trim().split('\\n').filter(Boolean);
  const recordedCommands = await readFile(log, 'utf8');
  t.after(async () => rm(dir, { recursive: true, force: true }));
  return { result, recordedEvents, recordedCommands };
}

test('la base temporaire utilise un identifiant aléatoire et est supprimée après sa création', async (t) => {
  const { result, recordedEvents, recordedCommands } = await runRestore(t);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(recordedEvents.length, 3, recordedEvents.join('\\n'));

  const match = recordedEvents[0].match(/^create-attempt:(fann_restore_test_[a-f0-9]{24})$/);
  assert.ok(match, `identifiant temporaire inattendu : ${recordedEvents[0]}`);
  const databaseName = match[1];

  assert.equal(recordedEvents[1], `created:${databaseName}`);
  assert.equal(recordedEvents[2], `dropped:${databaseName}`);

  const createIndex = recordedCommands.indexOf('createdb -U');
  const dropIndex = recordedCommands.indexOf('dropdb -U');
  assert.notEqual(createIndex, -1, 'la création de la base doit être tentée');
  assert.ok(dropIndex > createIndex, 'aucun dropdb ne doit être lancé avant createdb');
});

test('un échec de création (collision simulée) ne supprime jamais la base préexistante', async (t) => {
  const { result, recordedEvents, recordedCommands } = await runRestore(t, { createFails: true });

  assert.notEqual(result.status, 0, 'la restauration doit échouer si createdb échoue');
  assert.equal(recordedEvents.length, 1, recordedEvents.join('\\n'));
  assert.match(recordedEvents[0], /^create-attempt:fann_restore_test_[a-f0-9]{24}$/);
  assert.doesNotMatch(recordedCommands, /dropdb -U/, 'aucune suppression ne doit être tentée après un échec de création');
});

test.after(async () => rm(root, { recursive: true, force: true }));
