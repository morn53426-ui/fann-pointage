import { test } from "node:test";
import assert from "node:assert/strict";
import { gererRequete } from "./routes.ts";
import type { Contexte, Reponse } from "./routes.ts";
import { creerDemo } from "./demo.ts";
import { LimiteurTentatives } from "./auth.ts";

const NOW = new Date("2026-10-12T10:00:00.000Z");
const MDP = "Securite-Tests-2026!";
function monter() {
  const { magasin } = creerDemo(NOW, { motDePasse: MDP });
  const ctx: Contexte = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => magasin.horloge };
  return { ctx, magasin };
}
type Opts = { corps?: unknown; jeton?: string; q?: Record<string, string> };
const appel = (ctx: Contexte, methode: string, chemin: string, o: Opts = {}): Promise<Reponse> =>
  gererRequete(ctx, { methode, chemin, requete: o.q ?? {}, corps: o.corps, ip: `ip-${o.jeton ?? "test"}`, entetes: { authorization: o.jeton ? `Bearer ${o.jeton}` : undefined } });
async function connecter(ctx: Contexte, identifiant: string): Promise<string> {
  const r = await appel(ctx, "POST", "/api/connexion", { corps: { identifiant, motDePasse: MDP } });
  assert.equal(r.statut, 200, `connexion ${identifiant}`);
  return (r.corps as { jeton: string }).jeton;
}

test("émargement : aperçu par service, export Excel, droits et dates invalides", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  const serviceId = "s-gen"; // service général de la démo
  const cree = await appel(ctx, "POST", "/api/agents", { jeton: admin, corps: { prenom: "Awa", nom: "Test", matricule: "EMARG-1", regime: "general", serviceId, photoDataUrl: "data:image/jpeg;base64,/9j/4A==" } });
  assert.equal(cree.statut, 201, JSON.stringify(cree.corps));
  const agentId = (cree.corps as { agent: { id: string } }).agent.id;
  const plan = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-12", dateFin: "2026-10-16" } });
  assert.equal(plan.statut, 201, JSON.stringify(plan.corps));

  const apercu = await appel(ctx, "GET", "/api/emargement", { jeton: admin, q: { date: "2026-10-14" } });
  assert.equal(apercu.statut, 200, JSON.stringify(apercu.corps));
  const e = apercu.corps as { debut: string; fin: string; numeroSemaine: number; services: { serviceId: string; agents: { agentId: string; jours: string[]; planifie: boolean }[] }[] };
  assert.equal(e.debut, "2026-10-12"); assert.equal(e.fin, "2026-10-18"); assert.equal(e.numeroSemaine, 2);
  const ligne = e.services.find((s) => s.serviceId === serviceId)!.agents.find((a) => a.agentId === agentId)!;
  assert.equal(ligne.planifie, true);
  assert.deepEqual(ligne.jours, ["poste", "poste", "poste", "poste", "poste", "ferme", "ferme"]);

  const xlsx = await appel(ctx, "GET", "/api/emargement", { jeton: admin, q: { date: "2026-10-14", format: "xlsx" } });
  assert.equal(xlsx.statut, 200);
  const c = xlsx.corps as { nomFichier: string; contenuBase64: string };
  assert.equal(c.nomFichier, "emargement-brancardiers-2026-10-12.xlsx");
  assert.equal(Buffer.from(c.contenuBase64, "base64").readUInt32LE(0), 0x04034b50);

  assert.equal((await appel(ctx, "GET", "/api/emargement", { jeton: admin, q: { date: "2026-13-45" } })).statut, 400);
  const agentJeton = await connecter(ctx, "agent-n1");
  assert.equal((await appel(ctx, "GET", "/api/emargement", { jeton: agentJeton })).statut, 403);
  assert.equal((await appel(ctx, "POST", "/api/emargement", { jeton: admin })).statut, 405);
});

test("émargement : un responsable ne voit que ses services", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), resp = await connecter(ctx, "responsable");
  const toutes = ((await appel(ctx, "GET", "/api/emargement", { jeton: admin, q: { date: "2026-10-12" } })).corps as { services: unknown[] }).services.length;
  const siennes = ((await appel(ctx, "GET", "/api/emargement", { jeton: resp, q: { date: "2026-10-12" } })).corps as { services: unknown[] }).services.length;
  assert.ok(siennes <= toutes);
});
