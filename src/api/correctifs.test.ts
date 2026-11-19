// Tests de non-régression des correctifs d'audit (octobre 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerDemo } from "./demo.ts";
import { gererRequete } from "./routes.ts";
import { LimiteurTentatives } from "./auth.ts";
import { ipClient } from "./serveur.ts";

const MDP = "Test-Mdp-Long-123456";
const now = new Date("2026-10-14T10:00:00Z");

async function contexte() {
  const { magasin } = creerDemo(now, { motDePasse: MDP });
  magasin.horloge = now;
  const ctx = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => now };
  const appel = (methode: string, chemin: string, jeton?: string, corps?: unknown, requete: Record<string, string> = {}) =>
    gererRequete(ctx, { methode, chemin, requete, corps, entetes: { authorization: jeton ? `Bearer ${jeton}` : undefined }, ip: "10.0.0.1" });
  const jeton = async (id: string) => ((await appel("POST", "/api/connexion", undefined, { identifiant: id, motDePasse: MDP })).corps as { jeton: string }).jeton;
  return { appel, jeton };
}

test("rapport JSON : coordonnées exactes réservées à l'administrateur", async () => {
  const { appel, jeton } = await contexte();
  const [admin, resp, agent] = [await jeton("admin"), await jeton("responsable"), await jeton("agent-n1")];
  const qr = (await appel("GET", "/api/qr", admin, undefined, { zoneId: "z-s-gen" })).corps as { token: string };
  const pt = (await appel("POST", "/api/pointage", agent, { qrToken: qr.token, idempotencyKey: "k1", permission: "accordee",
    position: { latitude: 14.0, longitude: -17.0, precisionM: 10, ageMs: 100 } })).corps as { validation: string };
  assert.equal(pt.validation, "accepte");
  const q = { type: "jour", date: "2026-10-14" };
  const ligne = (r: { corps?: unknown }) => (r.corps as { lignes: { agentId: string; latitude: number | null; longitude: number | null }[] }).lignes.find((l) => l.agentId === "n1")!;
  assert.equal(ligne(await appel("GET", "/api/rapports", admin, undefined, q)).latitude, 14);
  const r = ligne(await appel("GET", "/api/rapports", resp, undefined, q));
  assert.equal(r.latitude, null); assert.equal(r.longitude, null);
  const h = ligne(await appel("GET", "/api/historique", agent, undefined, q));
  assert.equal(h.latitude, null);
});

test("ipClient : X-Forwarded-For ignoré sauf TRUST_PROXY", () => {
  const rq = { socket: { remoteAddress: "172.18.0.1" }, headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.2" } };
  assert.equal(ipClient(rq, false), "172.18.0.1");
  // Dernier maillon = celui du proxy de confiance ; le premier est falsifiable par le client.
  assert.equal(ipClient(rq, true), "10.0.0.2");
  assert.equal(ipClient({ socket: { remoteAddress: "172.18.0.1" }, headers: { "x-forwarded-for": ["1.1.1.1", "198.51.100.9"] } }, true), "198.51.100.9");
  assert.equal(ipClient({ socket: { remoteAddress: "172.18.0.1" }, headers: { "x-forwarded-for": "<script>" } }, true), "172.18.0.1");
});

test("limitation de connexion : la casse et les espaces de l'identifiant ne contournent pas le blocage", async () => {
  const { appel } = await contexte();
  const variantes = ["admin", "ADMIN", " Admin", "aDmIn ", "admin", "ADMIN"];
  const statuts: number[] = [];
  for (const identifiant of variantes) statuts.push((await appel("POST", "/api/connexion", undefined, { identifiant, motDePasse: "mauvais-mot-de-passe" })).statut);
  assert.deepEqual(statuts, [401, 401, 401, 401, 401, 429]);
});
