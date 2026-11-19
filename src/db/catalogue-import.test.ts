import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const migration0013 = () => readFile(new URL("../../supabase/migrations/0013_catalogue_reel_agents_services.sql", import.meta.url), "utf8");

 test("migration 0013 : 20 services, aucune fiche nominative et pas de réinitialisation des corrections", async () => {
  const sql = await migration0013();
  const services = sql.split("INSERT INTO services (nom, regime_defaut, actif) VALUES", 2)[1]?.split("ON CONFLICT", 1)[0] ?? "";
  assert.equal((services.match(/\('[^']+', '(?:general|garde|urgences)', true\)/g) ?? []).length, 20);
  assert.doesNotMatch(sql, /roster_fann_photo|FANN-PHOTO-/);
  assert.match(sql, /ON CONFLICT \(nom\) DO NOTHING/i);
  assert.doesNotMatch(sql, /ON CONFLICT \(nom\) DO UPDATE/i);
  assert.match(sql, /app_schema_migrations\(version\)/);
});

test("aucun registre nominatif local ne fait partie du projet livrable", async () => {
  await assert.rejects(access(new URL("../../registre-prive/registre-initial-brancardiers.sql", import.meta.url)));
  await assert.rejects(access(new URL("../../docs/REGISTRE_REEL_2026-10-13.md", import.meta.url)));
  const gitignore = await readFile(new URL("../../.gitignore", import.meta.url), "utf8");
  const dockerignore = await readFile(new URL("../../.dockerignore", import.meta.url), "utf8");
  assert.match(gitignore, /^registre-prive\/$/m);
  assert.match(dockerignore, /^registre-prive\/$/m);
  assert.match(gitignore, /^docs\/REGISTRE_REEL_\*\.md$/m);
  assert.match(dockerignore, /^docs\/REGISTRE_REEL_\*\.md$/m);
  const compose = await readFile(new URL("../../compose.yaml", import.meta.url), "utf8");
  assert.doesNotMatch(compose, /\.\/registre-prive/);
});

test("l'import initial est explicite, prévisualisable et n'écrase pas les corrections", async () => {
  const script = await readFile(new URL("../../scripts/migrate-catalogue.mjs", import.meta.url), "utf8");
  assert.match(script, /--preview-registre/);
  assert.match(script, /--apply-registre/);
  assert.match(script, /REGISTRE_INITIAL_SQL/);
  assert.match(script, /ON CONFLICT \(source_ref\)(?:\s+WHERE source_ref IS NOT NULL)? DO NOTHING/i);
  assert.match(script, /ROLLBACK/);
  assert.match(script, /registre partiel/);
  assert.doesNotMatch(script, /new URL\('\.\.\/registre-prive/);
  const doc = await readFile(new URL("../../docs/IMPORT_REGISTRE.md", import.meta.url), "utf8");
  assert.match(doc, /prévisualiser sans conserver de données/i);
  assert.match(doc, /hors du dossier du projet/i);
});

test("seed de référence : aucun catalogue agent/service de démonstration n'est chargé", async () => {
  const sql = await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /insert\s+into\s+services/i);
  assert.doesNotMatch(sql, /DEMO-|Agent\d+/i);
});
