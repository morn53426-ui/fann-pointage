import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const caddyfile = resolve(root, 'deploy/Caddyfile.vps');
const image = 'caddy:2.10-alpine';
const email = 'ops@example.org';

// These tests validate only configuration adaptation. They do not start Caddy,
// obtain certificates, contact Let's Encrypt, or access a real deployment.
const hostnames = [
  'fann.example.test',
  'pointage.example.org',
];

function validateCaddyForHostname(hostname) {
  const result = spawnSync('docker', [
    'run',
    '--rm',
    '--pull=missing',
    '--env', `FANN_HOSTNAME=${hostname}`,
    '--env', `ACME_EMAIL=${email}`,
    '--mount', `type=bind,src=${caddyfile},dst=/etc/caddy/Caddyfile,readonly`,
    '--entrypoint', '/bin/sh',
    image,
    '-euc',
    [
      'caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile --pretty > /tmp/caddy-adapted.json',
      'grep -F -- "$FANN_HOSTNAME" /tmp/caddy-adapted.json',
      'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile',
    ].join(' && '),
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error?.code === 'ENOENT') {
    throw new Error('Docker est requis pour valider la configuration Caddy.');
  }
  assert.equal(
    result.status,
    0,
    [
      `Caddy n'a pas accepté FANN_HOSTNAME=${hostname}.`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'),
  );
}

for (const hostname of hostnames) {
  test(`Caddy adapte et valide le domaine configurable ${hostname}`, () => {
    validateCaddyForHostname(hostname);
  });
}
