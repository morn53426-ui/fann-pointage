// Règles de pointage par service sur une VRAIE base PostgreSQL (migrations appliquées).
// Ignoré si FANN_TEST_DATABASE_URL n'est pas défini.
// Exemple : FANN_TEST_DATABASE_URL=postgres://fann_test@127.0.0.1:5432/fann_pointage_test node --experimental-strip-types --test src/pointage/regles-service.integration.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { DepotPointagePostgres } from "./postgres.ts";
import type { PoolPg } from "./postgres.ts";
import { traiterPointage } from "./service.ts";
import { emettreQr, emettreQrPermanent } from "./qr.ts";
import { OperationsPostgres } from "../api/operations-postgres.ts";
import type { Utilisateur } from "../api/magasin.ts";
import type { Requete } from "../api/routes.ts";

const url = process.env.FANN_TEST_DATABASE_URL;
const SECRET = "fann-test-secret-long-and-random-0123456789";
const req = (methode: string, chemin: string, corps?: unknown): Requete => ({ methode, chemin, requete: {}, corps, entetes: {}, ip: "127.0.0.1" });
const user = (id: string, role: Utilisateur["role"], servicesGeres: string[] = []): Utilisateur => ({ id, identifiant: id.slice(0, 8), hash: "", role, agentId: null, servicesGeres, actif: true });

test("PostgreSQL réel : QR d'un autre service refusé, badge/matricule partout, rotation, poste de pointage", { skip: url ? false : "FANN_TEST_DATABASE_URL non défini" }, async () => {
  const pool = new pg.Pool({ connectionString: url });
  const p = pool as unknown as PoolPg;
  const tag = randomUUID().slice(0, 8);
  const debut = new Date(Date.UTC(2026, 9, 12, 8, 0, 0));
  let horloge = new Date(debut.getTime() + 10 * 60_000);
  try {
    const service = async (nom: string) => (await pool.query("INSERT INTO services(nom, regime_defaut) VALUES($1,'garde') RETURNING id::text", [`${nom} ${tag}`])).rows[0].id as string;
    const [s1, s2] = [await service("Service A"), await service("Service B")];
    const zone = async (nom: string, serviceId: string, lat: number) => (await pool.query(
      "INSERT INTO zones_pointage(nom, service_id, latitude, longitude, rayon_m) VALUES($1,$2,$3,-17.0,150) RETURNING id::text", [`${nom} ${tag}`, serviceId, lat])).rows[0].id as string;
    const [z1, z2] = [await zone("Zone A", s1, 14.0), await zone("Zone B", s2, 14.05)];
    const agent = async (prenom: string, serviceId: string) => {
      const id = (await pool.query("INSERT INTO agents(nom, prenom, matricule, photo_data_url, profession, adresse, telephone) VALUES($1,$2,$3,'data:image/jpeg;base64,/9j/4A==','Brancardier','Dakar','770000000') RETURNING id::text",
        [`Reg${tag}`, prenom, `R-${prenom}-${tag}`])).rows[0].id as string;
      await pool.query("INSERT INTO agent_affectations(agent_id, service_id, regime, date_debut) VALUES($1,$2,'garde','2026-01-01')", [id, serviceId]);
      return id;
    };
    const [g1, g2, b1] = [await agent("G1", s1), await agent("G2", s1), await agent("B1", s2)];
    // Rotation : deux agents du même service ont la MÊME garde (mêmes dates).
    for (const id of [g1, g2]) {
      await pool.query("INSERT INTO plannings(agent_id, service_id, regime, type_poste, starts_at, ends_at) VALUES($1,$2,'garde','garde',$3,$4)",
        [id, s1, debut, new Date(debut.getTime() + 24 * 3_600_000)]);
    }
    const depot = new DepotPointagePostgres(p, SECRET, () => horloge);
    const pos = (lat: number) => ({ latitude: lat, longitude: -17.0, precisionM: 10, collecteeLe: new Date(horloge.getTime() - 3000).toISOString(), methode: "gps" });
    const qrA = emettreQrPermanent({ zoneId: z1, secret: SECRET }).token;
    const lignes = async (agentId: string) => (await pool.query("SELECT zone_id::text, service_id::text, validation::text, type::text, poste_code FROM pointages WHERE agent_id=$1 ORDER BY server_ts", [agentId])).rows;

    // 1. Rotation : les deux agents pointent leur arrivée dans leur service, sur la même garde.
    for (const id of [g1, g2]) {
      const r = await traiterPointage(depot, { agentId: id, qrToken: qrA, idempotencyKey: `arr-${id}`, permission: "accordee", position: pos(14.0005) });
      assert.deepEqual([r.validation, r.type, r.confirme], ["accepte", "arrivee", true], JSON.stringify(r));
    }
    const postes = (await pool.query("SELECT DISTINCT starts_at FROM plannings WHERE agent_id = ANY($1::uuid[])", [[g1, g2]])).rows;
    assert.equal(postes.length, 1, "même garde pour les deux agents");

    // 2. QR permanent du service A utilisé par un agent du service B : refusé, rien d'enregistré.
    const refus = await traiterPointage(depot, { agentId: b1, qrToken: qrA, idempotencyKey: `b1-qr-perm`, permission: "accordee", position: pos(14.0005) });
    assert.deepEqual([refus.code, refus.enregistre, refus.confirme], ["qr_autre_service", false, false]);

    // 3. QR temporaire du service A : refusé aussi, et non consommé.
    const temp = emettreQr({ zoneId: z1, secret: SECRET, maintenant: horloge });
    await pool.query("INSERT INTO qr_tokens(zone_id, token_hash, issued_at, expires_at) VALUES($1,$2,$3,$4)", [z1, temp.tokenHash, temp.issuedAt, temp.expiresAt]);
    const refus2 = await traiterPointage(depot, { agentId: b1, qrToken: temp.token, idempotencyKey: `b1-qr-temp`, permission: "accordee", position: pos(14.0005) });
    assert.equal(refus2.code, "qr_autre_service");
    assert.equal((await pool.query("SELECT count(*)::int n FROM qr_token_uses u JOIN qr_tokens q ON q.id=u.token_id WHERE q.token_hash=$1", [temp.tokenHash])).rows[0].n, 0);
    assert.equal((await lignes(b1)).length, 0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM journal_audit WHERE action='qr_autre_service_refuse' AND objet_id=$1", [b1])).rows[0].n, 2);

    // 4. Matricule : accepté dans la zone d'un AUTRE service (la base accepte zone ≠ service de l'agent).
    const parMatricule = await traiterPointage(depot, { agentId: b1, qrToken: undefined, idempotencyKey: `b1-mat`, permission: "accordee", position: pos(14.0005), identification: { mode: "matricule" } });
    assert.equal(parMatricule.enregistre, true, JSON.stringify(parMatricule));
    const l = await lignes(b1);
    assert.equal(l.length, 1);
    assert.deepEqual([l[0].zone_id, l[0].service_id], [z1, s2], "zone du service A, agent du service B");

    // 5. Poste de pointage : un responsable du service A pointe l'agent B1 (service B) par badge, mais pas par matricule seul.
    const admin = user(randomUUID(), "administrateur"), resp = user(randomUUID(), "responsable", [s1]);
    await pool.query("INSERT INTO profiles(user_id, role) VALUES($1,'administrateur'),($2,'responsable')", [admin.id, resp.id]);
    await pool.query("INSERT INTO responsable_services(user_id, service_id) VALUES($1,$2)", [resp.id, s1]);
    const ops = new OperationsPostgres(p, SECRET);
    const badge = (await ops.gerer(req("POST", `/api/badges/${b1}/emettre`), admin, horloge))!.corps as { badgeCode: string };
    horloge = new Date(horloge.getTime() + 5 * 60_000);
    await assert.rejects(() => ops.gerer(req("POST", "/api/pointage-station", { matricule: `R-B1-${tag}`, type: "arrivee", idempotencyKey: `st-mat-${tag}` }), resp, horloge), /badge imprimé/);
    const ok = await ops.gerer(req("POST", "/api/pointage-station", { badgeCode: badge.badgeCode, type: "arrivee", idempotencyKey: `st-badge-${tag}` }), resp, horloge);
    assert.equal(ok?.statut, 201);
    const audit = (await pool.query("SELECT nouvelle_valeur FROM journal_audit WHERE action='pointage_station_badge' AND user_id=$1 ORDER BY id DESC LIMIT 1", [resp.id])).rows[0];
    assert.equal(audit.nouvelle_valeur.agentAutreService, true);
    assert.equal(audit.nouvelle_valeur.serviceAgent, s2);
  } finally { await pool.end(); }
});
