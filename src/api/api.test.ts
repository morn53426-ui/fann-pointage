import { test } from "node:test";
import assert from "node:assert/strict";
import { gererRequete } from "./routes.ts";
import type { Contexte, Reponse } from "./routes.ts";
import { LimiteurTentatives, creerSession, hashMotDePasse, lireSessionAvecVersion, verifierMotDePasse } from "./auth.ts";

/** Identifiant de l'utilisateur d'une session valide, sinon null (la production lit aussi la version du compte). */
const lireSession = (token: string | undefined, secret: string, now: Date): string | null => lireSessionAvecVersion(token, secret, now)?.utilisateurId ?? null;
import { creerDemo } from "./demo.ts";

const MDP = "motdepasse-de-test";
const NOW = new Date("2026-10-12T10:00:00Z");   // lundi 10 h

function monter() {
  const { magasin } = creerDemo(NOW, { motDePasse: MDP });
  const ctx: Contexte = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => magasin.horloge };
  return { ctx, magasin };
}
type Opts = { corps?: unknown; jeton?: string; q?: Record<string, string>; ip?: string };
const appel = (ctx: Contexte, methode: string, chemin: string, o: Opts = {}): Promise<Reponse> =>
  gererRequete(ctx, { methode, chemin, requete: o.q ?? {}, corps: o.corps, ip: o.ip ?? "1.1.1.1", entetes: { authorization: o.jeton ? `Bearer ${o.jeton}` : undefined } });
async function connecter(ctx: Contexte, identifiant: string, motDePasse = MDP): Promise<string> {
  const r = await appel(ctx, "POST", "/api/connexion", { corps: { identifiant, motDePasse }, ip: `ip-${identifiant}` });
  assert.equal(r.statut, 200);
  return (r.corps as { jeton: string }).jeton;
}
const position = (o: Record<string, unknown> = {}) => ({ latitude: 14.0005, longitude: -17.0, precisionM: 10, ageMs: 2000, simulee: null, ...o });
async function pointer(ctx: Contexte, jetonAgent: string, jetonQr: string, zoneId: string, o: { pos?: unknown; cle?: string; extra?: Record<string, unknown> } = {}) {
  const qr = await appel(ctx, "GET", "/api/qr", { jeton: jetonQr, q: { zoneId } });
  assert.equal(qr.statut, 200);
  return appel(ctx, "POST", "/api/pointage", { jeton: jetonAgent, corps: {
    qrToken: (qr.corps as { token: string }).token, idempotencyKey: o.cle ?? `cle-${Math.random().toString(36).slice(2)}-xx`,
    permission: "accordee", position: o.pos ?? position(), ...(o.extra ?? {}),
  } });
}

test("mots de passe hachés (scrypt) et sessions signées", () => {
  const h = hashMotDePasse("abc");
  assert.ok(h.startsWith("scrypt$") && !h.includes("abc"));
  assert.equal(verifierMotDePasse("abc", h), true);
  assert.equal(verifierMotDePasse("abd", h), false);
  const s = creerSession("u1", "secret-de-test-0123456789-0123456789-abc", NOW);
  assert.equal(lireSession(s, "secret-de-test-0123456789-0123456789-abc", NOW), "u1");
  assert.equal(lireSession(s, "autre-secret-0123456789-0123456789-abcdef", NOW), null);
  assert.equal(lireSession(s, "secret-de-test-0123456789-0123456789-abc", new Date(NOW.getTime() + 9 * 3600_000)), null);
  assert.equal(lireSession(s.slice(0, -2) + "xx", "secret-de-test-0123456789-0123456789-abc", NOW), null);
  assert.equal(lireSession(s, "secret-de-test-0123456789-0123456789-abc", new Date(NOW.getTime() + 8 * 3600_000)), null);
  assert.equal(lireSession(`${s}.extra`, "secret-de-test-0123456789-0123456789-abc", NOW), null);
});
test("connexion : identifiants invalides, puis limitation après 5 échecs (même IP + identifiant)", async () => {
  const { ctx } = monter();
  const essai = (mdp: string, ip = "9.9.9.9") => appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "admin", motDePasse: mdp }, ip });
  assert.equal((await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "admin" + "x".repeat(80), motDePasse: MDP } })).statut, 400);
  assert.equal((await essai("x".repeat(201))).statut, 400);
  for (let i = 0; i < 5; i++) assert.equal((await essai("mauvais")).statut, 401);
  assert.equal((await essai("mauvais")).statut, 429);
  assert.equal((await essai(MDP)).statut, 429);           // même le bon mot de passe est bloqué
  assert.equal((await essai(MDP, "8.8.8.8")).statut, 200); // autre IP non bloquée
});
test("connexion : limite également les essais par IP quand les identifiants changent", async () => {
  const { ctx } = monter();
  for (let i = 0; i < 30; i++) {
    const r = await appel(ctx, "POST", "/api/connexion", { ip: "7.7.7.7", corps: { identifiant: `inconnu-${i}`, motDePasse: "mauvais" } });
    assert.equal(r.statut, 401, `tentative ${i + 1}`);
  }
  assert.equal((await appel(ctx, "POST", "/api/connexion", { ip: "7.7.7.7", corps: { identifiant: "admin", motDePasse: MDP } })).statut, 429);
});

test("sans jeton, jeton falsifié ou compte révoqué : 401", async () => {
  const { ctx, magasin } = monter();
  assert.equal((await appel(ctx, "GET", "/api/moi")).statut, 401);
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton: "x.y" })).statut, 401);
  const jeton = await connecter(ctx, "admin");
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton })).statut, 200);
  // Aucun droit financier ou drapeau de validation des primes n'est exposé par l'API.
  const jetonAgent = await connecter(ctx, "agent-n1");
  const profilAgent = (await appel(ctx, "GET", "/api/moi", { jeton: jetonAgent })).corps as Record<string, unknown>;
  assert.equal("peutValiderPrimes" in profilAgent, false);
  magasin.utilisateurs.get("user-admin")!.actif = false;
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton })).statut, 401);
});
test("routes privées : méthode HTTP refusée explicitement avec l'en-tête Allow", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  const mauvaisPointage = await appel(ctx, "GET", "/api/pointage", { jeton: admin });
  assert.equal(mauvaisPointage.statut, 405);
  assert.equal(mauvaisPointage.entetes?.Allow, "POST");
  const mauvaisProfil = await appel(ctx, "POST", "/api/moi", { jeton: admin });
  assert.equal(mauvaisProfil.statut, 405);
  assert.equal(mauvaisProfil.entetes?.Allow, "GET, PATCH");
  const validation = await appel(ctx, "GET", "/api/pointages/p1/validation", { jeton: admin });
  assert.equal(validation.statut, 405);
  assert.equal(validation.entetes?.Allow, "POST");
  assert.equal((await appel(ctx, "GET", "/api/route-inconnue", { jeton: admin })).statut, 404);
});

test("pointage de bout en bout : QR émis par l'administrateur, agent authentifié, heure serveur", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin"), n1 = await connecter(ctx, "agent-n1");
  const r = await pointer(ctx, n1, admin, "z-s-gen", { extra: { agentId: "g1", serverTs: "2020-01-01T00:00:00Z" } });
  const c = r.corps as { confirme: boolean; validation: string; type: string; serverTs: string };
  assert.deepEqual([c.confirme, c.validation, c.type], [true, "accepte", "arrivee"]);
  assert.equal(magasin.pointages[0].agentId, "n1");                 // l'identité vient de la session
  assert.equal(c.serverTs, NOW.toISOString());                      // l'heure vient du serveur
});
test("double soumission avec la même clé : un seul enregistrement", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin"), n1 = await connecter(ctx, "agent-n1");
  await pointer(ctx, n1, admin, "z-s-gen", { cle: "cle-fixe-0001" });
  const b = await pointer(ctx, n1, admin, "z-s-gen", { cle: "cle-fixe-0001" });
  assert.equal((b.corps as { rejoue: boolean }).rejoue, true);
  assert.equal(magasin.pointages.length, 1);
});
test("QR : réservé à l'administrateur et aux responsables du service", async () => {
  const { ctx } = monter();
  const [admin, resp, n1] = [await connecter(ctx, "admin"), await connecter(ctx, "responsable"), await connecter(ctx, "agent-n1")];
  assert.equal((await appel(ctx, "GET", "/api/qr", { jeton: n1, q: { zoneId: "z-s-gen" } })).statut, 403);
  assert.equal((await appel(ctx, "GET", "/api/qr", { jeton: resp, q: { zoneId: "z-s-gar" } })).statut, 403); // garde : pas son service
  assert.equal((await appel(ctx, "GET", "/api/qr", { jeton: resp, q: { zoneId: "z-s-urg" } })).statut, 200);
  assert.equal((await appel(ctx, "GET", "/api/qr", { jeton: admin, q: { zoneId: "inconnue" } })).statut, 404);
});
test("QR d'un autre service utilisé par un agent : refusé et non enregistré (badge ou matricule à utiliser)", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin"), n1 = await connecter(ctx, "agent-n1");
  const r = await pointer(ctx, n1, admin, "z-s-urg");
  const c = r.corps as { code: string | null; confirme: boolean; enregistre: boolean };
  assert.deepEqual([c.code, c.confirme, c.enregistre], ["qr_autre_service", false, false]);
  assert.equal(magasin.pointages.length, 0);
});
test("QR du service de l'agent : accepté ; matricule de l'agent : accepté partout dans l'hôpital", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), n1 = await connecter(ctx, "agent-n1");
  const sien = await pointer(ctx, n1, admin, "z-s-gen");
  assert.equal((sien.corps as { confirme: boolean }).confirme, true, JSON.stringify(sien.corps));
  const mat = await appel(ctx, "POST", "/api/pointage", { jeton: await connecter(ctx, "agent-u1"), corps: {
    matricule: "DEMO-u1", idempotencyKey: "cle-matricule-u1-001", permission: "accordee", position: position({ latitude: 14.0005 }),
  } });
  assert.equal(mat.statut, 200, JSON.stringify(mat.corps));
  assert.equal((mat.corps as { enregistre: boolean }).enregistre, true);
});
test("QR permanent : émis par un responsable autorisé, réutilisable, refusé pour un brancardier et pour un service non géré", async () => {
  const { ctx } = monter();
  const [admin, resp, n1] = [await connecter(ctx, "admin"), await connecter(ctx, "responsable"), await connecter(ctx, "agent-n1")];
  assert.equal((await appel(ctx, "GET", "/api/qr", { jeton: n1, q: { zoneId: "z-s-gen", permanent: "1" } })).statut, 403);
  assert.equal((await appel(ctx, "GET", "/api/qr", { jeton: resp, q: { zoneId: "z-s-gar", permanent: "1" } })).statut, 403);
  const a = (await appel(ctx, "GET", "/api/qr", { jeton: admin, q: { zoneId: "z-s-gen", permanent: "1" } })).corps as { token: string; permanent: boolean; expireLe: string | null };
  const b = (await appel(ctx, "GET", "/api/qr", { jeton: admin, q: { zoneId: "z-s-gen", permanent: "1" } })).corps as { token: string };
  assert.equal(a.permanent, true);
  assert.equal(a.expireLe, null);
  assert.equal(a.token, b.token); // même affiche à chaque impression
  const envoi = (cle: string) => appel(ctx, "POST", "/api/pointage", { jeton: n1, corps: { qrToken: a.token, idempotencyKey: cle, permission: "accordee", position: position() } });
  const un = (await envoi("perm-cle-000001")).corps as { code: string | null };
  const deux = (await envoi("perm-cle-000002")).corps as { code: string | null };
  assert.notEqual(un.code, "qr_reutilise");
  assert.notEqual(deux.code, "qr_reutilise");
});

test("badges : imprimables pour les responsables autorisés, aucun accès pour les brancardiers", async () => {
  const { ctx } = monter();
  const [admin, resp, agent] = [await connecter(ctx, "admin"), await connecter(ctx, "responsable"), await connecter(ctx, "agent-n1")];
  const tout = await appel(ctx, "GET", "/api/badges", { jeton: admin });
  assert.equal(tout.statut, 200);
  const badges = (tout.corps as { badges: { agentId: string; badgeCode: string; nom: string }[] }).badges;
  assert.ok(badges.length > 0);
  assert.ok(badges.every((b) => b.badgeCode === `FANN-BADGE:${b.agentId}`));
  assert.equal((await appel(ctx, "GET", "/api/badges", { jeton: agent })).statut, 403);
  const portee = (await appel(ctx, "GET", "/api/badges", { jeton: resp })).corps as { badges: { agentId: string }[] };
  assert.ok(portee.badges.every((b) => !["g1", "g2", "g3"].includes(b.agentId)));
});

test("création d'une fiche agent : service réel, QR individuel et matricule unique", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  const cree = await appel(ctx, "POST", "/api/agents", { jeton: admin, corps: {
    prenom: "Awa", nom: "Ndiaye", matricule: "FANN-2026-001", serviceId: "__nouveau__",
    serviceNom: "Chirurgie plastique", regime: "general", photoDataUrl: "data:image/jpeg;base64,/9j/4A==",
  } });
  assert.equal(cree.statut, 201);
  const contenu = cree.corps as { agent: { id: string; prenom: string; nom: string; serviceId: string; service: string; badgeCode: string }; planningAConfigurer: boolean };
  assert.equal(contenu.agent.prenom, "Awa");
  assert.equal(contenu.agent.nom, "Ndiaye");
  assert.equal(contenu.agent.service, "Chirurgie plastique");
  assert.match(contenu.agent.id, /^[0-9a-f-]{36}$/i);
  assert.match(contenu.agent.badgeCode, new RegExp(`^FANN-BADGE:${contenu.agent.id}:[A-Za-z0-9_-]{40,100}$`));
  assert.equal(contenu.planningAConfigurer, true);

  const agents = (await appel(ctx, "GET", "/api/agents", { jeton: admin })).corps as { agents: { id: string; service: string }[]; services: { nom: string }[] };
  assert.ok(agents.agents.some((a) => a.id === contenu.agent.id && a.service === "Chirurgie plastique"));
  assert.ok(agents.services.some((s) => s.nom === "Chirurgie plastique"));
  const badges = (await appel(ctx, "GET", "/api/badges", { jeton: admin })).corps as { badges: { agentId: string; badgeCode: string; nom: string; serviceId: string; photoDataUrl: string | null }[] };
  assert.ok(badges.badges.some((b) => b.agentId === contenu.agent.id && b.badgeCode === contenu.agent.badgeCode && b.nom === "Ndiaye" && b.serviceId === contenu.agent.serviceId && b.photoDataUrl === "data:image/jpeg;base64,/9j/4A=="));
  const photoModifiee = await appel(ctx, "PATCH", `/api/agents/${contenu.agent.id}`, { jeton: admin, corps: {
    prenom: "Awa", nom: "Ndiaye", matricule: "FANN-2026-001", photoDataUrl: "data:image/jpeg;base64,/9j/4Q==",
  } });
  assert.equal(photoModifiee.statut, 200);
  const badgesApresPhoto = (await appel(ctx, "GET", "/api/badges", { jeton: admin })).corps as { badges: { agentId: string; photoDataUrl: string | null }[] };
  assert.ok(badgesApresPhoto.badges.some((b) => b.agentId === contenu.agent.id && b.photoDataUrl === "data:image/jpeg;base64,/9j/4Q=="), "la photo remplacée est disponible pour le badge");
  const pointageBadge = await appel(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: {
    badgeCode: contenu.agent.badgeCode, type: "arrivee", idempotencyKey: "badge-agent-nouveau-test", horsLigne: false,
  } });
  assert.equal(pointageBadge.statut, 201);
  assert.equal((pointageBadge.corps as { validation: string }).validation, "a_verifier");
  const ancienCode = contenu.agent.badgeCode;
  const renouvellement = await appel(ctx, "POST", `/api/badges/${contenu.agent.id}/renouveler`, { jeton: admin });
  assert.equal(renouvellement.statut, 200);
  const nouveauCode = (renouvellement.corps as { badgeCode: string }).badgeCode;
  assert.notEqual(nouveauCode, ancienCode);
  const ancienQRRefuse = await appel(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: {
    badgeCode: ancienCode, type: "depart", idempotencyKey: "ancien-badge-revoque-test", horsLigne: false,
  } });
  assert.equal(ancienQRRefuse.statut, 403, "l’ancien QR doit être révoqué immédiatement");
  const nouveauQR = await appel(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: {
    badgeCode: nouveauCode, type: "depart", idempotencyKey: "nouveau-badge-valide-test", horsLigne: false,
  } });
  assert.equal(nouveauQR.statut, 201, JSON.stringify(nouveauQR.corps));

  const doublon = await appel(ctx, "POST", "/api/agents", { jeton: admin, corps: {
    prenom: "Autre", nom: "Agent", matricule: "fann-2026-001", serviceId: "s-gen", regime: "general",
  } });
  assert.equal(doublon.statut, 409);
});

test("création de badges : brancardier interdit et responsable limité à ses services", async () => {
  const { ctx } = monter();
  const [admin, resp, agent] = [await connecter(ctx, "admin"), await connecter(ctx, "responsable"), await connecter(ctx, "agent-n1")];
  const corps = { prenom: "Moussa", nom: "Fall", matricule: "FANN-SCOPE-1", serviceId: "s-gar", regime: "garde" };
  assert.equal((await appel(ctx, "GET", "/api/agents", { jeton: agent })).statut, 403);
  assert.equal((await appel(ctx, "POST", "/api/agents", { jeton: agent, corps })).statut, 403);
  assert.equal((await appel(ctx, "POST", "/api/agents", { jeton: resp, corps })).statut, 403);
  assert.equal((await appel(ctx, "POST", "/api/agents", { jeton: resp, corps: { ...corps, serviceId: "__nouveau__", serviceNom: "Pneumologie" } })).statut, 403);
  assert.equal((await appel(ctx, "GET", "/api/agents", { jeton: admin })).statut, 200);
});

test("poste partagé : badge imprimé, arrivée/départ, idempotence, superviseur d'un autre service tracé", async () => {
  const { ctx, magasin } = monter();
  const [admin, resp, brancardier] = [await connecter(ctx, "admin"), await connecter(ctx, "responsable"), await connecter(ctx, "agent-n1")];
  const departSansArrivee = await appel(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: {
    badgeCode: "FANN-BADGE:n1", type: "depart", idempotencyKey: "station-depart-sans-arrivee", horsLigne: false,
  } });
  assert.equal(departSansArrivee.statut, 409);
  assert.equal((await appel(ctx, "POST", "/api/pointage-station", { jeton: brancardier, corps: {
    badgeCode: "FANN-BADGE:n1", type: "arrivee", idempotencyKey: "station-brancardier-refuse", horsLigne: false,
  } })).statut, 403);
  // Le superviseur d'un autre service (ici les urgences) peut pointer l'agent qui lui montre son badge ; le cas est tracé.
  assert.equal((await appel(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: {
    badgeCode: "FANN-BADGE:g1", type: "arrivee", idempotencyKey: "station-hors-service", horsLigne: false,
  } })).statut, 201);
  assert.equal(magasin.journal.some((e) => e.type === "pointage_station_badge" && e.agentId === "g1" && (e.detail as { agentAutreService?: boolean }).agentAutreService === true), true);
  const arrivee = await appel(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: {
    badgeCode: "FANN-BADGE:n1", type: "arrivee", idempotencyKey: "station-arrivee-unique", horsLigne: false,
  } });
  assert.equal(arrivee.statut, 201);
  assert.deepEqual([(arrivee.corps as { validation: string }).validation, magasin.pointages.at(-1)?.source], ["accepte", "station_badge"]);
  const rejeu = await appel(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: {
    badgeCode: "FANN-BADGE:n1", type: "arrivee", idempotencyKey: "station-arrivee-unique", horsLigne: false,
  } });
  assert.equal((rejeu.corps as { rejoue: boolean }).rejoue, true);
  assert.equal(magasin.pointages.filter((p) => p.idempotencyKey === "station-arrivee-unique").length, 1);
  magasin.horloge = new Date("2026-10-12T15:00:00Z");
  const depart = await appel(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: {
    badgeCode: "FANN-BADGE:n1", type: "depart", idempotencyKey: "station-depart-unique", horsLigne: false,
  } });
  assert.equal(depart.statut, 201);
  assert.equal((depart.corps as { validation: string }).validation, "accepte");
});

test("pointage hors ligne synchronisé : conservé en attente de validation et date client bornée", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  const point = await appel(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: {
    badgeCode: "FANN-BADGE:n1", type: "arrivee", idempotencyKey: "offline-arrivee-001", horsLigne: true,
    capturedAt: "2026-10-12T09:59:30.000Z", operateurDeclare: "u-declare",
  } });
  assert.equal(point.statut, 201);
  assert.equal((point.corps as { validation: string }).validation, "a_verifier");
  assert.equal(magasin.pointages.at(-1)?.source, "station_hors_ligne");
  assert.equal(magasin.pointages.at(-1)?.positionSuspecte, false, "l'absence de GPS ne doit pas être assimilée à une fraude de localisation");
  assert.equal(magasin.pointages.at(-1)?.serverTs.toISOString(), NOW.toISOString(), "l'heure officielle est l'heure de réception serveur");
  assert.equal(magasin.pointages.at(-1)?.capturedTs?.toISOString(), "2026-10-12T09:59:30.000Z", "l'heure locale n'est conservée que comme preuve à vérifier");
  assert.equal((point.corps as { capturedAt: string }).capturedAt, "2026-10-12T09:59:30.000Z");
  const tropVieux = await appel(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: {
    badgeCode: "FANN-BADGE:u1", type: "arrivee", idempotencyKey: "offline-arrivee-vieux", horsLigne: true,
    capturedAt: "2026-01-01T09:00:00.000Z",
  } });
  assert.equal(tropVieux.statut, 400);
});
test("brancardier : pas d'accès au tableau de bord, aux anomalies, aux zones, aux synthèses ni aux validations", async () => {
  const { ctx } = monter();
  const n1 = await connecter(ctx, "agent-n1");
  for (const chemin of ["/api/tableau-de-bord", "/api/anomalies", "/api/zones"]) assert.equal((await appel(ctx, "GET", chemin, { jeton: n1 })).statut, 403, chemin);
  assert.equal((await appel(ctx, "GET", "/api/rapports", { jeton: n1, q: { format: "synthese-csv" } })).statut, 403);
  assert.equal((await appel(ctx, "POST", "/api/pointages/p1/validation", { jeton: n1, corps: { motif: "x" } })).statut, 403);
});
test("validation manuelle : responsable du service avec motif ; refusée sinon", async () => {
  const { ctx, magasin } = monter();
  const [admin, resp, n1, g1] = [await connecter(ctx, "admin"), await connecter(ctx, "responsable"), await connecter(ctx, "agent-n1"), await connecter(ctx, "agent-g1")];
  const horsZone = position({ latitude: 14.003 });
  await pointer(ctx, n1, admin, "z-s-gen", { pos: horsZone });
  await pointer(ctx, g1, admin, "z-s-gar", { pos: horsZone });
  const [pn1, pg1] = [magasin.pointages.find((p) => p.agentId === "n1")!, magasin.pointages.find((p) => p.agentId === "g1")!];
  assert.equal(pn1.validation, "refuse");
  assert.equal((await appel(ctx, "POST", `/api/pointages/${pn1.id}/validation`, { jeton: resp, corps: { motif: " " } })).statut, 400);
  assert.equal((await appel(ctx, "POST", `/api/pointages/${pn1.id}/validation`, { jeton: n1, corps: { motif: "moi-même" } })).statut, 403);
  assert.equal((await appel(ctx, "POST", `/api/pointages/${pg1.id}/validation`, { jeton: resp, corps: { motif: "x" } })).statut, 403); // garde : pas son service
  assert.equal((await appel(ctx, "POST", `/api/pointages/${pn1.id}/validation`, { jeton: resp, corps: { motif: "GPS en panne, présence constatée" } })).statut, 200);
  assert.equal(magasin.pointages.find((p) => p.id === pn1.id)!.validation, "valide_manuellement");
  assert.equal((await appel(ctx, "POST", `/api/pointages/${pn1.id}/validation`, { jeton: resp, corps: { motif: "encore" } })).statut, 409);
  assert.equal((await appel(ctx, "POST", "/api/pointages/inexistant/validation", { jeton: admin, corps: { motif: "x" } })).statut, 404);
});
test("historique personnel : uniquement les postes de l'agent connecté", async () => {
  const { ctx } = monter();
  const n1 = await connecter(ctx, "agent-n1");
  const r = await appel(ctx, "GET", "/api/historique", { jeton: n1, q: { type: "semaine", date: "2026-10-12" } });
  const lignes = (r.corps as { lignes: { agentId: string }[] }).lignes;
  assert.ok(lignes.length > 0 && lignes.every((l) => l.agentId === "n1"));
  assert.equal((r.corps as { synthese?: unknown }).synthese, undefined);
  assert.equal((await appel(ctx, "GET", "/api/historique", { jeton: await connecter(ctx, "admin") })).statut, 403); // compte sans agent
});
test("tableau de bord : le responsable ne voit que ses services ; l'administrateur voit tout", async () => {
  const { ctx } = monter();
  const [admin, resp] = [await connecter(ctx, "admin"), await connecter(ctx, "responsable")];
  const a = (await appel(ctx, "GET", "/api/tableau-de-bord", { jeton: admin })).corps as { parRegime: Record<string, { attendus: number }> };
  const r = (await appel(ctx, "GET", "/api/tableau-de-bord", { jeton: resp })).corps as { parRegime: Record<string, { attendus: number }> };
  assert.ok(a.parRegime.garde.attendus > 0 && a.parRegime.urgences.attendus > 0 && a.parRegime.general.attendus > 0);
  assert.equal(r.parRegime.garde.attendus, 0);
  assert.ok(r.parRegime.urgences.attendus > 0);
});
test("rapports CSV : coordonnées exportées seulement pour l'administrateur", async () => {
  const { ctx } = monter();
  const [admin, resp, n1] = [await connecter(ctx, "admin"), await connecter(ctx, "responsable"), await connecter(ctx, "agent-n1")];
  await pointer(ctx, n1, admin, "z-s-gen");
  const q = { format: "csv", type: "jour", date: "2026-10-12" };
  const a = await appel(ctx, "GET", "/api/rapports", { jeton: admin, q });
  const r = await appel(ctx, "GET", "/api/rapports", { jeton: resp, q });
  assert.match(a.typeContenu ?? "", /text\/csv/);
  assert.match(a.texte!, /Latitude/);
  assert.doesNotMatch(r.texte!, /Latitude|Longitude|14\.0005/);
  assert.match(r.entetes!["Content-Disposition"], /attachment/);
});
test("requêtes invalides : 400 ; route inconnue : 404 ; méthode incorrecte : 405", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  assert.equal((await appel(ctx, "GET", "/api/tableau-de-bord", { jeton: admin, q: { regime: "inconnu" } })).statut, 400);
  assert.equal((await appel(ctx, "GET", "/api/tableau-de-bord", { jeton: admin, q: { validation: "inventee" } })).statut, 400);
  assert.equal((await appel(ctx, "GET", "/api/tableau-de-bord", { jeton: admin, q: { statutLocalisation: "GPS-magique" } })).statut, 400);
  assert.equal((await appel(ctx, "GET", "/api/rapports", { jeton: admin, q: { date: "demain" } })).statut, 400);
  assert.equal((await appel(ctx, "GET", "/api/rapports", { jeton: admin, q: { date: "2026-02-31" } })).statut, 400);
  assert.equal((await appel(ctx, "GET", "/api/historique", { jeton: await connecter(ctx, "agent-n1"), q: { date: "2026-04-31" } })).statut, 400);
  assert.equal((await appel(ctx, "GET", "/api/nimporte", { jeton: admin })).statut, 404);
  assert.equal((await appel(ctx, "GET", "/api/connexion")).statut, 405);
});
test("erreur interne : aucun détail technique renvoyé", async () => {
  const { ctx, magasin } = monter();
  const [admin, n1] = [await connecter(ctx, "admin"), await connecter(ctx, "agent-n1")];
  magasin.zone = async () => { throw new Error("secret-interne-xyz"); };
  const r = await pointer(ctx, n1, admin, "z-s-gen").catch((e) => e);
  assert.ok(!JSON.stringify(r).includes("secret-interne-xyz"));
});

test("classement mensuel : accès par rôle, mois terminé et génération unique", async () => {
  const { ctx } = monter();
  const [admin, resp, agentToken] = [await connecter(ctx, "admin"), await connecter(ctx, "responsable"), await connecter(ctx, "agent-n1")];
  const mois = "2026-09-01";
  assert.equal((await appel(ctx, "GET", "/api/classement-mensuel", { jeton: agentToken, q: { mois } })).statut, 403);
  assert.equal((await appel(ctx, "GET", "/api/classement-mensuel", { jeton: resp, q: { mois } })).statut, 200);
  assert.equal((await appel(ctx, "POST", "/api/classement-mensuel/generer", { jeton: resp, corps: { mois } })).statut, 403);
  assert.equal((await appel(ctx, "POST", "/api/classement-mensuel/generer", { jeton: admin, corps: { mois: "2026-10-01" } })).statut, 400);
  assert.equal((await appel(ctx, "POST", "/api/classement-mensuel/generer", { jeton: admin, corps: { mois: "2026-99-01" } })).statut, 400);
  const genere = await appel(ctx, "POST", "/api/classement-mensuel/generer", { jeton: admin, corps: { mois } });
  assert.equal(genere.statut, 201);
  const body = genere.corps as { classement: { id: string; top5: unknown[]; scores: unknown[] }; top5: unknown[] };
  assert.ok(body.classement.id);
  assert.equal(body.top5.length, 5);
  assert.equal(body.classement.top5.length, 5);
  assert.equal((await appel(ctx, "POST", "/api/classement-mensuel/generer", { jeton: admin, corps: { mois } })).statut, 409);
  assert.equal((await appel(ctx, "GET", "/api/classement-mensuel", { jeton: admin, q: { mois } })).statut, 200);
});

test("classement mensuel de bout en bout : huit agents scorés, top 5 classé et export CSV", async () => {
  const { magasin } = creerDemo(NOW, { motDePasse: MDP, donneesClassementDemo: true });
  const ctx: Contexte = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => magasin.horloge };
  const admin = await connecter(ctx, "admin");
  const mois = "2026-09-01";
  const genere = await appel(ctx, "POST", "/api/classement-mensuel/generer", { jeton: admin, corps: { mois } });
  assert.equal(genere.statut, 201);
  const premier = (genere.corps as { classement: { scores: { scoreTotal: number }[]; classement: { rang: number }[]; top5: { rang: number }[] }; top5: { rang: number }[] }).classement;
  assert.equal(premier.scores.length, 8);
  assert.equal(premier.classement.length, 8);
  assert.equal(premier.top5.length, 5);
  assert.deepEqual(premier.top5.map((x) => x.rang), [1, 2, 3, 4, 5]);
  assert.ok(premier.scores.every((s) => Number.isFinite(s.scoreTotal) && s.scoreTotal >= 0 && s.scoreTotal <= 100));
  const csv = await appel(ctx, "GET", "/api/classement-mensuel", { jeton: admin, q: { mois, format: "csv" } });
  assert.equal(csv.statut, 200);
  assert.match(csv.texte ?? "", /Points sur 100/);
  assert.doesNotMatch(csv.texte ?? "", /montant|FCFA|paiement|référence/i);
  assert.equal((await appel(ctx, "GET", "/api/primes", { jeton: admin, q: { mois } })).statut, 404);
  assert.equal((await appel(ctx, "POST", "/api/primes/abc/paiements/u1", { jeton: admin, corps: { referencePaiement: "REF-TEST" } })).statut, 404);
  for (const chemin of ["/api/paiement", "/api/paiements", "/api/moyens-de-paiement", "/api/checkout", "/api/transactions", "/api/webhooks/stripe", "/api/webhooks/wave", "/api/webhooks/orange-money"]) {
    for (const methode of ["GET", "POST"]) {
      assert.equal((await appel(ctx, methode, chemin, { jeton: admin, corps: { montant: 100, provider: "test" } })).statut, 404, `${methode} ${chemin}`);
    }
  }
});

test("limiteur de connexions : mémoire bornée face à des identifiants uniques", () => {
  const limiteur = new LimiteurTentatives(1, 60_000, 2);
  const t = new Date("2026-10-12T10:00:00Z");
  limiteur.echec("ip|a", t);
  limiteur.echec("ip|b", t);
  assert.equal(limiteur.nombreCles, 2);
  assert.equal(limiteur.bloque("ip|a", t), true);
  limiteur.echec("ip|c", t);
  assert.equal(limiteur.nombreCles, 2);
  // La clé la moins récemment utilisée est évincée : le Map ne grossit pas indéfiniment.
  assert.equal(limiteur.bloque("ip|b", t), false);
  assert.equal(limiteur.bloque("ip|a", t), true);
});


test("classement mensuel : un responsable ne voit que ses services, y compris dans Top 5, audit et CSV", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  const responsable = await connecter(ctx, "responsable");
  const mois = "2026-09-01";
  assert.equal((await appel(ctx, "POST", "/api/classement-mensuel/generer", { jeton: admin, corps: { mois } })).statut, 201);

  const reponse = await appel(ctx, "GET", "/api/classement-mensuel", { jeton: responsable, q: { mois } });
  assert.equal(reponse.statut, 200);
  const c = (reponse.corps as {
    classement: {
      classement: { agentId: string; service: string; rang: number }[];
      top5: { agentId: string; service: string; rang: number }[];
      scores: { agentId: string; service: string }[];
      audit: { detail: { top5: { agentId: string }[] } }[];
    };
  }).classement;
  const interdits = ["g1", "g2", "g3"];
  assert.ok(c.classement.length > 0);
  assert.ok(c.classement.every((e) => !interdits.includes(e.agentId)));
  assert.ok(c.scores.every((e) => !interdits.includes(e.agentId)));
  assert.deepEqual(c.classement.map((e) => e.rang), c.classement.map((_, i) => i + 1));
  assert.ok(c.top5.every((e) => !interdits.includes(e.agentId)));
  assert.ok(c.audit.every((e) => e.detail.top5.every((a) => !["g1", "g2", "g3"].includes(a.agentId))));
  const csv = await appel(ctx, "GET", "/api/classement-mensuel", { jeton: responsable, q: { mois, format: "csv" } });
  assert.equal(csv.statut, 200);
  assert.doesNotMatch(csv.texte ?? "", /Neuro-hospitalisation|Démo-4|Démo-5|Démo-6/);
});


test("workflow absence : à confirmer puis décision motivée, portée par service et persistance du statut", async () => {
  const { ctx, magasin } = monter();
  const admin = await connecter(ctx, "admin");
  const resp = await connecter(ctx, "responsable");
  const agent = await connecter(ctx, "agent-n1");
  const creation = await appel(ctx, "POST", "/api/absences", { jeton: resp, corps: {
    agentId: "n1", debut: "2026-10-05", fin: "2026-10-05", categorie: "absence", note: "Absence signalée par le responsable",
  } });
  assert.equal(creation.statut, 201, JSON.stringify(creation.corps));
  const absence = (creation.corps as { absence: { id: string; statut: string } }).absence;
  assert.equal(absence.statut, "a_confirmer");
  assert.equal((await appel(ctx, "GET", "/api/absences", { jeton: agent })).statut, 403);
  const sansMotif = await appel(ctx, "PATCH", `/api/absences/${absence.id}`, { jeton: resp, corps: { statut: "injustifiee", motif: "no" } });
  assert.equal(sansMotif.statut, 400);
  const decision = await appel(ctx, "PATCH", `/api/absences/${absence.id}`, { jeton: resp, corps: { statut: "injustifiee", motif: "Planning confirmé et aucune justification reçue" } });
  assert.equal(decision.statut, 200, JSON.stringify(decision.corps));
  assert.equal(magasin.absences.get(absence.id)?.statut, "injustifiee");
  const redecision = await appel(ctx, "PATCH", `/api/absences/${absence.id}`, { jeton: admin, corps: { statut: "justifiee", motif: "Changement de décision" } });
  assert.equal(redecision.statut, 409, "une décision finale doit être immuable dans le flux courant");
});

test("création d'un second administrateur limitée au compte administrateur déjà authentifié", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  const created = await appel(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: {
    identifiant: "admin-secondaire", motDePasse: "Nouveau-Mot-de-Passe-2026!", role: "administrateur",
  } });
  assert.equal(created.statut, 201, JSON.stringify(created.corps));
  const token = await connecter(ctx, "admin-secondaire", "Nouveau-Mot-de-Passe-2026!");
  assert.equal((await appel(ctx, "GET", "/api/utilisateurs", { jeton: token })).statut, 200);
});


test("export du registre des absences : périmètre de service et neutralisation des formules CSV", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  const created = await appel(ctx, "POST", "/api/absences", { jeton: admin, corps: { agentId: "n1", debut: "2026-10-08", fin: "2026-10-08", categorie: "autre", note: '=HYPERLINK("https://example.invalid")' } });
  assert.equal(created.statut, 201, JSON.stringify(created.corps));
  const resp = await connecter(ctx, "responsable");
  const csv = await appel(ctx, "GET", "/api/absences", { jeton: resp, q: { format: "csv" } });
  assert.equal(csv.statut, 200);
  assert.match(csv.typeContenu ?? "", /text\/csv/i);
  assert.match(csv.texte ?? "", /'=HYPERLINK/);
  const autreServiceAbsence = await appel(ctx, "POST", "/api/absences", { jeton: admin, corps: { agentId: "g1", debut: "2026-10-08", fin: "2026-10-08", categorie: "absence" } });
  assert.equal(autreServiceAbsence.statut, 201);
  const csvResp = await appel(ctx, "GET", "/api/absences", { jeton: resp, q: { format: "csv" } });
  assert.doesNotMatch(csvResp.texte ?? "", /Agent4|Agent5|Agent6/);
});

test("badge : profession, adresse et téléphone sont enregistrés, modifiables, validés et exposés pour l'impression", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  const cree = await appel(ctx, "POST", "/api/agents", { jeton: admin, corps: {
    prenom: "Awa", nom: "Ndiaye", matricule: "FANN-2026-777", serviceId: "__nouveau__", serviceNom: "Imagerie test", regime: "general",
    photoDataUrl: "data:image/jpeg;base64,/9j/4A==", profession: "Chef brancardier", adresse: "Médina, rue 11 x 6, Dakar", telephone: "+221 77 000 00 00",
  } });
  assert.equal(cree.statut, 201);
  const id = (cree.corps as { agent: { id: string } }).agent.id;
  type LigneBadge = { agentId: string; profession: string | null; adresse: string | null; telephone: string | null; photoDataUrl: string | null };
  const lire = async () => ((await appel(ctx, "GET", "/api/badges", { jeton: admin })).corps as { badges: LigneBadge[] }).badges.find((b) => b.agentId === id)!;
  const apres = await lire();
  assert.equal(apres.profession, "Chef brancardier");
  assert.equal(apres.adresse, "Médina, rue 11 x 6, Dakar");
  assert.equal(apres.telephone, "+221 77 000 00 00");

  // Modification : les trois champs changent, la photo n'est pas touchée.
  const modif = await appel(ctx, "PATCH", `/api/agents/${id}`, { jeton: admin, corps: {
    prenom: "Awa", nom: "Ndiaye", matricule: "FANN-2026-777", profession: "Superviseur", adresse: "Fann Résidence, Dakar", telephone: "33 821 00 00",
  } });
  assert.equal(modif.statut, 200);
  const modifie = await lire();
  assert.deepEqual([modifie.profession, modifie.adresse, modifie.telephone], ["Superviseur", "Fann Résidence, Dakar", "33 821 00 00"]);
  assert.equal(modifie.photoDataUrl, "data:image/jpeg;base64,/9j/4A==");

  // Un PATCH sans ces champs (changement de photo seul) ne les efface pas.
  await appel(ctx, "PATCH", `/api/agents/${id}`, { jeton: admin, corps: { prenom: "Awa", nom: "Ndiaye", matricule: "FANN-2026-777", photoDataUrl: "data:image/jpeg;base64,/9j/4Q==" } });
  assert.equal((await lire()).profession, "Superviseur");

  // Chaîne vide : champ effacé (le recto retombe sur « Brancardier » côté interface).
  await appel(ctx, "PATCH", `/api/agents/${id}`, { jeton: admin, corps: { prenom: "Awa", nom: "Ndiaye", matricule: "FANN-2026-777", profession: "", adresse: "", telephone: "" } });
  const vide = await lire();
  assert.deepEqual([vide.profession, vide.adresse, vide.telephone], [null, null, null]);

  // Validation côté serveur.
  const base = { prenom: "Awa", nom: "Ndiaye", matricule: "FANN-2026-777" };
  for (const corps of [{ telephone: "abc<script>" }, { telephone: "12" }, { profession: "x".repeat(61) }, { adresse: "y".repeat(161) }, { profession: 42 }]) {
    const r = await appel(ctx, "PATCH", `/api/agents/${id}`, { jeton: admin, corps: { ...base, ...corps } });
    assert.equal(r.statut, 400, JSON.stringify(corps));
  }
});

test("poste partagé : pointage par matricule (second moyen), droits, portée et idempotence", async () => {
  const { ctx } = monter();
  const [admin, resp, brancardier] = [await connecter(ctx, "admin"), await connecter(ctx, "responsable"), await connecter(ctx, "agent-n1")];
  const cree = await appel(ctx, "POST", "/api/agents", { jeton: admin, corps: {
    prenom: "Awa", nom: "Ndiaye", matricule: "FANN-2026-777", serviceId: "__nouveau__", serviceNom: "Chirurgie plastique", regime: "general", photoDataUrl: "data:image/jpeg;base64,/9j/4A==",
  } });
  assert.equal(cree.statut, 201);
  const corps = (cle: string, matricule: string, type = "arrivee") => ({ matricule, type, idempotencyKey: cle, horsLigne: false });

  const ok = await appel(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: corps("matricule-ok-1", "fann-2026-777") });
  assert.equal(ok.statut, 201, JSON.stringify(ok.corps));
  assert.equal((ok.corps as { agent: string }).agent, "Awa Ndiaye");

  const rejeu = await appel(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: corps("matricule-ok-1", "FANN-2026-777") });
  assert.equal(rejeu.statut, 200);
  assert.equal((rejeu.corps as { rejoue: boolean }).rejoue, true);

  assert.equal((await appel(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: corps("matricule-inconnu", "NEXISTE-PAS") })).statut, 404);
  assert.equal((await appel(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: corps("matricule-invalide", "a b;--") })).statut, 400);
  assert.equal((await appel(ctx, "POST", "/api/pointage-station", { jeton: brancardier, corps: corps("matricule-brancardier", "FANN-2026-777") })).statut, 403);
  // Matricule seul : refusé pour un responsable hors de ses services (le badge physique est exigé, voir le test du poste partagé).
  assert.equal((await appel(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: corps("matricule-hors-service", "FANN-2026-777") })).statut, 403);
});
