// Contrôles STATIQUES des migrations (sans PostgreSQL). Ils ne remplacent pas
// supabase/tests/001_contraintes.sql, qui doit tourner sur une vraie base.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) => s.replace(/--.*$/gm, "");
const sql = Object.fromEntries(files.map((f) => [f, strip(readFileSync(new URL(f, dir), "utf8"))]));
const all = Object.values(sql).join("\n");

test("migrations numérotées 0001..000N sans trou", () => {
  files.forEach((f, i) => assert.ok(f.startsWith(String(i + 1).padStart(4, "0") + "_"), f));
  assert.ok(files.length >= 7);
});
test("délimiteurs équilibrés ($$, parenthèses, apostrophes)", () => {
  for (const [f, s] of Object.entries(sql)) {
    assert.equal((s.match(/\$\$/g) ?? []).length % 2, 0, `${f} : $$`);
    assert.equal((s.match(/'/g) ?? []).length % 2, 0, `${f} : apostrophes`);
    // Les littéraux (ex. '[)' des intervalles) sont retirés avant de compter les parenthèses.
    const sansLitteraux = s.replace(/'(?:[^']|'')*'/g, "''");
    assert.equal((sansLitteraux.match(/\(/g) ?? []).length, (sansLitteraux.match(/\)/g) ?? []).length, `${f} : parenthèses`);
  }
});
test("chaque table créée a la RLS activée", () => {
  const tables = [...all.matchAll(/create table (\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length >= 17, `tables : ${tables.length}`);
  for (const t of tables) {
    assert.match(all, new RegExp(`alter table ${t} enable row level security`), `RLS manquante : ${t}`);
  }
});
test("tables sensibles journalisées", () => {
  for (const t of ["plannings", "classements_mensuels", "scores_mensuels", "zones_pointage", "agents"]) {
    assert.match(sql["0007_securite.sql"], new RegExp(`'${t}'`), t);
  }
});
test("les paramètres définissent uniquement les pondérations de score", () => {
  assert.match(all, /create table parametres_scores/);
  assert.match(all, /score_total numeric\(8,3\) not null check \(score_total between 0 and 100\)/);
  assert.match(all, /jsonb_array_length\(top5\) <= 5/);
  assert.doesNotMatch(all, /montant_prime|reference_paiement|beneficiaires_primes|peut_valider_primes/i);
});
test("pas de régime par défaut pour un nouveau service", () => {
  assert.match(all, /regime_defaut regime_code not null,/);
});
test("pointages : lecture directe retirée, passage par la vue masquée", () => {
  assert.match(all, /revoke all on pointages/);
  assert.match(all, /create view v_pointages/);
});

test("classement mensuel immuable et écritures limitées au serveur", () => {
  const m = sql["0008_classement_securite.sql"];
  assert.ok(m, "migration 0008_classement_securite.sql absente");
  assert.match(m, /before update or delete on classements_mensuels/i);
  assert.match(m, /revoke insert, update, delete, truncate on parametres_scores, scores_mensuels, classements_mensuels from authenticated/i);
  assert.match(sql["0007_securite.sql"], /create policy classements_lecture/i);
});
test("aucune colonne ou fonction financière dans les migrations", () => {
  assert.doesNotMatch(all, /beneficiaires_primes|parametres_primes|reference_paiement|peut_valider_primes|montant_prime|statut_beneficiaire/i);
});


test("les coordonnées des zones et le classement JSON global sont restreints", () => {
  assert.match(sql["0007_securite.sql"], /zones_lecture[\s\S]*?app_role\(\) = 'administrateur'[\s\S]*?can_see_service\(service_id\)/i);
  assert.match(sql["0007_securite.sql"], /classements_lecture[\s\S]*?using \(app_role\(\) = 'administrateur'\)/i);
  assert.doesNotMatch(sql["0007_securite.sql"], /create policy classements_lecture on classements_mensuels for select to authenticated\s+using \(app_role\(\) in \('administrateur', 'responsable'\)\)/i);
});

test("une absence injustifiée non renseignée reste NULL, pas un zéro implicite", () => {
  assert.match(sql["0006_scores_classements.sql"], /absences_injustifiees integer check \(absences_injustifiees is null or absences_injustifiees >= 0\)/i);
  assert.doesNotMatch(sql["0006_scores_classements.sql"], /absences_injustifiees integer not null default 0/i);
});


test("un pointage ne peut être validé manuellement qu'avec motif, sans modifier les données source", () => {
  const m = sql["0004_pointage.sql"];
  assert.match(m, /new\.validation <> 'valide_manuellement'/i);
  assert.match(m, /nullif\(btrim\(new\.motif_validation_manuelle\), ''\) is null/i);
  assert.match(m, /to_jsonb\(new\)[\s\S]*?is distinct from[\s\S]*?to_jsonb\(old\)/i);
  const tests = strip(readFileSync(new URL("../../supabase/tests/001_contraintes.sql", import.meta.url), "utf8"));
  assert.match(tests, /statut accepté directement depuis un pointage refusé/i);
  assert.match(tests, /heure du pointage modifiée lors de la validation manuelle/i);
});


test("migration historique 0010 : calendrier d’ancienne version et cycle de vie SQL des badges", () => {
  const m = sql["0010_regle_service_general_et_badges.sql"];
  assert.ok(m, "migration 0010 absente");
  assert.match(m, /drop constraint if exists pas_de_dimanche/i);
  assert.match(m, /set default '\{1,2,3,4,5,6,7\}'/i);
  assert.match(m, /create table if not exists badges_agents/i);
  assert.match(m, /token_hash text not null unique/i);
  assert.match(m, /badges_agents_un_seul_actif/i);
  assert.match(m, /alter table badges_agents enable row level security/i);
  assert.match(m, /grant select, insert, update, delete on badges_agents to service_role/i);
});


test("contrat SQL pointage aligné avec l'application et usage QR atomique", () => {
  const m = sql["0011_contrat_pointage_application.sql"];
  assert.ok(m, "migration 0011 absente");
  assert.match(m, /add column if not exists poste_code text/i);
  assert.match(m, /add column if not exists captured_ts timestamptz/i);
  assert.match(m, /add column if not exists qr_token_id uuid references qr_tokens\(id\)/i);
  assert.match(m, /create or replace function consommer_qr_au_pointage/i);
  assert.match(m, /insert into qr_token_uses \(token_id, agent_id, used_at\)/i);
  assert.match(m, /new\.server_ts >= v_expires_at/i);
  assert.match(m, /new\.zone_id is distinct from v_zone_id/i);
  assert.match(m, /create trigger pointages_consomment_qr[\s\S]*?after insert on pointages/i);
  assert.match(m, /when unique_violation/i);
});

test("tests SQL couvrent les garde-fous ajoutés sur les QR", () => {
  const testsSql = strip(readFileSync(new URL("../../supabase/tests/001_contraintes.sql", import.meta.url), "utf8"));
  assert.match(testsSql, /consommation QR absente ou non atomique/i);
  assert.match(testsSql, /QR réutilisé par le même agent/i);
  assert.match(testsSql, /QR expiré accepté/i);
  assert.match(testsSql, /QR associé à une autre zone accepté/i);
  assert.match(testsSql, /pointage a survécu/i);
});

test("banc PostgreSQL : environnement jetable, concurrence QR et reprise", () => {
  const composeTest = readFileSync(new URL("../../compose.postgres-test.yaml", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../../scripts/test-postgres.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts?: Record<string, string> };
  assert.match(composeTest, /fann_pointage_test/);
  assert.doesNotMatch(composeTest, /^\s+volumes:/m, "le banc PostgreSQL ne doit créer aucun volume persistant");
  assert.match(composeTest, /tmpfs:[\s\S]*\/var\/lib\/postgresql\/data/);
  assert.doesNotMatch(composeTest, /^\s+volumes:/m, "le banc PostgreSQL ne doit créer aucun volume persistant");
  assert.doesNotMatch(composeTest, /postgres_test_data/);
  assert.match(runner, /001_contraintes\.sql/);
  assert.match(runner, /garantirBaseTest/);
  assert.match(runner, /CREATE DATABASE fann_pointage_test/);
  assert.match(runner, /Promise\.all/);
  assert.match(runner, /qr_token_uses/);
  assert.match(runner, /FANN-POSTGRES-RESTART-OK/);
  assert.match(runner, /pg_ctl/);
  assert.match(runner, /down', '--remove-orphans/);
  assert.doesNotMatch(runner, /down', '--volumes/, "le nettoyage ne doit jamais supprimer de volume PostgreSQL");
  assert.equal(packageJson.scripts?.["test:postgres"], "node scripts/test-postgres.mjs");
});

test("comptes serveur PostgreSQL : identifiant unique, hash scrypt, sessions révocables et RLS", () => {
  const m = sql["0012_identifiants_application.sql"];
  assert.ok(m, "migration 0012_identifiants_application.sql absente");
  assert.match(m, /create table identifiants_application/i);
  assert.match(m, /unique index identifiants_application_identifiant_normalise_uq[\s\S]*lower\(identifiant\)/i);
  assert.match(m, /mot_de_passe_hash[\s\S]*scrypt/i);
  assert.match(m, /session_version integer not null default 0 check \(session_version >= 0\)/i);
  assert.match(m, /alter table identifiants_application enable row level security/i);
  assert.match(m, /revoke all on identifiants_application from anon, authenticated/i);
  assert.match(m, /grant select, insert, update, delete on identifiants_application to service_role/i);
});

test("dépôt authentification SQL : aucun mot de passe clair ou jeton stocké", () => {
  const auth = readFileSync(new URL("../api/auth-postgres.ts", import.meta.url), "utf8");
  const t = readFileSync(new URL("../api/auth-postgres.test.ts", import.meta.url), "utf8");
  assert.match(auth, /lower\(btrim\(c\.identifiant\)\)/i);
  assert.match(auth, /session_version = session_version \+ 1/i);
  assert.match(auth, /BEGIN[\s\S]*COMMIT[\s\S]*ROLLBACK/);
  assert.match(t, /sans écrire un secret en clair/i);
  assert.match(t, /restaure toute la transaction/i);
});


test("migration 0015 : absences et rapports PostgreSQL supportés avec périmètre et trace de décision", () => {
  const m = sql["0015_absences_rapports_postgres.sql"];
  assert.ok(m, "migration 0015 absente");
  for (const column of ["service_id", "cree_par", "note_admin", "valide_le", "motif_validation"]) assert.match(m, new RegExp(`add column if not exists ${column}`, "i"), column);
  assert.match(m, /CREATE OR REPLACE FUNCTION protect_absence/i);
  assert.match(m, /NEW\.service_id IS DISTINCT FROM OLD\.service_id/i);
  const grants = strip(readFileSync(new URL("../../scripts/grant-runtime-role.sql", import.meta.url), "utf8"));
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE ON TABLE absences_anomalies TO fann_app/i);
  assert.match(grants, /CREATE POLICY fann_app_absences_runtime ON absences_anomalies FOR ALL TO fann_app/i);
  const ops = readFileSync(new URL("../api/operations-postgres.ts", import.meta.url), "utf8");
  assert.match(ops, /private async listerAbsences/i);
  assert.match(ops, /private async creerAbsence/i);
  assert.match(ops, /private async deciderAbsence/i);
  assert.match(ops, /private async rapports/i);
});


test("migration 0016 : profession, adresse et téléphone du badge, facultatifs, bornés et rejouables", () => {
  const m = sql["0016_badge_profession_contact.sql"];
  assert.ok(m, "migration 0016 absente");
  for (const column of ["profession", "adresse", "telephone"]) assert.match(m, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} text`, "i"), column);
  for (const c of ["agents_profession_valide", "agents_adresse_valide", "agents_telephone_valide"]) assert.match(m, new RegExp(c), c);
  assert.doesNotMatch(m, /NOT NULL|DROP |DELETE |UPDATE agents/i, "aucune donnée existante ne doit être modifiée ni rendue obligatoire");
  assert.match(m, /0016_badge_profession_contact/);
  const script = readFileSync(new URL("../../scripts/migrate-catalogue.mjs", import.meta.url), "utf8");
  assert.match(script, /'0016_badge_profession_contact'/);
  assert.match(script, /const mobilRules = '0018_planning_mobil_rules'/);
  assert.match(script, /0017_regime_mobil_enum/);
  assert.ok(script.indexOf('for (const version of migrations)') < script.indexOf('0017_regime_mobil_enum') && script.indexOf('0017_regime_mobil_enum') < script.indexOf('const mobilRules'), 'l’ordre 0013–0016 → 0017 → 0018 doit être conservé');
  const main = readFileSync(new URL("../api/main-postgres-catalogue.ts", import.meta.url), "utf8");
  assert.match(main, /0016_badge_profession_contact/);
  assert.match(main, /0018_planning_mobil_rules/);
  assert.match(main, /pg_enum[\s\S]*e\.enumlabel='mobil'/);
});


test("migrations Mobil : nouveau régime enum puis règles de durée, affectations ouvertes et historique préservé", () => {
  const en = sql["0017_regime_mobil_enum.sql"];
  const rules = sql["0018_planning_mobil_rules.sql"];
  assert.ok(en && rules, "migrations Mobil absentes");
  assert.match(en, /alter type regime_code add value if not exists 'mobil'/i);
  assert.match(rules, /regime = 'mobil' and type_poste = 'jour' and ends_at - starts_at = interval '8 hours'/i);
  assert.match(rules, /regime = 'mobil' and type_poste = 'nuit' and ends_at - starts_at = interval '16 hours'/i);
  assert.match(rules, /aa\.date_fin is null/i, "seules les affectations courantes doivent changer");
  assert.match(rules, /on conflict \(version\) do nothing/i);
  assert.match(rules, /0018_planning_mobil_rules/i);
});

test("migration 0026 : autorise les gardes Mobil de 16 h ou 24 h et est exigée au démarrage", async () => {
  const m = sql["0026_mobil_gardes_24h_weekends_feries.sql"];
  assert.ok(m, "migration 0026 absente");
  assert.match(m, /regime = 'mobil' AND type_poste = 'nuit'[\s\S]*interval '16 hours'[\s\S]*interval '24 hours'/i);
  assert.match(m, /0026_mobil_gardes_24h_weekends_feries/i);
  const runner = readFileSync(new URL("../../scripts/migrate-catalogue.mjs", import.meta.url), "utf8");
  assert.match(runner, /const gardesMobil24h = '0026_mobil_gardes_24h_weekends_feries'/);
  const main = readFileSync(new URL("../api/main-postgres-catalogue.ts", import.meta.url), "utf8");
  assert.match(main, /version='0026_mobil_gardes_24h_weekends_feries'/);
  assert.match(main, /total \?\? 0\) !== 14/);
});

test("récupération du mot de passe admin : explicite, admin uniquement, sessions révoquées", () => {
  const script = readFileSync(new URL("../api/creer-admin-postgres.ts", import.meta.url), "utf8");
  assert.match(script, /--reinitialiser-mot-de-passe/);
  assert.match(script, /existant\.role !== "administrateur"/);
  assert.match(script, /existant\.actif/);
  assert.match(script, /changerMotDePasse\(existant\.id, hashMotDePasse/);
  assert.match(script, /option inconnue/i);
  assert.doesNotMatch(script, /console\.log\([^\n]*motDePasse/);
});

test("0019 : le service général peut durer de 2 h à 8 h et la migration est appliquée par le script", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(new URL("../../supabase/migrations/0019_general_heure_fin.sql", import.meta.url), "utf8");
  assert.match(sql, /regime = 'general'[^\n]*BETWEEN interval '2 hours' AND interval '8 hours'/);
  assert.match(sql, /0019_general_heure_fin/);
  const script = await readFile(new URL("../../scripts/migrate-catalogue.mjs", import.meta.url), "utf8");
  assert.ok(script.indexOf("0018_planning_mobil_rules';") < script.indexOf("0019_general_heure_fin'"), "0019 doit passer après 0018");
});


test("migration 0020 : jours ouvrés et régimes par défaut mis à jour sans réécrire les affectations", async () => {
  const m = sql["0020_regles_calendrier_services.sql"];
  assert.ok(m, "migration 0020 absente");
  assert.match(m, /ALTER COLUMN jours_travailles SET DEFAULT '\{1,2,3,4,5\}'/i);
  assert.match(m, /jours_travailles = ARRAY\[1,2,3,4,5,6,7\]::smallint\[\]/i);
  assert.match(m, /SET regime_defaut = 'general'[\s\S]*?cardio medical[\s\S]*?chirurgie plastique/i);
  assert.match(m, /SET regime_defaut = 'mobil'[\s\S]*?unité mobile/i);
  assert.doesNotMatch(m, /UPDATE agent_affectations|UPDATE plannings/i, "ne pas écraser le régime individuel ni les plannings existants");
  const runner = readFileSync(new URL("../../scripts/migrate-catalogue.mjs", import.meta.url), "utf8");
  assert.ok(runner.indexOf("0019_general_heure_fin'") < runner.indexOf("0020_regles_calendrier_services'"), "0020 doit être appliquée après 0019");
  const main = readFileSync(new URL("../api/main-postgres-catalogue.ts", import.meta.url), "utf8");
  assert.match(main, /0020_regles_calendrier_services/);
});


test("migration 0021 : messagerie persistante, diffusion générale, lecture idempotente et RLS", () => {
  const m = sql["0021_messagerie_diffusion.sql"];
  assert.ok(m, "migration 0021 absente");
  assert.match(m, /create table if not exists messages_diffusion/i);
  assert.match(m, /create table if not exists messages_lectures/i);
  assert.match(m, /alter table messages_diffusion enable row level security/i);
  assert.match(m, /alter table messages_lectures enable row level security/i);
  assert.match(m, /length\(btrim\(titre\)\) between 3 and 120/i);
  assert.match(m, /length\(btrim\(contenu\)\) between 1 and 4000/i);
  assert.match(m, /0021_messagerie_diffusion/);
  const grants = readFileSync(new URL("../../scripts/grant-runtime-role.sql", import.meta.url), "utf8");
  assert.match(grants, /grant select, insert, update on table messages_diffusion to fann_app/i);
  assert.match(grants, /grant select, insert on table messages_lectures to fann_app/i);
});


test("migration 0022 : destinataires individuels/services et priorité de message sont additives", () => {
  const m = sql["0022_messagerie_destinataires.sql"];
  assert.ok(m, "migration 0022 absente");
  assert.match(m, /add column if not exists portee text not null default 'tous'/i);
  assert.match(m, /add column if not exists priorite text not null default 'normale'/i);
  assert.match(m, /create table if not exists messages_destinataires/i);
  assert.match(m, /create table if not exists messages_services_destinataires/i);
  assert.match(m, /enable row level security/i);
  assert.match(m, /0022_messagerie_destinataires/i);
  const runner = readFileSync(new URL("../../scripts/migrate-catalogue.mjs", import.meta.url), "utf8");
  assert.ok(runner.indexOf("0021_messagerie_diffusion") < runner.indexOf("0022_messagerie_destinataires"));
  const grants = readFileSync(new URL("../../scripts/grant-runtime-role.sql", import.meta.url), "utf8");
  assert.match(grants, /grant select, insert on table messages_destinataires to fann_app/i);
  assert.match(grants, /grant select, insert on table messages_services_destinataires to fann_app/i);
});


test("migration 0023 : colonne additive de changement de mot de passe obligatoire, enregistrée dans le runner et le contrôle de prêt", () => {
  const m = sql["0023_comptes_agents_mot_de_passe.sql"];
  assert.ok(m, "migration 0023 absente");
  assert.match(m, /add column if not exists doit_changer_mot_de_passe boolean not null default false/i);
  assert.doesNotMatch(m, /drop\s|delete\s+from|truncate/i);
  assert.match(m, /0023_comptes_agents_mot_de_passe/);
  const runner = readFileSync(new URL("../../scripts/migrate-catalogue.mjs", import.meta.url), "utf8");
  assert.ok(runner.indexOf("0022_messagerie_destinataires") < runner.indexOf("0023_comptes_agents_mot_de_passe"));
  const main = readFileSync(new URL("../api/main-postgres-catalogue.ts", import.meta.url), "utf8");
  assert.match(main, /0023_comptes_agents_mot_de_passe/);
  assert.match(main, /!== 14\)/, "13 migrations attendues par /readyz");
});

test("migration 0024 : date de pose du mot de passe provisoire (colonne + déclencheur), additive, enregistrée dans le runner et /readyz", () => {
  const m = sql["0024_mot_de_passe_provisoire_expiration.sql"];
  assert.ok(m, "migration 0024 absente");
  assert.match(m, /add column if not exists provisoire_depuis timestamptz/i);
  assert.match(m, /create trigger trg_fann_provisoire_depuis/i);
  assert.doesNotMatch(m, /drop\s+(table|column)|delete\s+from|truncate/i);
  const runner = readFileSync(new URL("../../scripts/migrate-catalogue.mjs", import.meta.url), "utf8");
  assert.ok(runner.indexOf("0023_comptes_agents_mot_de_passe") < runner.indexOf("0024_mot_de_passe_provisoire_expiration"));
  const main = readFileSync(new URL("../api/main-postgres-catalogue.ts", import.meta.url), "utf8");
  assert.match(main, /0024_mot_de_passe_provisoire_expiration/);
});


test("migration 0027 : index de performance non destructifs et contrôlés au démarrage", () => {
  const m = sql["0027_indexes_performance_operational.sql"];
  assert.ok(m, "migration 0027 absente");
  assert.doesNotMatch(m, /create index if not exists pointages_(agent|service)_server_ts_desc_idx/i);
  const basePointages = sql["0004_pointage.sql"];
  assert.match(basePointages, /create index pointages_agent_ts on pointages \(agent_id, server_ts\)/i);
  assert.match(basePointages, /create index pointages_service_ts on pointages \(service_id, server_ts\)/i);
  assert.match(m, /create index if not exists plannings_service_starts_at_actifs_idx/i);
  assert.match(m, /create index if not exists affectations_agent_date_debut_desc_idx/i);
  assert.match(m, /0027_indexes_performance_operational/i);
  assert.doesNotMatch(m, /drop table|truncate|delete from|drop column/i);
  const runner = readFileSync(new URL("../../scripts/migrate-catalogue.mjs", import.meta.url), "utf8");
  assert.match(runner, /const indexPerformance = '0027_indexes_performance_operational'/);
  const main = readFileSync(new URL("../api/main-postgres-catalogue.ts", import.meta.url), "utf8");
  assert.match(main, /0027_indexes_performance_operational/);
  assert.match(main, /total \?\? 0\) !== 14/);
});
