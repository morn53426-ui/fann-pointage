import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const helper = join(here, 'backup-crypto.sh');
const root = await mkdtemp(join(tmpdir(), 'fann-backup-crypto-tests-'));
const key = join(root, 'backup.key');
await writeFile(key, 'test-only-key-material-not-a-production-secret-0123456789', { mode: 0o600 });

function bash(script, args = [], env = {}) {
  return spawnSync('bash', ['-c', script, 'bash', helper, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

async function withCase(t, name) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  t.after(async () => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('archive authentifiée : enveloppe puis extraction préservent les octets', async (t) => {
  const dir = await withCase(t, 'roundtrip');
  const cipher = join(dir, 'archive.enc');
  const envelope = join(dir, 'archive.tar.enc');
  const extracted = join(dir, 'extracted.enc');
  const bytes = Buffer.from([0, 1, 2, 10, 13, 255, ...Array.from({ length: 256 }, (_, i) => i)]);
  await writeFile(cipher, bytes, { mode: 0o600 });

  const wrapped = bash('source "$1" && fann_backup_wrap_ciphertext "$2" "$3" "$4"', [cipher, key, envelope]);
  assert.equal(wrapped.status, 0, wrapped.stderr);
  assert.match((await readFile(envelope)).subarray(0, 80).toString('ascii'), /^FANN-ENC-V2 [a-f0-9]{64}\n/);

  const unwrapped = bash('source "$1" && fann_backup_extract_ciphertext "$2" "$3" "$4"', [envelope, extracted, key]);
  assert.equal(unwrapped.status, 0, unwrapped.stderr);
  assert.deepEqual(await readFile(extracted), bytes);
});

test('une modification du ciphertext est rejetée avant déchiffrement', async (t) => {
  const dir = await withCase(t, 'tamper');
  const cipher = join(dir, 'archive.enc');
  const envelope = join(dir, 'archive.tar.enc');
  const tampered = join(dir, 'tampered.tar.enc');
  const extracted = join(dir, 'rejected.enc');
  await writeFile(cipher, Buffer.from('payload chiffré de test'), { mode: 0o600 });
  const wrapped = bash('source "$1" && fann_backup_wrap_ciphertext "$2" "$3" "$4"', [cipher, key, envelope]);
  assert.equal(wrapped.status, 0, wrapped.stderr);
  const data = await readFile(envelope);
  data[data.length - 1] ^= 0x01;
  await writeFile(tampered, data, { mode: 0o600 });
  const rejected = bash('source "$1" && fann_backup_extract_ciphertext "$2" "$3" "$4"', [tampered, extracted, key]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /HMAC incorrect/);
});

test('une mauvaise clé est rejetée', async (t) => {
  const dir = await withCase(t, 'wrong-key');
  const cipher = join(dir, 'archive.enc');
  const envelope = join(dir, 'archive.tar.enc');
  const extracted = join(dir, 'extracted.enc');
  const otherKey = join(dir, 'other.key');
  await writeFile(cipher, Buffer.from('ciphertext'), { mode: 0o600 });
  await writeFile(otherKey, 'different-test-key-material-0123456789-abcdefgh', { mode: 0o600 });
  const wrapped = bash('source "$1" && fann_backup_wrap_ciphertext "$2" "$3" "$4"', [cipher, key, envelope]);
  assert.equal(wrapped.status, 0, wrapped.stderr);
  const rejected = bash('source "$1" && fann_backup_extract_ciphertext "$2" "$3" "$4"', [envelope, extracted, otherKey]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /HMAC incorrect/);
});

test('les archives historiques sans HMAC sont bloquées par défaut', async (t) => {
  const dir = await withCase(t, 'legacy');
  const legacy = join(dir, 'legacy.enc');
  const extracted = join(dir, 'extracted.enc');
  const bytes = Buffer.from('legacy ciphertext');
  await writeFile(legacy, bytes, { mode: 0o600 });

  const rejected = bash('source "$1" && fann_backup_extract_ciphertext "$2" "$3" "$4"', [legacy, extracted, key]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Archive historique non authentifiée refusée/);

  const explicit = bash('source "$1" && fann_backup_extract_ciphertext "$2" "$3" "$4"', [legacy, extracted, key], { ALLOW_LEGACY_BACKUP: '1' });
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.match(explicit.stderr, /ATTENTION/);
  assert.deepEqual(await readFile(extracted), bytes);
});

test.after(async () => rm(root, { recursive: true, force: true }));
