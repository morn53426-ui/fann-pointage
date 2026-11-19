// Compteurs (messages, anomalies) et retour du scan QR : règles métier, périmètres, fiabilité.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OperationsPostgres } from "./operations-postgres.ts";
import type { Utilisateur } from "./magasin.ts";
import type { PoolPg, ResultatPg } from "../pointage/postgres.ts";
import type { Requete } from "./routes.ts";

const web = fileURLToPath(new URL("../../web", import.meta.url));
const { formaterCompteur, libelleAccessible, fusionnerCompteurs, aAugmente } = (await import(pathToFileURL(`${web}/compteurs.js`).href)) as {
  formaterCompteur(n: unknown): string; libelleAccessible(c: string, n: number): string;
  fusionnerCompteurs(p: { messages: number | null; anomalies: number | null } | null, r: unknown): { messages: number | null; anomalies: number | null };
  aAugmente(a: unknown, b: unknown): boolean;
};
const { creerGardeScan, niveauPointageAgent, niveauPointageStation } = (await import(pathToFileURL(`${web}/scan-pointage.js`).href)) as {
  creerGardeScan(o?: { delaiMs?: number; maintenant?: () => number }): { accepter(c: string): boolean; terminer(o?: { rearmer?: boolean }): void; enCours: boolean };
  niveauPointageAgent(r: unknown): string; niveauPointageStation(r: unknown): string;
};
const { creerSignalStation } = (await import(pathToFileURL(`${web}/signal-station.js`).href)) as {
  creerSignalStation(env: unknown): { preparer(): void; jouer(n: string): void; signaler(n: string, t: string, c: string, o?: unknown): Promise<boolean> };
};

const SERVICE = "33333333-3333-4333-8333-333333333333";
const AUTRE_SERVICE = "44444444-4444-4444-8444-444444444444";
const mkUser = (id: string, role: Utilisateur["role"], extra: Partial<Utilisateur> = {}): Utilisateur => ({ id, identifiant: id.slice(0, 4), hash: "", role, agentId: role === "brancardier" ? "22222222-2222-4222-8222-222222222222" : null, servicesGeres: [], actif: true, ...extra });
const admin = mkUser("11111111-1111-4111-8111-111111111111", "administrateur");
const responsable = mkUser("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "responsable", { servicesGeres: [SERVICE] });
const agentA = mkUser("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "brancardier");
const agentB = mkUser("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "brancardier", { agentId: "55555555-5555-4555-8555-555555555555" });
const M1 = "e0000000-0000-4000-8000-000000000001", M2 = "e0000000-0000-4000-8000-000000000002", M3 = "e0000000-0000-4000-8000-000000000003";
const now = new Date("2026-10-23T10:00:00Z");
const secret = "fann-test-secret-long-and-random-0123456789";
const req = (methode: string, chemin: string, corps?: unknown, requete: Record<string, string> = {}): Requete => ({ methode, chemin, requete, corps, entetes: {}, ip: "127.0.0.1" });

/** Base simulée avec état : messages visibles par compte, lectures, pointages en anomalie et suivi. */
function base() {
  const messages = [{ id: M1, pour: [agentA.id] }, { id: M2, pour: [agentA.id] }, { id: M3, pour: [agentB.id] }];
  const lectures = new Set<string>();           // `${messageId}|${userId}`
  const anomalies = [{ id: "d0000000-0000-4000-8000-000000000001", service: SERVICE }, { id: "d0000000-0000-4000-8000-000000000002", service: SERVICE }, { id: "d0000000-0000-4000-8000-000000000003", service: AUTRE_SERVICE }];
  const suivi = new Map<string, string>();
  const appels: { sql: string; values: readonly unknown[] }[] = [];
  const query = async (sql: string, values: readonly unknown[] = []): Promise<ResultatPg> => {
    appels.push({ sql, values });
    if (sql.includes("FROM messages_diffusion m") && sql.includes("count(*)::int AS n")) {
      const uid = String(values[0]);
      return { rows: [{ n: messages.filter((m) => m.pour.includes(uid) && !lectures.has(`${m.id}|${uid}`)).length }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO messages_lectures")) { lectures.add(`${values[0]}|${values[1]}`); return { rows: [{ message_id: values[0] }], rowCount: 1 }; }
    if (sql.includes("FILTER(WHERE sv.statut IS NULL)")) {
      const admin_ = values[1] === true; const services = values[2] as string[];
      const visibles = anomalies.filter((a) => admin_ || services.includes(a.service));
      return { rows: [{ nouvelles: visibles.filter((a) => !suivi.has(a.id)).length, consultees: visibles.filter((a) => suivi.get(a.id) === "consultee").length }], rowCount: 1 };
    }
    if (sql.includes("SELECT 1 FROM pointages x WHERE x.id=$1::uuid")) {
      const a = anomalies.find((x) => x.id === values[0]);
      const ok = a && (values[1] === true || (values[2] as string[]).includes(a.service));
      return { rows: ok ? [{ "?column?": 1 }] : [], rowCount: ok ? 1 : 0 };
    }
    if (sql.includes("INSERT INTO anomalies_suivi")) { suivi.set(String(values[0]), String(values[1])); return { rows: [], rowCount: 1 }; }
    if (sql.includes("FROM pointages x JOIN agents a")) {
      const admin_ = values[1] === true; const services = values[2] as string[]; const filtre = String(values[3]);
      const rows = anomalies.filter((a) => admin_ || services.includes(a.service)).map((a) => ({ pointageId: a.id, agentId: "x", agent: "Awa Ndiaye", service: "S", validation: "a_verifier", localisation: "dans_zone", position_suspecte: false, motif_refus: "", at: now.toISOString(), serviceId: a.service, statut: suivi.get(a.id) ?? "nouvelle", statutLe: null }))
        .filter((r) => filtre === "toutes" || (filtre === "a_suivre" ? r.statut !== "traitee" : r.statut === filtre));
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as PoolPg;
  return { pool, appels, suivi, ops: () => new OperationsPostgres(pool, secret) };
}
const compteurs = async (b: ReturnType<typeof base>, u: Utilisateur) => (await b.ops().gerer(req("GET", "/api/compteurs"), u, now))!.corps as { messagesNonLus: number; anomaliesNouvelles: number | null; anomaliesConsultees: number | null };

// ---------- Messagerie ----------
test("messagerie : un agent sans message non lu n'a aucun compteur actif", async () => {
  const b = base();
  assert.equal((await compteurs(b, mkUser("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "brancardier"))).messagesNonLus, 0);
  assert.equal(formaterCompteur(0), "", "zéro : pastille masquée");
});
test("messagerie : deux messages reçus donnent un compteur de deux, propre à l'agent", async () => {
  const b = base();
  assert.equal((await compteurs(b, agentA)).messagesNonLus, 2);
  assert.equal((await compteurs(b, agentB)).messagesNonLus, 1, "l'agent B ne voit jamais le compteur de l'agent A");
  const appel = b.appels.find((a) => a.sql.includes("count(*)::int AS n"));
  assert.equal(appel?.values[0], agentA.id, "le compteur est calculé pour l'identifiant de la session, jamais pour un identifiant fourni par le client");
  const reponse = await b.ops().gerer(req("GET", "/api/compteurs", undefined, { userId: agentB.id }), agentA, now);
  assert.equal((reponse!.corps as { messagesNonLus: number }).messagesNonLus, 2, "un identifiant manipulé dans l'URL est ignoré");
});
test("messagerie : la lecture diminue le compteur et le résultat survit à une actualisation (nouvelle instance)", async () => {
  const b = base();
  assert.equal((await compteurs(b, agentA)).messagesNonLus, 2);
  await b.ops().gerer(req("POST", `/api/messages/${M1}/lu`, {}), agentA, now).catch(() => null);
  // la simulation enregistre la lecture sur l'INSERT réel de marquerMessageLu
  assert.equal((await compteurs(b, agentA)).messagesNonLus, 1);
  assert.equal((await compteurs(b, agentA)).messagesNonLus, 1, "rechargement : la valeur vient de la base, pas du navigateur");
});
test("compteurs : agent sans droit d'encadrement, aucune donnée d'anomalie (ni requête)", async () => {
  const b = base();
  const c = await compteurs(b, agentA);
  assert.equal(c.anomaliesNouvelles, null);
  assert.ok(!b.appels.some((a) => a.sql.includes("anomalies_suivi")), "aucune lecture des anomalies pour un agent");
  const refus = await b.ops().gerer(req("GET", "/api/anomalies"), agentA, now).catch((e) => ({ erreur: e }));
  assert.ok(refus === null || "erreur" in refus || (refus as { statut: number }).statut >= 400, "un agent ne consulte pas les anomalies");
  const refusStatut = await b.ops().gerer(req("POST", `/api/anomalies/d0000000-0000-4000-8000-000000000001/statut`, { statut: "traitee" }), agentA, now).catch((e) => ({ erreur: e }));
  assert.ok(refusStatut === null || "erreur" in refusStatut || (refusStatut as { statut: number }).statut >= 400);
  assert.equal(b.suivi.size, 0);
});

// ---------- Administration ----------
test("anomalies : l'administrateur voit les nouvelles ; ouvrir la liste ne change aucun statut", async () => {
  const b = base();
  assert.equal((await compteurs(b, admin)).anomaliesNouvelles, 3);
  const liste = await b.ops().gerer(req("GET", "/api/anomalies"), admin, now);
  const items = (liste!.corps as { anomalies: { statut: string }[] }).anomalies;
  assert.equal(items.length, 3);
  assert.ok(items.every((a) => a.statut === "nouvelle"));
  assert.equal(b.suivi.size, 0, "la consultation de la liste ne modifie rien");
  assert.equal((await compteurs(b, admin)).anomaliesNouvelles, 3);
});
test("anomalies : consultée puis traitée suivent la règle explicite et mettent le compteur à jour", async () => {
  const b = base(); const id = "d0000000-0000-4000-8000-000000000001";
  assert.equal((await b.ops().gerer(req("POST", `/api/anomalies/${id}/statut`, { statut: "consultee" }), admin, now))!.statut, 200);
  let c = await compteurs(b, admin);
  assert.deepEqual([c.anomaliesNouvelles, c.anomaliesConsultees], [2, 1], "consultée : ne compte plus comme nouvelle, reste à suivre");
  await b.ops().gerer(req("POST", `/api/anomalies/${id}/statut`, { statut: "traitee" }), admin, now);
  c = await compteurs(b, admin);
  assert.deepEqual([c.anomaliesNouvelles, c.anomaliesConsultees], [2, 0]);
  const defaut = (await b.ops().gerer(req("GET", "/api/anomalies"), admin, now))!.corps as { anomalies: unknown[] };
  assert.equal(defaut.anomalies.length, 2, "une anomalie traitée sort de la liste « à suivre »");
  const toutes = (await b.ops().gerer(req("GET", "/api/anomalies", undefined, { statut: "toutes" }), admin, now))!.corps as { anomalies: unknown[] };
  assert.equal(toutes.anomalies.length, 3, "le filtre « toutes » la conserve");
  assert.ok(b.appels.some((a) => a.sql.includes("INSERT INTO journal_audit")), "chaque changement de statut est audité");
});
test("anomalies : le responsable reste dans son périmètre et les entrées invalides sont refusées", async () => {
  const b = base();
  assert.equal((await compteurs(b, responsable)).anomaliesNouvelles, 2, "l'anomalie d'un autre service n'est pas comptée");
  await assert.rejects(() => b.ops().gerer(req("POST", `/api/anomalies/d0000000-0000-4000-8000-000000000003/statut`, { statut: "traitee" }), responsable, now), /introuvable|périmètre/i);
  await assert.rejects(() => b.ops().gerer(req("POST", `/api/anomalies/d0000000-0000-4000-8000-000000000001/statut`, { statut: "supprimee" }), admin, now), /Statut attendu/);
  await assert.rejects(() => b.ops().gerer(req("POST", `/api/anomalies/pas-un-uuid/statut`, { statut: "traitee" }), admin, now), /invalide/i);
  await assert.rejects(() => b.ops().gerer(req("GET", "/api/anomalies", undefined, { statut: "x'; DROP TABLE" }), admin, now), /invalide/i);
  assert.equal(b.suivi.size, 0);
});
test("compteurs : toutes les requêtes sont paramétrées (aucune valeur interpolée dans le SQL)", async () => {
  const b = base();
  await compteurs(b, responsable);
  await b.ops().gerer(req("POST", `/api/anomalies/d0000000-0000-4000-8000-000000000001/statut`, { statut: "consultee" }), responsable, now);
  for (const a of b.appels) { assert.ok(!a.sql.includes(responsable.id) && !a.sql.includes(SERVICE), "aucun identifiant dans le texte SQL"); }
});

// ---------- Interface : logique des compteurs ----------
test("compteurs web : 99+, libellés accessibles, aucune remise à zéro sur erreur réseau", () => {
  assert.equal(formaterCompteur(3), "3"); assert.equal(formaterCompteur(99), "99"); assert.equal(formaterCompteur(100), "99+"); assert.equal(formaterCompteur(250), "99+");
  assert.equal(libelleAccessible("messages", 3), "3 messages non lus"); assert.equal(libelleAccessible("messages", 1), "1 message non lu");
  assert.equal(libelleAccessible("anomalies", 5), "5 anomalies en attente");
  const avant = { messages: 4, anomalies: 5 };
  assert.deepEqual(fusionnerCompteurs(avant, null), avant, "erreur API : valeurs conservées");
  assert.deepEqual(fusionnerCompteurs(avant, { messagesNonLus: "x", anomaliesNouvelles: -1 }), avant, "valeurs invalides ignorées");
  assert.deepEqual(fusionnerCompteurs(avant, { messagesNonLus: 0, anomaliesNouvelles: 7 }), { messages: 0, anomalies: 7 }, "un vrai zéro envoyé par le serveur est pris en compte");
  assert.equal(aAugmente({ messages: 1, anomalies: null }, { messages: 2, anomalies: 0 }), true);
  assert.equal(aAugmente({ messages: 2, anomalies: 1 }, { messages: 2, anomalies: 1 }), false, "le même événement reçu deux fois n'est pas compté deux fois");
});

// ---------- Scanner QR ----------
function environnement(opts: { vibration?: boolean } = {}) {
  const frequences: number[] = []; const vibrations: number[][] = [];
  class FauxAudio { state = "running"; currentTime = 0; destination = {}; resume() { return Promise.resolve(); }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() { const o = { type: "", frequency: { value: 0 }, connect() {}, stop() {}, start() { frequences.push(o.frequency.value); } }; return o; } }
  const navigator: Record<string, unknown> = {};
  if (opts.vibration !== false) navigator.vibrate = (p: number[]) => { vibrations.push(p); return true; };
  return { env: { AudioContext: FauxAudio, navigator, document: { hidden: false }, localStorage: { getItem: () => null, setItem() {} } }, frequences, vibrations };
}
/** Même enchaînement que web/app.js : garde → requête serveur → niveau → signal. */
async function scanner(code: string, garde: ReturnType<typeof creerGardeScan>, serveur: () => Promise<unknown>, signal: ReturnType<typeof creerSignalStation>) {
  if (!garde.accepter(code)) return "ignore";
  try {
    const r = await serveur();
    const n = niveauPointageAgent(r);
    garde.terminer({ rearmer: n !== "ok" });
    await signal.signaler(n, "t", "c", { arrierePlanSeulement: true });
    return n;
  } catch { garde.terminer({ rearmer: true }); await signal.signaler("ko", "t", "c", { arrierePlanSeulement: true }); return "ko"; }
}
test("scan : QR valide confirmé par le serveur → un bip et une vibration", async () => {
  const { env, frequences, vibrations } = environnement(); const s = creerSignalStation(env); s.preparer();
  assert.equal(await scanner("QR1", creerGardeScan(), async () => ({ confirme: true, validation: "accepte" }), s), "ok");
  assert.deepEqual(frequences, [660, 880], "signature « ok » jouée une seule fois"); assert.deepEqual(vibrations, [[80]]);
});
test("scan : un seul scan détecté dix fois ne déclenche qu'un envoi, un bip et une vibration", async () => {
  const { env, frequences, vibrations } = environnement(); const s = creerSignalStation(env); s.preparer();
  const garde = creerGardeScan(); let envois = 0;
  const serveur = async () => { envois++; await new Promise((r) => setTimeout(r, 5)); return { confirme: true }; };
  const resultats = await Promise.all(Array.from({ length: 10 }, () => scanner("QR1", garde, serveur, s)));
  assert.equal(envois, 1); assert.equal(resultats.filter((r) => r === "ok").length, 1);
  assert.equal(frequences.length, 2); assert.equal(vibrations.length, 1);
  assert.equal(await scanner("QR1", garde, serveur, s), "ignore", "le même code juste après un succès reste ignoré (anti double pointage)");
  assert.equal(envois, 1);
});
test("scan : refus serveur, QR invalide, panne réseau ne produisent jamais le retour de succès", async () => {
  for (const serveur of [async () => ({ confirme: false, validation: "refuse" }), async () => ({ confirme: false, validation: "non_enregistre" }), async () => { throw new TypeError("réseau"); }]) {
    const { env, frequences, vibrations } = environnement(); const s = creerSignalStation(env); s.preparer();
    const n = await scanner("QR-X", creerGardeScan(), serveur, s);
    assert.equal(n, "ko");
    assert.deepEqual(frequences, [300], "uniquement le bip d'échec, jamais 660/880");
    assert.deepEqual(vibrations, [[300]]);
  }
  assert.equal(niveauPointageAgent({ confirme: false, validation: "a_verifier" }), "attention", "à vérifier n'est pas présenté comme réussi");
  assert.equal(niveauPointageAgent(undefined), "ko");
  assert.equal(niveauPointageStation({ validation: "a_verifier" }), "attention");
  assert.equal(niveauPointageStation({ validation: "accepte" }), "ok");
});
test("scan : après un refus ou une panne, le même code peut être re-présenté immédiatement", async () => {
  const { env } = environnement(); const s = creerSignalStation(env); s.preparer(); const garde = creerGardeScan();
  assert.equal(await scanner("QR1", garde, async () => { throw new TypeError("réseau"); }, s), "ko");
  assert.equal(await scanner("QR1", garde, async () => ({ confirme: true }), s), "ok");
});
test("scan : le garde laisse repasser le même code après le délai, et accepte un autre code", () => {
  let t = 1_000_000; const garde = creerGardeScan({ delaiMs: 8000, maintenant: () => t });
  assert.equal(garde.accepter("A"), true); garde.terminer();
  assert.equal(garde.accepter("A"), false); t += 7999; assert.equal(garde.accepter("A"), false);
  assert.equal(garde.accepter("B"), true); garde.terminer();
  t += 8001; assert.equal(garde.accepter("A"), true);
  assert.equal(garde.accepter(""), false);
});
test("scan : l'absence de vibration ou de son ne bloque jamais le pointage", async () => {
  const { env, frequences } = environnement({ vibration: false }); const s = creerSignalStation(env); s.preparer();
  assert.equal(await scanner("QR1", creerGardeScan(), async () => ({ confirme: true }), s), "ok");
  assert.equal(frequences.length, 2);
  const nu = creerSignalStation({}); nu.preparer();
  assert.equal(await scanner("QR2", creerGardeScan(), async () => ({ confirme: true }), nu), "ok", "ni audio ni vibration : le pointage aboutit");
});
test("scan : l'interface n'émet plus de bip à la lecture et relie les modules (non-régression)", () => {
  const app = readFileSync(`${web}/app.js`, "utf8");
  assert.ok(!/rawValue[^]{0,500}signal\.jouer\("scan"\)/.test(app), "pas de bip avant la confirmation du serveur");
  assert.match(app, /from "\/scan-pointage\.js"/); assert.match(app, /from "\/compteurs\.js"/);
  assert.match(app, /\/api\/compteurs/); assert.match(app, /Pointage enregistré avec succès/);
  const sw = readFileSync(`${web}/sw.js`, "utf8");
  assert.ok(sw.includes("/compteurs.js") && sw.includes("/scan-pointage.js"));
  const migration = readFileSync(new URL("../../supabase/migrations/0025_anomalies_suivi.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /drop\s+(table|column)|delete\s+from|truncate/i);
});
