import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const lire = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("conteneur applicatif : version Node, utilisateur non privilégié et healthcheck", () => {
  const dockerfile = lire("Dockerfile");
  assert.match(dockerfile, /FROM node:22\.23\.4-bookworm-slim/);
  assert.match(dockerfile, /COPY --chown=node:node package\*\.json \.\//);
  assert.match(lire("package.json"), /"type": "module"/);
  assert.match(dockerfile, /COPY --chown=node:node src \.\/src/);
  assert.match(dockerfile, /chown node:node \/data/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/readyz/);
  assert.match(dockerfile, /--experimental-strip-types/);
  assert.equal(existsSync(new URL("../../.dockerignore", import.meta.url)), true);
});

test("compose : port local par défaut, hardening et stockage Postgres persistant", () => {
  const compose = lire("compose.yaml");
  assert.match(compose, /\$\{APP_BIND_ADDRESS:-127\.0\.0\.1\}:\$\{APP_PORT:-8787\}:8787/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop:[\s\S]*- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /FANN_MODE: \$\{FANN_MODE:-postgres-catalogue\}/);
  assert.match(compose, /depends_on:[\s\S]*db:[\s\S]*condition: service_healthy/);
  assert.doesNotMatch(compose, /profiles: \["database"\]/);
  assert.match(compose, /fann_pgdata:\s*\/var\/lib\/postgresql\/data/);
  assert.match(compose, /fann_runtime_data:\s*\/data/);
  assert.match(compose, /POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?/);
  assert.match(compose, /DATABASE_URL:\s*"postgresql:\/\/fann_app:/);
  assert.match(compose, /POSTGRES_APP_PASSWORD:\s*\$\{POSTGRES_APP_PASSWORD:\?/);
  assert.match(compose, /readyz/);
  assert.match(compose, /ZONE_LAT:\s*"\$\{ZONE_LAT:-\}"/);
  assert.match(compose, /ZONE_LNG:\s*"\$\{ZONE_LNG:-\}"/);
  assert.match(compose, /ZONE_RAYON:\s*"\$\{ZONE_RAYON:-150\}"/);
  assert.match(lire("src/api/configuration.ts"), /Sans coordonnées, le rayon n'a aucun effet/);
  const exemple = lire(".env.example");
  assert.match(exemple, /^ZONE_LAT=$/m);
  assert.match(exemple, /^ZONE_LNG=$/m);
  assert.match(exemple, /^ZONE_RAYON=150$/m);
});

test("image PostgreSQL applique les migrations puis le seed", () => {
  const dockerfile = lire("Dockerfile.postgres");
  const guide = lire("docs/DOCKER.md");
  assert.match(dockerfile, /COPY supabase\/migrations\/\*\.sql \/docker-entrypoint-initdb\.d\//);
  assert.match(dockerfile, /9999_seed\.sql/);
  assert.match(dockerfile, /0000_create_app_role\.sh/);
  assert.match(dockerfile, /zzzz_grant_app_role\.sh/);
  assert.match(dockerfile, /supabase\/tests\//);
  assert.match(lire("src/api/main-postgres-catalogue.ts"), /catalogue-postgres/i);
  assert.match(guide, /base jetable/i);
});

test("démarrage Windows : crée un .env local sûr et fournit un guide non vide", () => {
  const script = lire("LANCER_FANN_POINTAGE.bat");
  const init = lire("scripts/init-env.mjs");
  const guide = lire("DEMARRER-ICI-WINDOWS.md");
  const packageJson = JSON.parse(lire("package.json")) as { scripts: Record<string, string> };
  assert.match(script, /if not exist ".env"/i);
  assert.match(script, /node scripts\/init-env\.mjs/);
  assert.match(init, /randomBytes\(bytes\)/);
  assert.match(init, /existsSync\(target\)/);
  assert.match(init, /flag: 'wx'/);
  assert.match(init, /DATABASE_URL=postgresql:\/\//);
  assert.match(packageJson.scripts["admin:postgres"], /--env-file=\.env/);
  assert.match(packageJson.scripts["auth:postgres"], /--env-file=\.env/);
  assert.ok(guide.length > 500, "Le guide Windows doit contenir des étapes exploitables.");
  assert.match(guide, /npm run setup:env/);
  assert.match(guide, /ADMIN_INITIAL_MOT_DE_PASSE/);
  assert.match(guide, /FANN_MODE=postgres-catalogue/);
  assert.match(guide, /migrée|migration|catalogue PostgreSQL/i);
});


test("PostgreSQL transitoire : l'application réessaie au démarrage et gère les erreurs du pool", () => {
  const app = lire("src/api/main-postgres-catalogue.ts");
  const retry = lire("src/db/reessais-connexion-postgres.ts");
  assert.match(app, /avecReessaisConnexionPostgres/);
  assert.match(app, /pool\.on\("error"/);
  assert.match(app, /maxAttempts:\s*30/);
  assert.match(retry, /ECONNREFUSED/);
  assert.match(retry, /estErreurPostgresTemporaire/);
});

test("Caddy : accès par adresse IP — le nom par défaut (default_sni) est défini sur FANN_HOSTNAME et le bloc global précède le site", () => {
  const caddy = lire("deploy/Caddyfile");
  // Sans SNI (adresse IP saisie dans le navigateur), Caddy ne retrouvait pas son certificat derrière Docker : « réponse non valide ».
  assert.match(caddy, /default_sni \{\$FANN_HOSTNAME\}/);
  const code = caddy.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n").trim();
  assert.ok(code.startsWith("{"), "le bloc d'options globales doit être le premier bloc du Caddyfile");
  assert.ok(code.indexOf("default_sni") < code.indexOf("{$FANN_HOSTNAME} {"), "le bloc global précède le bloc du site");
  assert.match(caddy, /tls internal/);
});
