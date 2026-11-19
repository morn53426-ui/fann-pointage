import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gererRequete } from "./routes.ts";
import type { Contexte, Reponse } from "./routes.ts";
import { creerDemo } from "./demo.ts";
import { dakarDateTime } from "../shared/time.ts";

const NOW = new Date("2026-10-12T10:00:00.000Z");
const MDP = "Securite-Tests-2026!";
function monter() {
  const { magasin } = creerDemo(NOW, { motDePasse: MDP });
  const ctx: Contexte = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => magasin.horloge };
  return { ctx, magasin };
}
import { LimiteurTentatives } from "./auth.ts";

type Opts = { corps?: unknown; jeton?: string; q?: Record<string, string>; ip?: string };
const appel = (ctx: Contexte, methode: string, chemin: string, o: Opts = {}): Promise<Reponse> =>
  gererRequete(ctx, { methode, chemin, requete: o.q ?? {}, corps: o.corps, ip: o.ip ?? `ip-${o.jeton ?? "test"}`, entetes: { authorization: o.jeton ? `Bearer ${o.jeton}` : undefined } });
async function connecter(ctx: Contexte, identifiant: string, motDePasse = MDP): Promise<string> {
  const reponse = await appel(ctx, "POST", "/api/connexion", { corps: { identifiant, motDePasse }, ip: `login-${identifiant}` });
  assert.equal(reponse.statut, 200, `connexion ${identifiant}`);
  return (reponse.corps as { jeton: string }).jeton;
}
async function creerAgent(ctx: Contexte, admin: string, opts: { prenom: string; nom: string; regime: "general" | "garde" | "urgences" | "mobil"; serviceId?: string }) {
  const reponse = await appel(ctx, "POST", "/api/agents", { jeton: admin, corps: { prenom: opts.prenom, nom: opts.nom, matricule: `TEST-${opts.prenom}-${opts.nom}`, regime: opts.regime, serviceId: opts.serviceId ?? (opts.regime === "urgences" ? "s-urg" : opts.regime === "garde" || opts.regime === "mobil" ? "s-gar" : "s-gen"), photoDataUrl: "data:image/jpeg;base64,/9j/4A==" } });
  assert.equal(reponse.statut, 201, JSON.stringify(reponse.corps));
  return (reponse.corps as { agent: { id: string } }).agent.id;
}

test("planning général : 08 h–16 h du lundi au vendredi, hors jours fériés", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  const ferie = await appel(ctx, "POST", "/api/jours-feries", { jeton: admin, corps: { date: "2026-10-14", nom: "Jour de test", note: "test automatique" } });
  assert.equal(ferie.statut, 201);
  const agentId = await creerAgent(ctx, admin, { prenom: "Awa", nom: "Test", regime: "general" });
  const reponse = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-12", dateFin: "2026-10-18" } });
  assert.equal(reponse.statut, 201, JSON.stringify(reponse.corps));
  assert.equal((reponse.corps as { nombrePostes: number }).nombrePostes, 4);
  const postes = magasin.entrees.filter((e) => e.agentId === agentId).map((e) => e.poste);
  assert.equal(postes.length, 4);
  assert.deepEqual(postes.map((p) => p.debut.toISOString().slice(0, 10)), ["2026-10-12", "2026-10-13", "2026-10-15", "2026-10-16"]);
  assert.ok(postes.every((p) => p.debut.getUTCHours() === 8 && p.fin.getTime() - p.debut.getTime() === 8 * 3600_000));
  assert.ok(!postes.some((p) => [0, 6].includes(p.debut.getUTCDay())), "aucun poste le week-end");
  assert.ok(!postes.some((p) => p.debut.toISOString().slice(0, 10) === "2026-10-14"), "aucun poste le jour férié");
});

test("garde : cycle de 24 h avec 48 h de repos, même si le début tombe un jour férié", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  assert.equal((await appel(ctx, "POST", "/api/jours-feries", { jeton: admin, corps: { date: "2026-12-25", nom: "Noël" } })).statut, 201);
  const agentId = await creerAgent(ctx, admin, { prenom: "Ibra", nom: "Garde", regime: "garde" });
  const response = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-12-25", dateFin: "2026-12-31" } });
  assert.equal(response.statut, 201, JSON.stringify(response.corps));
  const postes = magasin.entrees.filter((e) => e.agentId === agentId).map((e) => e.poste);
  assert.equal(postes.length, 3);
  assert.equal(postes[0].debut.toISOString(), "2026-12-25T08:00:00.000Z");
  assert.equal(postes[0].fin.getTime() - postes[0].debut.getTime(), 24 * 3600_000);
  assert.equal(postes[1].debut.getTime() - postes[0].debut.getTime(), 72 * 3600_000);
});

test("urgences : les cycles jour et nuit respectent les horaires et repos annoncés", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  const jour = await creerAgent(ctx, admin, { prenom: "Fatou", nom: "Jour", regime: "urgences" });
  const nuit = await creerAgent(ctx, admin, { prenom: "Moussa", nom: "Nuit", regime: "urgences" });
  const jourResult = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId: jour, dateDebut: "2026-10-12", dateFin: "2026-10-20", equipeUrgences: "jour" } });
  const nuitResult = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId: nuit, dateDebut: "2026-10-12", dateFin: "2026-10-20", equipeUrgences: "nuit" } });
  assert.equal(jourResult.statut, 201, JSON.stringify(jourResult.corps));
  assert.equal(nuitResult.statut, 201, JSON.stringify(nuitResult.corps));
  const pJour = magasin.entrees.filter((e) => e.agentId === jour).map((e) => e.poste);
  const pNuit = magasin.entrees.filter((e) => e.agentId === nuit).map((e) => e.poste);
  // 12/10/2026 est un lundi : lundi, mercredi, vendredi, puis règle du vendredi (mardi 08 h pour le jour) ; la nuit : lundi, jeudi, dimanche (repos de 60 h).
  assert.deepEqual(pJour.map((p) => p.debut.toISOString()), ["2026-10-12T08:00:00.000Z", "2026-10-14T08:00:00.000Z", "2026-10-16T08:00:00.000Z", "2026-10-20T08:00:00.000Z"]);
  assert.deepEqual(pNuit.map((p) => p.debut.toISOString()), ["2026-10-12T20:00:00.000Z", "2026-10-15T20:00:00.000Z", "2026-10-18T20:00:00.000Z"]);
  assert.equal(pNuit[0].fin.toISOString(), "2026-10-13T08:00:00.000Z");
  assert.equal(pNuit[1].debut.getTime() - pNuit[0].debut.getTime(), 72 * 3600_000);
});

test("Mobil jour : le backend exclut week-ends et jours fériés par défaut", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  assert.equal((await appel(ctx, "POST", "/api/jours-feries", { jeton: admin, corps: { date: "2026-10-14", nom: "Férié Mobil test" } })).statut, 201);
  const agentId = await creerAgent(ctx, admin, { prenom: "Aminata", nom: "MobilJour", regime: "mobil" });
  const response = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-12", dateFin: "2026-10-18", equipeMobil: "jour" } });
  assert.equal(response.statut, 201, JSON.stringify(response.corps));
  const postes = magasin.entrees.filter((e) => e.agentId === agentId).map((e) => e.poste);
  assert.deepEqual(postes.map((p) => p.debut.toISOString()), ["2026-10-12T08:00:00.000Z", "2026-10-13T08:00:00.000Z", "2026-10-15T08:00:00.000Z", "2026-10-16T08:00:00.000Z"]);
  assert.ok(postes.every((p) => p.type === "jour" && p.fin.getTime() - p.debut.getTime() === 8 * 3_600_000));
  assert.ok(!postes.some((p) => [0, 6].includes(new Date(p.debut.toISOString().slice(0, 10) + "T12:00:00Z").getUTCDay())));
});

test("Mobil jour : les exceptions week-end et férié doivent être explicites", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  await appel(ctx, "POST", "/api/jours-feries", { jeton: admin, corps: { date: "2026-10-14", nom: "Férié Mobil test" } });
  const agentId = await creerAgent(ctx, admin, { prenom: "Binta", nom: "MobilException", regime: "mobil" });
  const response = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-12", dateFin: "2026-10-18", equipeMobil: "jour", inclureWeekEndsMobil: true, inclureJoursFeriesMobil: true } });
  assert.equal(response.statut, 201, JSON.stringify(response.corps));
  assert.equal(magasin.entrees.filter((e) => e.agentId === agentId).length, 7);
});

test("Mobil nuit : les gardes incluent les week-ends et jours fériés", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  await appel(ctx, "POST", "/api/jours-feries", { jeton: admin, corps: { date: "2026-10-17", nom: "Férié Mobil test" } });
  const agentId = await creerAgent(ctx, admin, { prenom: "Cheikh", nom: "MobilNuit", regime: "mobil" });
  const response = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-17", dateFin: "2026-10-20", equipeMobil: "nuit", groupeNuitMobil: "A" } });
  assert.equal(response.statut, 201, JSON.stringify(response.corps));
  const postes = magasin.entrees.filter((e) => e.agentId === agentId).map((e) => e.poste);
  assert.deepEqual(postes.map((p) => p.debut.toISOString()), ["2026-10-17T08:00:00.000Z", "2026-10-20T16:00:00.000Z"]);
  assert.equal(postes[0]!.fin.toISOString(), "2026-10-18T08:00:00.000Z");
  assert.equal(postes[1]!.debut.getTime() - postes[0]!.fin.getTime(), 56 * 3600_000);
});

test("Mobil garde : un jour férié en semaine déclenche automatiquement 08 h–08 h", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  await appel(ctx, "POST", "/api/jours-feries", { jeton: admin, corps: { date: "2026-10-14", nom: "Jour férié Mobil" } });
  const agentId = await creerAgent(ctx, admin, { prenom: "Mame", nom: "FerieMobil", regime: "mobil" });
  const response = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-14", dateFin: "2026-10-14", equipeMobil: "nuit", groupeNuitMobil: "A" } });
  assert.equal(response.statut, 201, JSON.stringify(response.corps));
  const poste = magasin.entrees.find((e) => e.agentId === agentId)?.poste;
  assert.equal(poste?.debut.toISOString(), "2026-10-14T08:00:00.000Z");
  assert.equal(poste?.fin.toISOString(), "2026-10-15T08:00:00.000Z");
});

test("Mobil nuit : une garde normale est suivie d'au moins 56 h de repos et le backend bloque une garde trop proche", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  const agentId = await creerAgent(ctx, admin, { prenom: "Moussa", nom: "ReposMobil", regime: "mobil" });
  const first = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-12", dateFin: "2026-10-18", equipeMobil: "nuit", groupeNuitMobil: "A" } });
  assert.equal(first.statut, 201, JSON.stringify(first.corps));
  const postes = magasin.entrees.filter((e) => e.agentId === agentId).map((e) => e.poste);
  assert.equal(postes[0]!.debut.toISOString(), "2026-10-12T16:00:00.000Z");
  assert.equal(postes[0]!.fin.toISOString(), "2026-10-13T08:00:00.000Z");
  assert.equal(postes[1]!.debut.toISOString(), "2026-10-15T16:00:00.000Z");
  assert.equal(postes[1]!.debut.getTime() - postes[0]!.fin.getTime(), 56 * 3_600_000);
  const second = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-12", dateFin: "2026-10-18", equipeMobil: "nuit", groupeNuitMobil: "B" } });
  assert.equal(second.statut, 409, JSON.stringify(second.corps));
  assert.match(JSON.stringify(second.corps), /repos/i);
});

test("permissions : seuls les administrateurs modifient le calendrier et gèrent les comptes", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), responsable = await connecter(ctx, "responsable"), agent = await connecter(ctx, "agent-n1");
  assert.equal((await appel(ctx, "POST", "/api/jours-feries", { jeton: responsable, corps: { date: "2026-12-25", nom: "Noël" } })).statut, 403);
  assert.equal((await appel(ctx, "GET", "/api/plannings", { jeton: agent })).statut, 403);
  assert.equal((await appel(ctx, "GET", "/api/utilisateurs", { jeton: responsable })).statut, 403);
  const nouveau = await appel(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: { identifiant: "responsable-test", motDePasse: "un-secret-superieur-a-12", role: "responsable", servicesGeres: ["s-gen"] } });
  assert.equal(nouveau.statut, 201, JSON.stringify(nouveau.corps));
  const u = (nouveau.corps as { utilisateur: { id: string } }).utilisateur;
  const jetonNouveau = await connecter(ctx, "responsable-test", "un-secret-superieur-a-12");
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton: jetonNouveau })).statut, 200);
  const liste = await appel(ctx, "GET", "/api/utilisateurs", { jeton: admin });
  const entree = ((liste.corps as { utilisateurs: Array<Record<string, unknown>> }).utilisateurs).find((x) => x.id === u.id)!;
  assert.equal("hash" in entree, false);
  assert.equal((await appel(ctx, "PATCH", `/api/utilisateurs/${u.id}`, { jeton: admin, corps: { motDePasse: "un-nouveau-secret-2026" } })).statut, 200);
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton: jetonNouveau })).statut, 401, "la réinitialisation révoque l'ancien jeton");
  assert.equal((await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "responsable-test", motDePasse: "un-secret-superieur-a-12" }, ip: "ancien-mdp" })).statut, 401);
  const jetonReinitialise = await connecter(ctx, "responsable-test", "un-nouveau-secret-2026");
  assert.equal((await appel(ctx, "DELETE", `/api/utilisateurs/${u.id}`, { jeton: admin })).statut, 200);
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton: jetonReinitialise })).statut, 401);
  assert.equal((await appel(ctx, "PATCH", `/api/utilisateurs/${u.id}`, { jeton: admin, corps: { actif: true } })).statut, 200);
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton: jetonReinitialise })).statut, 401, "la réactivation ne restaure pas une ancienne session");
  const jetonFinal = await connecter(ctx, "responsable-test", "un-nouveau-secret-2026");
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton: jetonFinal })).statut, 200);
});

test("persistance locale : calendrier, plannings et comptes ajoutés sont restaurés", async () => {
  const rep = await mkdtemp(join(tmpdir(), "fann-pointage-tests-"));
  try {
    const premier = creerDemo(NOW, { motDePasse: MDP }).magasin;
    await premier.activerPersistanceLocale(join(rep, "data.json"));
    const service = premier.services.find((s) => s.id === "s-gen")!;
    const agent = { id: "agent-persistant-test", prenom: "Test", nom: "Persistant", matricule: "PERSIST-001", serviceId: service.id, regime: "general" as const, actif: true };
    await premier.ajouterAgentManuellement(agent);
    await premier.ajouterJourFerie({ date: "2026-12-25", nom: "Noël", note: null, creePar: "admin", creeLe: NOW.toISOString() });
    await premier.ajouterPlanningManuel(agent.id, { posteId: "general:service:2026-12-24T08:00:00.000Z", regime: "general", type: "service", debut: dakarDateTime(2026, 12, 24, 8), fin: dakarDateTime(2026, 12, 24, 16), planningId: "manual-test-persistant" });
    await premier.ajouterUtilisateurManuel({ id: "compte-persistant-test", identifiant: "persistant-test", hash: "scrypt$YWJj$YWJj", role: "responsable", agentId: null, servicesGeres: [service.id], actif: true });
    const second = creerDemo(NOW, { motDePasse: MDP }).magasin;
    await second.activerPersistanceLocale(join(rep, "data.json"));
    assert.ok(second.infosAgents.some((a) => a.id === agent.id));
    assert.equal(second.joursFeries.get("2026-12-25")?.nom, "Noël");
    assert.ok(second.entrees.some((e) => e.agentId === agent.id && e.poste.planningId === "manual-test-persistant"));
    assert.equal(second.utilisateurParIdentifiant("persistant-test")?.role, "responsable");
  } finally { await rm(rep, { recursive: true, force: true }); }
});


test("modification de planning : horaires, jours fériés et week-ends généralistes vérifiés côté serveur", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  const agent = await creerAgent(ctx, admin, { prenom: "Mame", nom: "Planning", regime: "general" });
  const cree = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId: agent, dateDebut: "2026-10-15", dateFin: "2026-10-15" } });
  assert.equal(cree.statut, 201, JSON.stringify(cree.corps));
  const id = (cree.corps as { postes: Array<{ planningId: string }> }).postes[0].planningId;
  const wrongHour = await appel(ctx, "PATCH", `/api/plannings/${id}`, { jeton: admin, corps: { debut: "2026-10-16T09:00:00.000Z", fin: "2026-10-16T17:00:00.000Z", motif: "Remplacement validé" } });
  assert.equal(wrongHour.statut, 400, JSON.stringify(wrongHour.corps));
  assert.match(JSON.stringify(wrongHour.corps), /commencer à 08 h 00/);
  assert.equal((await appel(ctx, "POST", "/api/jours-feries", { jeton: admin, corps: { date: "2026-10-16", nom: "Férié de test" } })).statut, 201);
  const holiday = await appel(ctx, "PATCH", `/api/plannings/${id}`, { jeton: admin, corps: { debut: "2026-10-16T08:00:00.000Z", fin: "2026-10-16T16:00:00.000Z", motif: "Déplacement nécessaire" } });
  assert.equal(holiday.statut, 409, JSON.stringify(holiday.corps));
  const weekend = await appel(ctx, "PATCH", `/api/plannings/${id}`, { jeton: admin, corps: { debut: "2026-10-17T08:00:00.000Z", fin: "2026-10-17T16:00:00.000Z", motif: "Remplacement validé" } });
  assert.equal(weekend.statut, 409, JSON.stringify(weekend.corps));
  assert.match(JSON.stringify(weekend.corps), /lundi au vendredi/);
  const valid = await appel(ctx, "PATCH", `/api/plannings/${id}`, { jeton: admin, corps: { debut: "2026-10-19T08:00:00.000Z", fin: "2026-10-19T16:00:00.000Z", motif: "Remplacement validé" } });
  assert.equal(valid.statut, 200, JSON.stringify(valid.corps));
});

test("intégration API : le serveur refuse de générer deux fois le même poste général", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  const agentId = await creerAgent(ctx, admin, { prenom: "Aminata", nom: "Doublon", regime: "general" });
  const demande = { agentId, dateDebut: "2026-10-15", dateFin: "2026-10-15" };

  const premiere = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: demande });
  assert.equal(premiere.statut, 201, JSON.stringify(premiere.corps));
  const seconde = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: demande });
  assert.equal(seconde.statut, 409, JSON.stringify(seconde.corps));
  assert.match(JSON.stringify(seconde.corps), /chevauche/);
  assert.equal(magasin.entrees.filter((e) => e.agentId === agentId).length, 1, "le refus ne doit pas créer de doublon");
});

test("intégration API : le backend refuse une garde avant l'expiration des 48 h de repos", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  const agentId = await creerAgent(ctx, admin, { prenom: "Moussa", nom: "Repos", regime: "garde" });

  const premiere = await appel(ctx, "POST", "/api/plannings", {
    jeton: admin,
    corps: { agentId, dateDebut: "2026-10-12", dateFin: "2026-10-12" },
  });
  assert.equal(premiere.statut, 201, JSON.stringify(premiere.corps));

  // La première garde finit le mardi 13 à 08 h ; le repos obligatoire se termine jeudi 15 à 08 h.
  const tropTot = await appel(ctx, "POST", "/api/plannings", {
    jeton: admin,
    corps: { agentId, dateDebut: "2026-10-13", dateFin: "2026-10-13" },
  });
  assert.equal(tropTot.statut, 409, JSON.stringify(tropTot.corps));
  assert.match(JSON.stringify(tropTot.corps), /Repos de 48 h non respecté/);
  assert.equal(magasin.entrees.filter((e) => e.agentId === agentId).length, 1, "le poste incompatible ne doit pas être enregistré");
});

test("service général qui termine avant 16 h : l'heure de fin est fixée à la création et bornée de 10 h à 16 h", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  const agentId = await creerAgent(ctx, admin, { prenom: "Fatou", nom: "Tot", regime: "general" });
  const ok = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-12", dateFin: "2026-10-13", heureFin: 14 } });
  assert.equal(ok.statut, 201, JSON.stringify(ok.corps));
  const postes = magasin.entrees.filter((e) => e.agentId === agentId).map((e) => e.poste);
  assert.equal(postes.length, 2);
  assert.ok(postes.every((p) => p.fin.getTime() - p.debut.getTime() === 6 * 3600_000));
  const trop = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-20", dateFin: "2026-10-20", heureFin: 18 } });
  assert.equal(trop.statut, 400);
  const tot = await appel(ctx, "POST", "/api/plannings", { jeton: admin, corps: { agentId, dateDebut: "2026-10-20", dateFin: "2026-10-20", heureFin: 8 } });
  assert.equal(tot.statut, 400);
});

test("pointage personnel : l'agent connecté pointe avec son propre matricule ou badge ; celui d'un autre est refusé", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  const reponse = await appel(ctx, "POST", "/api/agents", { jeton: admin, corps: { prenom: "Awa", nom: "Perso", matricule: "FANN-777", regime: "general", serviceId: "s-gen", photoDataUrl: "data:image/jpeg;base64,/9j/4A==" } });
  assert.equal(reponse.statut, 201, JSON.stringify(reponse.corps));
  const agentId = (reponse.corps as { agent: { id: string } }).agent.id;
  const compte = await appel(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: { identifiant: "awa.perso", motDePasse: MDP, role: "brancardier", agentId } });
  assert.equal(compte.statut, 201, JSON.stringify(compte.corps));
  const jeton = await connecter(ctx, "awa.perso");
  const corps = (extra: Record<string, unknown>) => ({ idempotencyKey: `cle-${Math.random()}`, permission: "refusee", position: null, ...extra });
  // Matricule d'un autre agent : refusé avant tout enregistrement.
  const autre = await appel(ctx, "POST", "/api/pointage", { jeton, corps: corps({ matricule: "FANN-001" }) });
  assert.equal(autre.statut, 403, JSON.stringify(autre.corps));
  // Badge d'un autre agent : refusé.
  const badgeAutre = await appel(ctx, "POST", "/api/pointage", { jeton, corps: corps({ badgeCode: "FANN-BADGE:autre-agent" }) });
  assert.equal(badgeAutre.statut, 403);
  // Son propre matricule : la requête est acceptée et traitée (localisation refusée → non confirmée, mais enregistrée sans QR).
  const propre = await appel(ctx, "POST", "/api/pointage", { jeton, corps: corps({ matricule: "fann-777" }) });
  assert.equal(propre.statut, 200, JSON.stringify(propre.corps));
  const r = propre.corps as { confirme: boolean; code: string | null; type: string | null };
  assert.equal(r.confirme, false);
  assert.equal(r.code, "permission_refusee");
  const enregistre = magasin.pointages.filter((p) => p.agentId === agentId);
  assert.equal(enregistre.length, 1);
  assert.equal(enregistre[0]!.source, "matricule_perso");
  assert.equal(enregistre[0]!.tokenHash, null);
  // Badge + QR en même temps : requête ambiguë refusée.
  const double = await appel(ctx, "POST", "/api/pointage", { jeton, corps: corps({ matricule: "FANN-777", qrToken: "x" }) });
  assert.equal(double.statut, 400);
});
