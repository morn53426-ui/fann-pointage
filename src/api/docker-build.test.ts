import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const lire = async (relativePath: string) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('build Docker autonome : les dépendances ne proviennent pas du node_modules de l’hôte', async () => {
  const dockerfile = await lire('../../Dockerfile');
  const dockerignore = await lire('../../.dockerignore');
  assert.match(dockerfile, /COPY\s+--chown=node:node\s+package\*\.json\s+\.\//);
  assert.match(dockerfile, /npm ci --omit=dev/i);
  assert.match(dockerfile, /npm install --omit=dev/i);
  assert.doesNotMatch(dockerfile, /COPY\s+--chown=node:node\s+node_modules\s+\.\/node_modules/);
  assert.equal(dockerignore.split(/\r?\n/).some(line => /^node_modules\/?$/.test(line.trim())), true);
});

test('initialisation PostgreSQL : le rôle applicatif est séparé du bootstrap superuser', async () => {
  const compose = await lire('../../compose.yaml');
  const dbDockerfile = await lire('../../Dockerfile.postgres');
  const roleScript = await lire('../../scripts/docker-init-create-app-role.sh');
  const grants = await lire('../../scripts/grant-runtime-role.sql');
  assert.match(compose, /DATABASE_URL: "postgresql:\/\/fann_app:/);
  assert.match(compose, /POSTGRES_USER: \$\{POSTGRES_USER:-fann_admin\}/);
  assert.match(roleScript, /NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.doesNotMatch(roleScript, /BYPASSRLS/);
  assert.match(grants, /CREATE POLICY fann_app_identifiants_runtime ON identifiants_application/);
  assert.match(grants, /CREATE POLICY fann_app_journal_insertion_runtime ON journal_audit/);
  assert.match(dbDockerfile, /0000_create_app_role\.sh/);
  assert.match(dbDockerfile, /zzzz_grant_app_role\.sh/);
  assert.match(grants, /GRANT SELECT, INSERT ON TABLE journal_audit TO fann_app/);
  assert.doesNotMatch(grants, /GRANT ALL PRIVILEGES ON ALL TABLES/);
});
