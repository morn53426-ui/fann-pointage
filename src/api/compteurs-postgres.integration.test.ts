// Test d'intégration sur une VRAIE base PostgreSQL (migrations appliquées). Ignoré si FANN_TEST_DATABASE_URL n'est pas défini.
// Exemple : FANN_TEST_DATABASE_URL=postgres://fann_test:***@127.0.0.1:5432/fann_pointage_test node --test src/api/compteurs-postgres.integration.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { OperationsPostgres } from "./operations-postgres.ts";
import type { Utilisateur } from "./magasin.ts";
import type { PoolPg } from "../pointage/postgres.ts";
import type { Requete } from "./routes.ts";

const url = process.env.FANN_TEST_DATABASE_URL;
const now = new Date();
const req = (methode: string, chemin: string, corps?: unknown, requete: Record<string, string> = {}): Requete => ({ methode, chemin, requete, corps, entetes: {}, ip: "127.0.0.1" });
const user = (id: string, role: Utilisateur["role"], agentId: string | null, servicesGeres: string[] = []): Utilisateur => ({ id, identifiant: id.slice(0, 8), hash: "", role, agentId, servicesGeres, actif: true });

test("PostgreSQL réel : compteurs de messages et d'anomalies, statuts, périmètres", { skip: url ? false : "FANN_TEST_DATABASE_URL non défini" }, async () => {
  const pool = new pg.Pool({ connectionString: url });
  const p = pool as unknown as PoolPg;
  const tag = randomUUID().slice(0, 8);
  try {
    const [s1, s2] = (await pool.query("SELECT id::text FROM services ORDER BY nom LIMIT 2")).rows.map((r) => r.id as string);
    const adminId = randomUUID(), respId = randomUUID(), agentUid = randomUUID(), autreUid = randomUUID();
    const agentId = (await pool.query("INSERT INTO agents(nom,prenom,matricule) VALUES($1,'Test',$2) RETURNING id::text", [`Cmp${tag}`, `M${tag}`])).rows[0].id as string;
    const autreAgentId = (await pool.query("INSERT INTO agents(nom,prenom,matricule) VALUES($1,'Autre',$2) RETURNING id::text", [`Aut${tag}`, `N${tag}`])).rows[0].id as string;
    for (const [id, role, ag] of [[adminId, "administrateur", null], [respId, "responsable", null], [agentUid, "brancardier", agentId], [autreUid, "brancardier", autreAgentId]] as const) {
      await pool.query("INSERT INTO profiles(user_id,role,agent_id) VALUES($1,$2,$3)", [id, role, ag]);
    }
    await pool.query("INSERT INTO responsable_services(user_id,service_id) VALUES($1,$2)", [respId, s1]);
    const pointage = async (service: string) => (await pool.query(
      `INSERT INTO pointages(agent_id,service_id,type,server_ts,validation,idempotency_key,statut_localisation)
       VALUES($1,$2,'arrivee',now(),'a_verifier',$3,'dans_zone') RETURNING id::text`, [agentId, service, randomUUID()])).rows[0].id as string;
    const [a1, a2, a3] = [await pointage(s1!), await pointage(s1!), await pointage(s2!)];

    const admin = user(adminId, "administrateur", null), resp = user(respId, "responsable", null, [s1!]), agent = user(agentUid, "brancardier", agentId), autre = user(autreUid, "brancardier", autreAgentId);
    const ops = () => new OperationsPostgres(p, "fann-test-secret-long-and-random-0123456789");
    const c = async (u: Utilisateur) => (await ops().gerer(req("GET", "/api/compteurs"), u, now))!.corps as { messagesNonLus: number; anomaliesNouvelles: number | null; anomaliesConsultees: number | null };

    // Anomalies : le compteur de l'administrateur compte au moins les 3 pointages créés ; celui du responsable ne compte que son service.
    const avantAdmin = (await c(admin)).anomaliesNouvelles!, avantResp = (await c(resp)).anomaliesNouvelles!;
    await ops().gerer(req("POST", `/api/anomalies/${a1}/statut`, { statut: "consultee" }), admin, now);
    assert.equal((await c(admin)).anomaliesNouvelles, avantAdmin - 1);
    assert.equal((await c(resp)).anomaliesNouvelles, avantResp - 1);
    assert.equal((await c(admin)).anomaliesConsultees! >= 1, true);
    await ops().gerer(req("POST", `/api/anomalies/${a1}/statut`, { statut: "traitee" }), resp, now);
    const liste = (await ops().gerer(req("GET", "/api/anomalies"), resp, now))!.corps as { anomalies: { pointageId: string; statut: string }[] };
    assert.ok(!liste.anomalies.some((a) => a.pointageId === a1), "traitée : sortie de la liste à suivre");
    assert.equal(liste.anomalies.find((a) => a.pointageId === a2)?.statut, "nouvelle", "ouvrir la liste ne modifie aucun statut");
    const toutes = (await ops().gerer(req("GET", "/api/anomalies", undefined, { statut: "toutes" }), resp, now))!.corps as { anomalies: { pointageId: string; statut: string }[] };
    assert.equal(toutes.anomalies.find((a) => a.pointageId === a1)?.statut, "traitee");
    assert.ok(!toutes.anomalies.some((a) => a.pointageId === a3), "le responsable ne voit pas l'autre service");
    await assert.rejects(() => ops().gerer(req("POST", `/api/anomalies/${a3}/statut`, { statut: "traitee" }), resp, now), /introuvable|périmètre/i);
    assert.equal((await c(agent)).anomaliesNouvelles, null);
    assert.equal((await pool.query("SELECT count(*)::int n FROM journal_audit WHERE action='anomalie_statut' AND objet_id=$1", [a1])).rows[0].n, 2);

    // Messages : diffusion ciblée sur un seul compte, lecture, isolation entre agents.
    const avantA = (await c(agent)).messagesNonLus, avantB = (await c(autre)).messagesNonLus;
    const msg = (await ops().gerer(req("POST", "/api/messages", { titre: `Test ${tag}`, contenu: "Bonjour", portee: "comptes", destinataireIds: [agentUid] }), admin, now))!.corps as { message?: { id: string }; id?: string };
    const msgId = msg.message?.id ?? msg.id!;
    assert.equal((await c(agent)).messagesNonLus, avantA + 1);
    assert.equal((await c(autre)).messagesNonLus, avantB, "un autre agent ne voit pas ce message dans son compteur");
    await ops().gerer(req("POST", `/api/messages/${msgId}/lu`, {}), agent, now);
    assert.equal((await c(agent)).messagesNonLus, avantA, "lu : le compteur redescend");
    await assert.rejects(() => ops().gerer(req("POST", `/api/messages/${msgId}/lu`, {}), autre, now), /introuvable|destinataire/i);
    assert.equal((await c(admin)).messagesNonLus, 0);
  } finally { await pool.end(); }
});
