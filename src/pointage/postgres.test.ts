import { test } from "node:test";
import assert from "node:assert/strict";
import { DepotPointagePostgres, type ClientPg, type PoolPg, type ResultatPg } from "./postgres.ts";
import { ErreurDoublon, type NouveauPointage } from "./service.ts";

const now = new Date("2026-10-13T10:00:00.000Z");
const seedPointage = (overrides: Partial<NouveauPointage> = {}): NouveauPointage => ({
  agentId: "11111111-1111-4111-8111-111111111111",
  serviceId: "22222222-2222-4222-8222-222222222222",
  planningId: "33333333-3333-4333-8333-333333333333",
  posteId: "urgences:jour:2026-10-13T08:00:00.000Z",
  zoneId: "44444444-4444-4444-8444-444444444444",
  type: "arrivee", serverTs: now, capturedTs: null, validation: "accepte", motifRefus: null,
  idempotencyKey: "idem-123", statutLocalisation: "dans_zone", latitude: 14.7, longitude: -17.4,
  precisionM: 12, positionCollecteeLe: now, distanceM: 22, methodeLoc: "gps", positionSuspecte: false,
  appVersion: "test", tokenHash: "a".repeat(64), source: "qr_pwa", valideManuellementPar: null,
  motifValidationManuelle: null, ...overrides,
});

class FakePg implements PoolPg {
  calls: { sql: string; values: readonly unknown[] }[] = [];
  responses: ((sql: string, values: readonly unknown[]) => ResultatPg | undefined)[] = [];
  failureOnInsert: unknown = null;
  released = 0;
  async query(sql: string, values: readonly unknown[] = []): Promise<ResultatPg> {
    this.calls.push({ sql, values });
    for (const response of this.responses) {
      const result = response(sql, values);
      if (result !== undefined) return result;
    }
    return { rows: [] };
  }
  async connect(): Promise<ClientPg> {
    const self = this;
    return {
      query: async (sql: string, values: readonly unknown[] = []): Promise<ResultatPg> => {
        self.calls.push({ sql, values });
        if (/INSERT INTO pointages/i.test(sql) && self.failureOnInsert) throw self.failureOnInsert;
        for (const response of self.responses) {
          const candidate = response(sql, values);
          if (candidate !== undefined) return candidate;
        }
        return { rows: [] };
      },
      release: () => { self.released += 1; },
    };
  }
}

const rowPointage = (id = "55555555-5555-4555-8555-555555555555") => ({
  id, agentId: "11111111-1111-4111-8111-111111111111", serviceId: "22222222-2222-4222-8222-222222222222",
  planningId: "33333333-3333-4333-8333-333333333333", posteId: "urgences:jour:2026-10-13T08:00:00.000Z",
  zoneId: "44444444-4444-4444-8444-444444444444", type: "arrivee", serverTs: now, capturedTs: null,
  validation: "accepte", motifRefus: null, idempotencyKey: "idem-123", statutLocalisation: "dans_zone",
  latitude: "14.7", longitude: "-17.4", precisionM: "12", positionCollecteeLe: now, distanceM: "22",
  methodeLoc: "gps", positionSuspecte: false, appVersion: "test", tokenHash: "a".repeat(64), source: "qr_pwa",
  valideManuellementPar: null, motifValidationManuelle: null,
});

test("dépôt PostgreSQL : secret QR trop court est refusé", () => {
  assert.throws(() => new DepotPointagePostgres(new FakePg(), "court", () => now), /32 caractères/);
});

test("agent courant est chargé avec son affectation active au jour de Dakar", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /FROM agents a[\s\S]*JOIN LATERAL/i.test(sql) ? { rows: [{ id: "agent-uuid", actif: true, serviceId: "service-uuid", regime: "urgences" }] } : undefined);
  const d = new DepotPointagePostgres(db, "x".repeat(40), () => now);
  assert.deepEqual(await d.agent("11111111-1111-4111-8111-111111111111"), { id: "agent-uuid", actif: true, serviceId: "service-uuid", regime: "urgences" });
  assert.match(db.calls[0].sql, /Africa\/Dakar/);
  assert.equal(db.calls[0].values[0], "11111111-1111-4111-8111-111111111111");
  assert.equal(db.calls[0].values[1], now);
});

test("zone PostgreSQL convertit explicitement les colonnes numériques", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /FROM zones_pointage WHERE id/i.test(sql) ? { rows: [{ id: "z", nom: "Urgences", serviceId: "s", latitude: "14.7", longitude: "-17.4", rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser", actif: true }] } : undefined);
  const d = new DepotPointagePostgres(db, "x".repeat(40), () => now);
  const z = await d.zone("44444444-4444-4444-8444-444444444444");
  if (!z) throw new Error("Zone de test non chargée");
  assert.equal(z.latitude, 14.7);
  assert.equal(z.longitude, -17.4);
  assert.equal(z.rayonM, 150);
});

test("enregistrer utilise une transaction, lie les paramètres et commit seulement après relecture", async () => {
  const db = new FakePg();
  db.responses.push(
    (sql) => /SELECT id::text AS id FROM qr_tokens/i.test(sql) ? { rows: [{ id: "66666666-6666-4666-8666-666666666666" }] } : undefined,
    (sql) => /INSERT INTO pointages/i.test(sql) ? { rows: [{ id: "55555555-5555-4555-8555-555555555555" }] } : undefined,
    (sql) => /SELECT[\s\S]*FROM pointages p LEFT JOIN qr_tokens/i.test(sql) ? { rows: [rowPointage()] } : undefined,
  );
  const d = new DepotPointagePostgres(db, "x".repeat(40), () => now);
  const saved = await d.enregistrer(seedPointage());
  assert.equal(saved.id, "55555555-5555-4555-8555-555555555555");
  assert.equal(saved.latitude, 14.7);
  assert.equal(saved.tokenHash, "a".repeat(64));
  assert.deepEqual(db.calls.map((x) => x.sql.trim().split(/\s+/)[0].toUpperCase()).filter((x) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(x)), ["BEGIN", "COMMIT"]);
  const lookupQr = db.calls.find((x) => /SELECT id::text AS id FROM qr_tokens/i.test(x.sql));
  if (!lookupQr) throw new Error("Requête de vérification QR absente");
  assert.match(lookupQr.sql, /token_hash = \$1 AND zone_id = \$2::uuid/);
  assert.match(lookupQr.sql, /issued_at <= \$3::timestamptz AND expires_at > \$3::timestamptz/);
  // Régression : FOR SHARE exige aussi UPDATE sur la table, que le rôle runtime ne possède pas.
  // La validation/consommation avec verrou reste garantie par le trigger SQL SECURITY DEFINER.
  assert.doesNotMatch(lookupQr.sql.replace(/--.*$/gm, ""), /\bFOR\s+(?:NO KEY UPDATE|UPDATE|SHARE|KEY SHARE)\b/i);
  const insert = db.calls.find((x) => /INSERT INTO pointages/i.test(x.sql));
  if (!insert) throw new Error("Requête INSERT absente");
  assert.match(insert.sql, /qr_token_id/);
  assert.ok(insert.values.includes("idem-123"));
  assert.equal(insert.values[23], "66666666-6666-4666-8666-666666666666");
  assert.equal(db.released, 1);
});

test("une violation de la clé d'idempotence fait rollback et lève ErreurDoublon", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /SELECT id::text AS id FROM qr_tokens/i.test(sql) ? { rows: [{ id: "66666666-6666-4666-8666-666666666666" }] } : undefined);
  db.failureOnInsert = Object.assign(new Error("duplicate key"), { code: "23505", constraint: "pointages_agent_id_idempotency_key_key" });
  const d = new DepotPointagePostgres(db, "x".repeat(40), () => now);
  await assert.rejects(d.enregistrer(seedPointage()), ErreurDoublon);
  assert.ok(db.calls.some((x) => x.sql === "ROLLBACK"));
  assert.ok(!db.calls.some((x) => x.sql === "COMMIT"));
  assert.equal(db.released, 1);
});

test("le journal utilise des paramètres SQL, pas une concaténation de détails", async () => {
  const db = new FakePg();
  const d = new DepotPointagePostgres(db, "x".repeat(40), () => now);
  await d.journaliser({ type: "qr_invalide", agentId: "agent", at: now, detail: { note: "valeur'; DROP TABLE agents; --" } });
  assert.match(db.calls[0].sql, /INSERT INTO journal_audit/);
  assert.ok(!db.calls[0].sql.includes("DROP TABLE"));
  assert.equal((db.calls[0].values[3] as string).includes("DROP TABLE"), true);
});
