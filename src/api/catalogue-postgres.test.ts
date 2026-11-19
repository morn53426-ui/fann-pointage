import { test } from "node:test";
import assert from "node:assert/strict";
import { DepotCataloguePostgres } from "./catalogue-postgres.ts";
import type { ClientPg, PoolPg, ResultatPg } from "../pointage/postgres.ts";

const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO = "data:image/jpeg;base64,/9j/4A==";

test("catalogue PostgreSQL : la photo badge envoyée à la création est enregistrée dans agents.photo_data_url", async () => {
  const appels: { sql: string; values: readonly unknown[] }[] = [];
  const client: ClientPg = {
    query: async (sql: string, values: readonly unknown[] = []): Promise<ResultatPg> => {
      appels.push({ sql, values });
      if (sql.includes("SELECT id::text AS id FROM services")) return { rows: [{ id: SERVICE_ID }], rowCount: 1 };
      if (sql.includes("INSERT INTO agents")) return { rows: [{ id: AGENT_ID }], rowCount: 1 };
      if (sql.includes("SELECT (now() AT TIME ZONE 'Africa/Dakar')::date::text AS today")) return { rows: [{ today: "2026-10-14" }], rowCount: 1 };
      if (sql.includes("SELECT a.id::text AS id, a.prenom")) return { rows: [{
        id: AGENT_ID, prenom: "Awa", nom: "Ndiaye", matricule: "FANN-001", actif: true,
        photoDataUrl: PHOTO, serviceId: SERVICE_ID, service: "Accueil urgences", regime: "urgences",
      }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool: PoolPg = { query: client.query.bind(client), connect: async () => client };
  const depot = new DepotCataloguePostgres(pool);
  const agent = await depot.creerAgent({ prenom: "Awa", nom: "Ndiaye", matricule: "FANN-001", serviceId: SERVICE_ID, regime: "urgences", photoDataUrl: PHOTO }, ADMIN_ID, "127.0.0.1");
  const insertion = appels.find((x) => x.sql.includes("INSERT INTO agents"));
  assert.ok(insertion);
  assert.match(insertion.sql, /photo_data_url/);
  assert.equal(insertion.values[4], PHOTO);
  assert.equal(agent.photoDataUrl, PHOTO);
  assert.ok(appels.some((x) => x.sql === "COMMIT"));
});

test("catalogue PostgreSQL : les photos non JPEG ou trop grandes sont refusées avant ouverture de transaction", async () => {
  let connexions = 0;
  const pool: PoolPg = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => { connexions++; throw new Error("La connexion ne doit pas être ouverte."); },
  };
  const depot = new DepotCataloguePostgres(pool);
  await assert.rejects(() => depot.creerAgent({ prenom: "Awa", nom: "Ndiaye", matricule: null, serviceId: SERVICE_ID, regime: "urgences", photoDataUrl: "data:image/svg+xml;base64,/9j/4A==" }, ADMIN_ID, "127.0.0.1"), /photo/i);
  await assert.rejects(() => depot.creerAgent({ prenom: "Awa", nom: "Ndiaye", matricule: null, serviceId: SERVICE_ID, regime: "urgences", photoDataUrl: `data:image/jpeg;base64,${"A".repeat(110_100)}` }, ADMIN_ID, "127.0.0.1"), /photo/i);
  assert.equal(connexions, 0);
});

function clientEnregistreur(appels: { sql: string; values: readonly unknown[] }[], agentExistant?: Record<string, unknown>): { pool: PoolPg; client: ClientPg } {
  const ligne = { id: AGENT_ID, prenom: "Awa", nom: "Ndiaye", matricule: null, actif: true, photoDataUrl: null, profession: null, adresse: null, telephone: null, serviceId: SERVICE_ID, service: "Accueil urgences", regime: "urgences", ...agentExistant };
  const client: ClientPg = {
    query: async (sql: string, values: readonly unknown[] = []): Promise<ResultatPg> => {
      appels.push({ sql, values });
      if (sql.includes("SELECT id::text AS id FROM services")) return { rows: [{ id: SERVICE_ID }], rowCount: 1 };
      if (sql.includes("INSERT INTO agents")) return { rows: [{ id: AGENT_ID }], rowCount: 1 };
      if (sql.includes("SELECT (now() AT TIME ZONE 'Africa/Dakar')::date::text AS today")) return { rows: [{ today: "2026-10-15" }], rowCount: 1 };
      if (sql.includes("SELECT a.id::text AS id, a.prenom")) return { rows: [ligne], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { pool: { query: client.query.bind(client), connect: async () => client }, client };
}

test("catalogue PostgreSQL : profession, adresse et téléphone sont enregistrés à la création (valeurs nettoyées)", async () => {
  const appels: { sql: string; values: readonly unknown[] }[] = [];
  const { pool } = clientEnregistreur(appels, { profession: "Chef brancardier", adresse: "Médina, Dakar", telephone: "+221 77 000 00 00" });
  const agent = await new DepotCataloguePostgres(pool).creerAgent({
    prenom: "Awa", nom: "Ndiaye", matricule: null, serviceId: SERVICE_ID, regime: "urgences",
    profession: "  Chef   brancardier ", adresse: "Médina,\nDakar", telephone: "+221 77 000 00 00",
  }, ADMIN_ID, "127.0.0.1");
  const ins = appels.find((x) => x.sql.includes("INSERT INTO agents"))!;
  assert.match(ins.sql, /profession, adresse, telephone/);
  assert.deepEqual(ins.values.slice(5), ["Chef brancardier", "Médina, Dakar", "+221 77 000 00 00"]);
  assert.deepEqual([agent.profession, agent.adresse, agent.telephone], ["Chef brancardier", "Médina, Dakar", "+221 77 000 00 00"]);
});

test("catalogue PostgreSQL : champs du badge facultatifs, modifiables et refusés avant transaction s'ils sont invalides", async () => {
  const appels: { sql: string; values: readonly unknown[] }[] = [];
  const { pool } = clientEnregistreur(appels, { profession: "Brancardier", adresse: "Ancienne adresse", telephone: "33 821 00 00" });
  const depot = new DepotCataloguePostgres(pool);
  // Champs omis : valeurs actuelles conservées.
  await depot.modifierAgent(AGENT_ID, { prenom: "Awa" }, ADMIN_ID, "127.0.0.1");
  let maj = appels.find((x) => x.sql.includes("UPDATE agents SET"))!;
  assert.deepEqual(maj.values.slice(6), ["Brancardier", "Ancienne adresse", "33 821 00 00"]);
  // Chaîne vide : champ effacé.
  appels.length = 0;
  await depot.modifierAgent(AGENT_ID, { profession: "", adresse: "", telephone: "" }, ADMIN_ID, "127.0.0.1");
  maj = appels.find((x) => x.sql.includes("UPDATE agents SET"))!;
  assert.deepEqual(maj.values.slice(6), [null, null, null]);
  // Valeurs invalides : aucune requête d'écriture.
  for (const c of [{ telephone: "abc" }, { telephone: "12" }, { profession: "x".repeat(61) }, { adresse: "y".repeat(161) }]) {
    appels.length = 0;
    await assert.rejects(() => depot.modifierAgent(AGENT_ID, c, ADMIN_ID, "127.0.0.1"), /téléphone|Profession|Adresse/i);
    assert.ok(!appels.some((x) => x.sql.includes("UPDATE agents SET")), JSON.stringify(c));
  }
});

test("catalogue PostgreSQL : le journal d'audit ne contient jamais l'image de la photo", async () => {
  const appels: { sql: string; values: readonly unknown[] }[] = [];
  const { pool } = clientEnregistreur(appels, { photoDataUrl: PHOTO, profession: "Brancardier" });
  await new DepotCataloguePostgres(pool).modifierAgent(AGENT_ID, { prenom: "Awa" }, ADMIN_ID, "127.0.0.1");
  const journal = appels.find((x) => x.sql.includes("INSERT INTO journal_audit"))!;
  assert.ok(journal);
  assert.ok(!JSON.stringify(journal.values).includes("data:image"), "la photo base64 ne doit pas être écrite dans journal_audit");
  assert.match(String(journal.values[5]), /"photo":true/);
});
