// Tests de « caractérisation » : ils figent les réponses ACTUELLES (statut, code d'erreur, message) des routes
// d'authentification, de gestion des comptes/agents, de classement et de pointage, pour chaque rôle.
// Objectif : pouvoir déplacer ce code hors de routes.ts sans changer le moindre comportement ni droit d'accès.
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
type Opts = { corps?: unknown; jeton?: string; q?: Record<string, string>; ip?: string };
const appel = (ctx: Contexte, methode: string, chemin: string, o: Opts = {}): Promise<Reponse> =>
  gererRequete(ctx, { methode, chemin, requete: o.q ?? {}, corps: o.corps, ip: o.ip ?? "1.1.1.1", entetes: { authorization: o.jeton ? `Bearer ${o.jeton}` : undefined } });
async function connecter(ctx: Contexte, identifiant: string): Promise<string> {
  const r = await appel(ctx, "POST", "/api/connexion", { corps: { identifiant, motDePasse: MDP }, ip: `ip-${identifiant}` });
  assert.equal(r.statut, 200, `connexion ${identifiant}`);
  return (r.corps as { jeton: string }).jeton;
}
type Corps = { erreur?: string; message?: string };
/** Vérifie statut + code d'erreur + message exact. */
async function attendre(ctx: Contexte, methode: string, chemin: string, o: Opts, statut: number, erreur?: string, message?: string): Promise<Reponse> {
  const r = await appel(ctx, methode, chemin, o);
  const c = (r.corps ?? {}) as Corps;
  const etiquette = `${methode} ${chemin}`;
  assert.equal(r.statut, statut, `${etiquette} → statut (${JSON.stringify(r.corps)})`);
  if (erreur !== undefined) assert.equal(c.erreur, erreur, `${etiquette} → erreur`);
  if (message !== undefined) assert.equal(c.message, message, `${etiquette} → message`);
  return r;
}

const NON_AUTH = ["non_authentifie", "Connexion requise ou session révoquée."] as const;

test("caractérisation : sans session, toutes les routes protégées répondent 401 identique", async () => {
  const { ctx } = monter();
  const routes: [string, string][] = [
    ["GET", "/api/moi"], ["PATCH", "/api/moi"], ["POST", "/api/deconnexion"], ["POST", "/api/connexions/debloquer"],
    ["GET", "/api/agents"], ["POST", "/api/agents"], ["PATCH", "/api/agents/n1"], ["DELETE", "/api/agents/n2"],
    ["GET", "/api/utilisateurs"], ["POST", "/api/utilisateurs"], ["PATCH", "/api/utilisateurs/x"], ["DELETE", "/api/utilisateurs/x"],
    ["GET", "/api/classement-mensuel"], ["POST", "/api/classement-mensuel/generer"],
    ["POST", "/api/pointage"], ["POST", "/api/pointage-station"],
  ];
  for (const [m, c] of routes) await attendre(ctx, m, c, {}, 401, ...NON_AUTH);
});

test("caractérisation : connexion — méthode, longueurs, compte inconnu, mot de passe faux, désactivé", async () => {
  const { ctx, magasin } = monter();
  await attendre(ctx, "GET", "/api/connexion", {}, 405, "methode_non_autorisee");
  await attendre(ctx, "POST", "/api/connexion", { corps: { identifiant: "a".repeat(81), motDePasse: MDP } }, 400, "identifiants_invalides", "Identifiant ou mot de passe trop long.");
  await attendre(ctx, "POST", "/api/connexion", { corps: { identifiant: "admin", motDePasse: "x".repeat(201) } }, 400, "identifiants_invalides", "Identifiant ou mot de passe trop long.");
  // Même réponse pour un compte inconnu et un mauvais mot de passe : pas d'énumération des comptes.
  await attendre(ctx, "POST", "/api/connexion", { corps: { identifiant: "inconnu", motDePasse: MDP }, ip: "a" }, 401, "identifiants_invalides", "Identifiants invalides.");
  await attendre(ctx, "POST", "/api/connexion", { corps: { identifiant: "admin", motDePasse: "faux" }, ip: "b" }, 401, "identifiants_invalides", "Identifiants invalides.");
  // L'identifiant est insensible à la casse et aux espaces autour (via la clé du limiteur ; le magasin cherche en minuscules).
  const ok = await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "admin", motDePasse: MDP }, ip: "c" });
  assert.equal(ok.statut, 200);
  assert.deepEqual(Object.keys(ok.corps as object).sort(), ["doitChangerMotDePasse", "jeton", "role"]);
  assert.equal((ok.corps as { role: string }).role, "administrateur");
  assert.equal((ok.corps as { doitChangerMotDePasse: boolean }).doitChangerMotDePasse, false);
  magasin.utilisateurs.get("user-agent-g1")!.actif = false;
  await attendre(ctx, "POST", "/api/connexion", { corps: { identifiant: "agent-g1", motDePasse: MDP }, ip: "d" }, 401, "identifiants_invalides");
});

test("caractérisation : connexion — plafonds de tentatives (compte+IP, IP, compte global)", async () => {
  const { ctx } = monter();
  const essai = (id: string, mdp: string, ip: string) => appel(ctx, "POST", "/api/connexion", { corps: { identifiant: id, motDePasse: mdp }, ip });
  for (let i = 0; i < 5; i++) assert.equal((await essai("admin", "faux", "10.0.0.1")).statut, 401);
  const bloque = await essai("admin", MDP, "10.0.0.1");
  assert.equal(bloque.statut, 429);
  assert.deepEqual(bloque.corps, { erreur: "trop_de_tentatives", message: "Trop de tentatives. Réessayez plus tard." });
  // Attaque répartie : 30 échecs sur le même compte depuis 30 IP différentes → verrou global même pour une IP neuve.
  for (let i = 0; i < 30; i++) await essai("responsable", "faux", `20.0.0.${i}`);
  assert.equal((await essai("responsable", MDP, "99.9.9.9")).statut, 429);
});

test("caractérisation : déblocage de compte — réservé à l'administrateur, tracé, validation du corps", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), resp = await connecter(ctx, "responsable"), agent = await connecter(ctx, "agent-n1");
  await attendre(ctx, "GET", "/api/connexions/debloquer", { jeton: admin }, 405, "methode_non_autorisee");
  await attendre(ctx, "POST", "/api/connexions/debloquer", { jeton: agent, corps: { identifiant: "x" } }, 403, "non_autorise", "Déblocage réservé à l'administrateur.");
  await attendre(ctx, "POST", "/api/connexions/debloquer", { jeton: resp, corps: { identifiant: "x" } }, 403, "non_autorise", "Déblocage réservé à l'administrateur.");
  await attendre(ctx, "POST", "/api/connexions/debloquer", { jeton: admin, corps: {} }, 400, "requete_invalide", "Identifiant requis (80 caractères maximum).");
  await attendre(ctx, "POST", "/api/connexions/debloquer", { jeton: admin, corps: { identifiant: "x".repeat(81) } }, 400, "requete_invalide");
  const rien = await attendre(ctx, "POST", "/api/connexions/debloquer", { jeton: admin, corps: { identifiant: "agent-g1" } }, 200);
  assert.deepEqual(rien.corps, { ok: true, debloque: false, message: "Aucun blocage en cours pour ce compte." });
  // Après verrouillage réel, le déblocage rend la connexion possible.
  for (let i = 0; i < 5; i++) await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "agent-g1", motDePasse: "faux" }, ip: "5.5.5.5" });
  assert.equal((await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "agent-g1", motDePasse: MDP }, ip: "5.5.5.5" })).statut, 429);
  const debloque = await attendre(ctx, "POST", "/api/connexions/debloquer", { jeton: admin, corps: { identifiant: "agent-g1" } }, 200);
  assert.equal((debloque.corps as { debloque: boolean }).debloque, true);
  assert.equal((debloque.corps as { message: string }).message, "Compte débloqué : l'utilisateur peut se reconnecter.");
  assert.equal((await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "agent-g1", motDePasse: MDP }, ip: "5.5.5.5" })).statut, 200);
});

test("caractérisation : déconnexion — révoque le jeton côté serveur, méthode POST uniquement", async () => {
  const { ctx } = monter();
  const jeton = await connecter(ctx, "responsable");
  const r = await attendre(ctx, "GET", "/api/deconnexion", { jeton }, 405, "methode_non_autorisee");
  assert.equal(r.entetes?.Allow, "POST");
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton })).statut, 200);
  const sortie = await attendre(ctx, "POST", "/api/deconnexion", { jeton }, 200);
  assert.deepEqual(sortie.corps, { ok: true });
  await attendre(ctx, "GET", "/api/moi", { jeton }, 401, ...NON_AUTH);
  // Une nouvelle connexion fonctionne et reçoit un jeton valide.
  const neuf = await connecter(ctx, "responsable");
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton: neuf })).statut, 200);
});

test("caractérisation : /api/moi — profil par rôle et services visibles", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), resp = await connecter(ctx, "responsable"), agent = await connecter(ctx, "agent-n1");
  const a = (await appel(ctx, "GET", "/api/moi", { jeton: admin })).corps as { role: string; agentId: unknown; services: { id: string }[]; mode: string; doitChangerMotDePasse: boolean };
  assert.equal(a.role, "administrateur"); assert.equal(a.agentId, null); assert.equal(a.mode, "demo"); assert.equal(a.doitChangerMotDePasse, false);
  assert.deepEqual(a.services.map((s) => s.id).sort(), ["s-gar", "s-gen", "s-urg"]);
  const r = (await appel(ctx, "GET", "/api/moi", { jeton: resp })).corps as { role: string; services: { id: string }[] };
  assert.equal(r.role, "responsable");
  assert.deepEqual(r.services.map((s) => s.id).sort(), ["s-gen", "s-urg"]);   // jamais s-gar
  const b = (await appel(ctx, "GET", "/api/moi", { jeton: agent })).corps as { role: string; agentId: string; services: unknown[] };
  assert.equal(b.role, "brancardier"); assert.equal(b.agentId, "n1"); assert.deepEqual(b.services, []);
  for (const profil of [a, r, b]) assert.equal("hash" in profil, false);
  await attendre(ctx, "POST", "/api/moi", { jeton: admin }, 405, "methode_non_autorisee");
});

test("caractérisation : changement de mot de passe (PATCH /api/moi)", async () => {
  const { ctx } = monter();
  const jeton = await connecter(ctx, "responsable");
  await attendre(ctx, "PATCH", "/api/moi", { jeton, corps: {} }, 400, "requete_invalide", "Saisissez votre mot de passe actuel.");
  await attendre(ctx, "PATCH", "/api/moi", { jeton, corps: { motDePasseActuel: "x".repeat(201), nouveauMotDePasse: "Nouveau-mdp-2026!" } }, 400, "requete_invalide");
  await attendre(ctx, "PATCH", "/api/moi", { jeton, corps: { motDePasseActuel: "faux", nouveauMotDePasse: "Nouveau-mdp-2026!" } }, 403, "mot_de_passe_actuel_incorrect", "Le mot de passe actuel est incorrect.");
  // Nouveau mot de passe identique à l'ancien, ou à l'identifiant : refusés.
  await attendre(ctx, "PATCH", "/api/moi", { jeton, corps: { motDePasseActuel: MDP, nouveauMotDePasse: MDP } }, 400, "requete_invalide", "Le nouveau mot de passe doit être différent de l’ancien (même écrit autrement, par exemple avec des espaces).");
  await attendre(ctx, "PATCH", "/api/moi", { jeton, corps: { motDePasseActuel: MDP, nouveauMotDePasse: "court" } }, 400, "requete_invalide");
  const ok = await attendre(ctx, "PATCH", "/api/moi", { jeton, corps: { motDePasseActuel: MDP, nouveauMotDePasse: "Nouveau-mdp-2026!" } }, 200);
  const c = ok.corps as { ok: boolean; jeton: string; role: string; doitChangerMotDePasse: boolean; message: string };
  assert.equal(c.ok, true); assert.equal(c.role, "responsable"); assert.equal(c.doitChangerMotDePasse, false);
  assert.equal(c.message, "Mot de passe modifié. Les autres appareils connectés à ce compte devront se reconnecter.");
  // L'ancien jeton est révoqué, le nouveau jeton fonctionne, l'ancien mot de passe ne connecte plus.
  await attendre(ctx, "GET", "/api/moi", { jeton }, 401, ...NON_AUTH);
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton: c.jeton })).statut, 200);
  await attendre(ctx, "POST", "/api/connexion", { corps: { identifiant: "responsable", motDePasse: MDP }, ip: "z" }, 401, "identifiants_invalides");
  assert.equal((await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "responsable", motDePasse: "Nouveau-mdp-2026!" }, ip: "z2" })).statut, 200);
});

test("caractérisation : mot de passe provisoire — seules /api/moi et la déconnexion restent accessibles", async () => {
  const { ctx, magasin } = monter();
  magasin.utilisateurs.get("user-agent-n1")!.doitChangerMotDePasse = true;
  const jeton = await connecter(ctx, "agent-n1");
  for (const [m, c] of [["GET", "/api/agents"], ["POST", "/api/pointage"], ["GET", "/api/classement-mensuel"], ["GET", "/api/utilisateurs"]] as [string, string][]) {
    const r = await attendre(ctx, m, c, { jeton }, 403, "changement_mot_de_passe_requis", "Vous devez d’abord remplacer votre mot de passe provisoire.");
    assert.equal((r.corps as { doitChangerMotDePasse: boolean }).doitChangerMotDePasse, true);
  }
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton })).statut, 200);
  assert.equal((await appel(ctx, "POST", "/api/deconnexion", { jeton })).statut, 200);
});

test("caractérisation : gestion des agents — brancardier refusé, responsable limité à ses services, administrateur", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), resp = await connecter(ctx, "responsable"), agent = await connecter(ctx, "agent-n1");
  // Brancardier : refusé partout.
  await attendre(ctx, "GET", "/api/agents", { jeton: agent }, 403, "non_autorise", "Gestion des agents réservée aux responsables et à l'administrateur.");
  await attendre(ctx, "POST", "/api/agents", { jeton: agent, corps: {} }, 403, "non_autorise", "Création d'agents réservée aux responsables et à l'administrateur.");
  await attendre(ctx, "PATCH", "/api/agents/n1", { jeton: agent, corps: { prenom: "A", nom: "B" } }, 403, "non_autorise", "Modification des agents réservée aux responsables et à l'administrateur.");
  await attendre(ctx, "DELETE", "/api/agents/n2", { jeton: agent }, 403, "non_autorise", "Seul l'administrateur peut désactiver une fiche agent.");
  // Responsable : ne voit que les agents de ses services (s-urg, s-gen), jamais ceux de s-gar.
  const liste = (await attendre(ctx, "GET", "/api/agents", { jeton: resp }, 200)).corps as { agents: { id: string; serviceId: string }[]; services: { id: string }[] };
  assert.deepEqual(liste.services.map((s) => s.id).sort(), ["s-gen", "s-urg"]);
  assert.ok(liste.agents.length > 0);
  assert.ok(liste.agents.every((a) => a.serviceId === "s-gen" || a.serviceId === "s-urg"));
  assert.ok(!liste.agents.some((a) => ["g1", "g2", "g3"].includes(a.id)));
  const listeAdmin = (await appel(ctx, "GET", "/api/agents", { jeton: admin })).corps as { agents: { id: string }[] };
  assert.ok(["g1", "u1", "n1"].every((id) => listeAdmin.agents.some((a) => a.id === id)));
  // Hors périmètre : refus 403 pour le responsable (cible existante de s-gar), pas pour l'administrateur (409 : fiche de démo non modifiable).
  await attendre(ctx, "PATCH", "/api/agents/g1", { jeton: resp, corps: { prenom: "A", nom: "B" } }, 403, "non_autorise", "Agent hors de votre périmètre.");
  await attendre(ctx, "PATCH", "/api/agents/g1", { jeton: admin, corps: { prenom: "A", nom: "B" } }, 409, "conflit");
  await attendre(ctx, "PATCH", "/api/agents/introuvable", { jeton: admin, corps: { prenom: "A", nom: "B" } }, 404, "introuvable", "Agent actif introuvable.");
  await attendre(ctx, "DELETE", "/api/agents/n2", { jeton: resp }, 403, "non_autorise");
  await attendre(ctx, "DELETE", "/api/agents/n2", { jeton: admin }, 404, "introuvable");
  await attendre(ctx, "POST", "/api/agents", { jeton: admin, corps: {} }, 400, "requete_invalide", "Le prénom et le nom sont obligatoires.");
  await attendre(ctx, "PUT", "/api/agents", { jeton: admin }, 405, "methode_non_autorisee");
});

test("caractérisation : création d'agent — périmètre du responsable, nouveau service réservé à l'administrateur", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), resp = await connecter(ctx, "responsable");
  const photo = "data:image/jpeg;base64,/9j/4A==";
  const base = { prenom: "Awa", nom: "Diop", regime: "general", photoDataUrl: photo };
  await attendre(ctx, "POST", "/api/agents", { jeton: resp, corps: { ...base, serviceId: "s-gar" } }, 403, "non_autorise", "Vous ne pouvez créer un agent que dans un service dont vous êtes responsable.");
  await attendre(ctx, "POST", "/api/agents", { jeton: resp, corps: { ...base, serviceId: "__nouveau__", serviceNom: "Cardio" } }, 403, "non_autorise", "Seul l'administrateur peut ajouter un nouveau service.");
  await attendre(ctx, "POST", "/api/agents", { jeton: admin, corps: { ...base, serviceId: "s-inconnu" } }, 404, "introuvable", "Service introuvable.");
  await attendre(ctx, "POST", "/api/agents", { jeton: admin, corps: { ...base, serviceId: "s-gen", regime: "inconnu" } }, 400, "requete_invalide", "Choisissez un régime de service valide.");
  await attendre(ctx, "POST", "/api/agents", { jeton: admin, corps: { prenom: "Awa", nom: "Diop", regime: "general", serviceId: "s-gen" } }, 400, "requete_invalide", "La photo de la personne est obligatoire pour créer un badge professionnel.");
  await attendre(ctx, "POST", "/api/agents", { jeton: admin, corps: { ...base, serviceId: "s-gen", photoDataUrl: "data:image/png;base64,AAAA" } }, 400, "requete_invalide");
  await attendre(ctx, "POST", "/api/agents", { jeton: admin, corps: { ...base, serviceId: "s-gen", telephone: "abc" } }, 400, "requete_invalide");
  const cree = await attendre(ctx, "POST", "/api/agents", { jeton: resp, corps: { ...base, serviceId: "s-gen", matricule: "CAR-1" } }, 201);
  const c = cree.corps as { agent: { id: string; matricule: string; serviceId: string; badgeCode: string }; badgeCree: boolean; planningAConfigurer: boolean };
  assert.equal(c.badgeCree, true); assert.equal(c.planningAConfigurer, true); assert.equal(c.agent.matricule, "CAR-1"); assert.equal(c.agent.serviceId, "s-gen");
  assert.ok(c.agent.badgeCode.startsWith(`FANN-BADGE:${c.agent.id}`));
  // Matricule en doublon (insensible à la casse).
  await attendre(ctx, "POST", "/api/agents", { jeton: admin, corps: { ...base, serviceId: "s-gen", matricule: "car-1" } }, 409, "conflit", "Ce matricule est déjà utilisé.");
  // Modification d'une fiche créée : le responsable du service peut ; le matricule existant d'un autre agent est refusé.
  await attendre(ctx, "PATCH", `/api/agents/${c.agent.id}`, { jeton: resp, corps: { prenom: "Awa", nom: "Sow", matricule: "CAR-1" } }, 200);
  await attendre(ctx, "PATCH", `/api/agents/${c.agent.id}`, { jeton: resp, corps: { prenom: "", nom: "Sow" } }, 400, "requete_invalide", "Le prénom et le nom sont obligatoires.");
  // Désactivation : administrateur seulement, puis la fiche n'est plus modifiable.
  await attendre(ctx, "DELETE", `/api/agents/${c.agent.id}`, { jeton: resp }, 403, "non_autorise", "Seul l'administrateur peut désactiver une fiche agent.");
  const del = await attendre(ctx, "DELETE", `/api/agents/${c.agent.id}`, { jeton: admin }, 200);
  assert.deepEqual(del.corps, { succes: true, message: "Agent désactivé. Son historique est conservé." });
  await attendre(ctx, "PATCH", `/api/agents/${c.agent.id}`, { jeton: admin, corps: { prenom: "A", nom: "B" } }, 404, "introuvable");
});

test("caractérisation : gestion des comptes — administrateur uniquement, règles de création", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), resp = await connecter(ctx, "responsable"), agent = await connecter(ctx, "agent-n1");
  for (const jeton of [resp, agent]) {
    await attendre(ctx, "GET", "/api/utilisateurs", { jeton }, 403, "non_autorise", "Gestion des comptes réservée à l'administrateur.");
    await attendre(ctx, "POST", "/api/utilisateurs", { jeton, corps: {} }, 403, "non_autorise", "Seul l'administrateur peut créer les comptes.");
    await attendre(ctx, "PATCH", "/api/utilisateurs/user-admin", { jeton, corps: { actif: true } }, 403, "non_autorise", "Seul l'administrateur peut réinitialiser un mot de passe ou réactiver un compte.");
    await attendre(ctx, "DELETE", "/api/utilisateurs/user-admin", { jeton }, 403, "non_autorise", "Seul l'administrateur peut désactiver un compte.");
  }
  const liste = (await attendre(ctx, "GET", "/api/utilisateurs", { jeton: admin }, 200)).corps as { utilisateurs: Record<string, unknown>[]; mode: string };
  assert.equal(liste.mode, "demo-local");
  assert.equal(liste.utilisateurs.length, 5);
  for (const u of liste.utilisateurs) assert.equal("hash" in u, false);
  const nouveau = (o: Record<string, unknown>) => appel(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: o });
  assert.equal((await nouveau({ identifiant: "ab", motDePasse: "Valide-2026!", role: "responsable", servicesGeres: ["s-gen"] })).statut, 400);
  assert.equal((await nouveau({ identifiant: "Résp", motDePasse: "Valide-2026!", role: "responsable", servicesGeres: ["s-gen"] })).statut, 400);
  assert.equal((await nouveau({ identifiant: "nouveau1", motDePasse: "Valide-2026!", role: "super" })).statut, 400);
  assert.equal((await nouveau({ identifiant: "nouveau1", motDePasse: "x", role: "responsable", servicesGeres: ["s-gen"] })).statut, 400);
  await attendre(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: { identifiant: "nouveau1", motDePasse: "Valide-2026!", role: "responsable", servicesGeres: [] } }, 400, "requete_invalide", "Choisissez au moins un service valide pour ce responsable.");
  await attendre(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: { identifiant: "nouveau1", motDePasse: "Valide-2026!", role: "responsable", servicesGeres: ["s-fantome"] } }, 400, "requete_invalide", "Choisissez des services valides pour ce responsable.");
  await attendre(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: { identifiant: "nouveau1", motDePasse: "Valide-2026!", role: "brancardier" } }, 400, "requete_invalide", "Sélectionnez une fiche agent active.");
  await attendre(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: { identifiant: "nouveau1", motDePasse: "Valide-2026!", role: "brancardier", agentId: "fantome" } }, 404, "introuvable", "Sélectionnez un agent actif.");
  await attendre(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: { identifiant: "nouveau1", motDePasse: "Valide-2026!", role: "brancardier", agentId: "n1" } }, 409, "conflit", "Cet agent possède déjà un compte actif.");
  const cree = await attendre(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: { identifiant: " Nouveau1 ", motDePasse: "Valide-2026!", role: "responsable", servicesGeres: ["s-gen", "s-gen"] } }, 201);
  const u = (cree.corps as { utilisateur: { id: string; identifiant: string; servicesGeres: string[]; actif: boolean } }).utilisateur;
  assert.equal(u.identifiant, "nouveau1"); assert.deepEqual(u.servicesGeres, ["s-gen"]); assert.equal(u.actif, true);
  await attendre(ctx, "POST", "/api/utilisateurs", { jeton: admin, corps: { identifiant: "nouveau1", motDePasse: "Valide-2026!", role: "responsable", servicesGeres: ["s-gen"] } }, 409, "conflit", "Cet identifiant existe déjà.");
  // Le nouveau compte peut se connecter ; réinitialisation → provisoire ; désactivation → 401 immédiat.
  await attendre(ctx, "POST", "/api/connexion", { corps: { identifiant: "nouveau1", motDePasse: MDP }, ip: "avant-reinit" }, 401, "identifiants_invalides");   // créé avec un autre mot de passe
  const reinit = await attendre(ctx, "PATCH", `/api/utilisateurs/${u.id}`, { jeton: admin, corps: { motDePasse: MDP } }, 200);
  assert.equal((reinit.corps as { message: string }).message, "Mot de passe réinitialisé. Communiquez-le par un canal privé.");
  // Mode démo : le magasin local n'applique pas « doitChanger » (seul le dépôt PostgreSQL marque le compte provisoire).
  const j2 = await connecter(ctx, "nouveau1");
  assert.equal((await appel(ctx, "GET", "/api/moi", { jeton: j2 })).statut, 200);
  await attendre(ctx, "PATCH", `/api/utilisateurs/${u.id}`, { jeton: admin, corps: {} }, 400, "requete_invalide", "Aucune modification demandée.");
  await attendre(ctx, "PATCH", `/api/utilisateurs/${u.id}`, { jeton: admin, corps: { actif: "oui" } }, 400, "requete_invalide", "Le champ actif doit être vrai ou faux.");
  await attendre(ctx, "PATCH", "/api/utilisateurs/inconnu", { jeton: admin, corps: { motDePasse: MDP } }, 404, "introuvable", "Compte utilisateur introuvable.");
  const des = await attendre(ctx, "DELETE", `/api/utilisateurs/${u.id}`, { jeton: admin }, 200);
  assert.equal((des.corps as { message: string }).message, "Compte désactivé. Les nouvelles requêtes de ce compte seront refusées.");
  await attendre(ctx, "GET", "/api/moi", { jeton: j2 }, 401, ...NON_AUTH);
  await attendre(ctx, "PATCH", `/api/utilisateurs/${u.id}`, { jeton: admin, corps: { actif: true } }, 200);
  assert.equal((await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "nouveau1", motDePasse: MDP }, ip: "re" })).statut, 200);
});

test("caractérisation : un administrateur ne peut pas se désactiver lui-même ; mot de passe admin ≥ 9 caractères", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  await attendre(ctx, "PATCH", "/api/utilisateurs/user-admin", { jeton: admin, corps: { actif: false } }, 409, "conflit", "Vous ne pouvez pas désactiver votre propre compte depuis cette session.");
  await attendre(ctx, "DELETE", "/api/utilisateurs/user-admin", { jeton: admin }, 409, "conflit", "Vous ne pouvez pas désactiver votre propre compte depuis cette session.");
  const court = await appel(ctx, "PATCH", "/api/utilisateurs/user-admin", { jeton: admin, corps: { motDePasse: "12345678" } });
  assert.equal(court.statut, 400);
  assert.equal((court.corps as Corps).erreur, "requete_invalide");
  await attendre(ctx, "PATCH", "/api/utilisateurs/user-admin", { jeton: admin, corps: { motDePasse: "123456789" } }, 400, "requete_invalide", "Mot de passe trop prévisible (caractères répétés, suite de chiffres ou mot de passe courant). Choisissez-en un autre.");
  const bon = await attendre(ctx, "PATCH", "/api/utilisateurs/user-admin", { jeton: admin, corps: { motDePasse: "739146285" } }, 200);
  assert.ok(bon.corps);
  // Réinitialiser son propre mot de passe ne le rend pas provisoire (l'admin se connecte ensuite normalement).
  const r = await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "admin", motDePasse: "739146285" }, ip: "adm" });
  assert.equal(r.statut, 200);
  assert.equal((r.corps as { doitChangerMotDePasse: boolean }).doitChangerMotDePasse, false);
});

test("caractérisation : classement mensuel — droits par rôle, mois invalide, génération unique", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), resp = await connecter(ctx, "responsable"), agent = await connecter(ctx, "agent-n1");
  await attendre(ctx, "GET", "/api/classement-mensuel", { jeton: agent, q: { mois: "2026-09-01" } }, 403, "non_autorise", "Accès au classement mensuel réservé aux responsables et à l'administrateur.");
  await attendre(ctx, "POST", "/api/classement-mensuel/generer", { jeton: agent, corps: { mois: "2026-09-01" } }, 403, "non_autorise", "Seul l'administrateur peut calculer un classement mensuel.");
  await attendre(ctx, "POST", "/api/classement-mensuel/generer", { jeton: resp, corps: { mois: "2026-09-01" } }, 403, "non_autorise", "Seul l'administrateur peut calculer un classement mensuel.");
  await attendre(ctx, "POST", "/api/classement-mensuel", { jeton: admin }, 405, "methode_non_autorisee");
  await attendre(ctx, "GET", "/api/classement-mensuel/generer", { jeton: admin }, 405, "methode_non_autorisee");
  const vide = (await attendre(ctx, "GET", "/api/classement-mensuel", { jeton: admin, q: { mois: "2026-09-01" } }, 200)).corps as { classement: unknown; top5: unknown[]; generationPossible: boolean };
  assert.equal(vide.classement, null); assert.deepEqual(vide.top5, []); assert.equal(vide.generationPossible, true);
  assert.equal((await appel(ctx, "GET", "/api/classement-mensuel", { jeton: admin, q: { mois: "pas-un-mois" } })).statut, 400);
  // Le mois courant (ou futur) ne peut pas être calculé.
  await attendre(ctx, "POST", "/api/classement-mensuel/generer", { jeton: admin, corps: { mois: "2026-10-01" } }, 400, "requete_invalide", "Le classement ne peut être calculé qu'après la fin du mois concerné.");
  const gen = await attendre(ctx, "POST", "/api/classement-mensuel/generer", { jeton: admin, corps: { mois: "2026-09-01" } }, 201);
  const g = gen.corps as { mois: string; generationPossible: boolean; classement: { classement: unknown[] } };
  assert.equal(g.generationPossible, false);
  await attendre(ctx, "POST", "/api/classement-mensuel/generer", { jeton: admin, corps: { mois: "2026-09-01" } }, 409, "conflit", "Un classement existe déjà pour ce mois.");
  const lu = (await attendre(ctx, "GET", "/api/classement-mensuel", { jeton: admin, q: { mois: "2026-09-01" } }, 200)).corps as { classement: { classement: { agentId: string; rang: number }[] }; generationPossible: boolean };
  assert.equal(lu.generationPossible, false);
  const total = lu.classement.classement.length;
  // Responsable : classement filtré à ses services, rangs renumérotés à partir de 1, jamais d'agent de s-gar.
  const vu = (await attendre(ctx, "GET", "/api/classement-mensuel", { jeton: resp, q: { mois: "2026-09-01" } }, 200)).corps as { classement: { classement: { agentId: string; rang: number }[]; top5: unknown[]; audit: { detail: { agentsClasses: number } }[] } };
  assert.ok(vu.classement.classement.length <= total);
  assert.ok(vu.classement.classement.every((e) => !["g1", "g2", "g3"].includes(e.agentId)));
  assert.deepEqual(vu.classement.classement.map((e) => e.rang), vu.classement.classement.map((_, i) => i + 1));
  for (const ev of vu.classement.audit) assert.equal(ev.detail.agentsClasses, vu.classement.classement.length);
  await attendre(ctx, "GET", "/api/classement-mensuel", { jeton: admin, q: { mois: "2026-09-01", format: "xml" } }, 400, "requete_invalide", "Format attendu : json ou csv.");
  const csv = await attendre(ctx, "GET", "/api/classement-mensuel", { jeton: resp, q: { mois: "2026-09-01", format: "csv" } }, 200);
  assert.equal(csv.typeContenu, "text/csv; charset=utf-8");
  assert.match(csv.entetes?.["Content-Disposition"] ?? "", /^attachment; filename="/);
  assert.ok(typeof csv.texte === "string" && csv.texte.length > 0);
});

test("caractérisation : pointage personnel — compte sans agent refusé, un seul moyen d'identification, badge/matricule d'autrui refusés", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), resp = await connecter(ctx, "responsable"), agent = await connecter(ctx, "agent-n1");
  await attendre(ctx, "POST", "/api/pointage", { jeton: admin, corps: {} }, 403, "non_autorise", "Ce compte n'est associé à aucun agent");
  await attendre(ctx, "POST", "/api/pointage", { jeton: resp, corps: {} }, 403, "non_autorise", "Ce compte n'est associé à aucun agent");
  await attendre(ctx, "GET", "/api/pointage", { jeton: agent }, 405, "methode_non_autorisee");
  await attendre(ctx, "POST", "/api/pointage", { jeton: agent, corps: { badgeCode: "FANN-BADGE:n1", qrToken: "x" } }, 400, "requete_invalide", "Choisissez un seul moyen : QR de zone, badge ou matricule.");
  const badgeAutrui = "Ce badge n'est pas le vôtre, ou il est révoqué. Demandez un renouvellement à l'administrateur.";
  await attendre(ctx, "POST", "/api/pointage", { jeton: agent, corps: { badgeCode: "FANN-BADGE:n2", idempotencyKey: "cle-test-0001-xx" } }, 403, "non_autorise", badgeAutrui);
  await attendre(ctx, "POST", "/api/pointage", { jeton: agent, corps: { badgeCode: "n'importe quoi" } }, 403, "non_autorise", badgeAutrui);
  await attendre(ctx, "POST", "/api/pointage", { jeton: agent, corps: { matricule: "DEMO-n2" } }, 403, "non_autorise", "Ce matricule ne correspond pas à votre compte.");
  await attendre(ctx, "POST", "/api/pointage", { jeton: agent, corps: { matricule: "bad matricule!" } }, 403, "non_autorise", "Ce matricule ne correspond pas à votre compte.");
});

test("caractérisation : pointage sur poste partagé — brancardier refusé, validations, responsable limité pour le matricule", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin"), resp = await connecter(ctx, "responsable"), agent = await connecter(ctx, "agent-n1");
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: agent, corps: { badgeCode: "FANN-BADGE:n1", type: "arrivee", idempotencyKey: "cle-station-1" } }, 403, "non_autorise", "Le pointage par badge partagé est réservé aux responsables et à l'administrateur.");
  await attendre(ctx, "GET", "/api/pointage-station", { jeton: admin }, 405, "methode_non_autorisee");
  const invalide = "Badge, type de pointage ou clé d'idempotence invalide.";
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: {} }, 400, "requete_invalide", invalide);
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { badgeCode: "FANN-BADGE:n1", type: "pause", idempotencyKey: "cle-station-1" } }, 400, "requete_invalide", invalide);
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { badgeCode: "FANN-BADGE:n1", type: "arrivee" } }, 400, "requete_invalide", invalide);
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { badgeCode: "FANN-BADGE:n1", type: "arrivee", idempotencyKey: "k".repeat(101) } }, 400, "requete_invalide", invalide);
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { matricule: "bad matricule!", type: "arrivee", idempotencyKey: "cle-station-1" } }, 400, "requete_invalide", "Matricule, type de pointage ou clé d'idempotence invalide.");
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { badgeCode: "FANN-BADGE:fantome", type: "arrivee", idempotencyKey: "cle-station-2" } }, 404, "introuvable", "Badge inconnu ou agent inactif.");
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { matricule: "INCONNU-1", type: "arrivee", idempotencyKey: "cle-station-3" } }, 404, "introuvable", "Matricule inconnu ou agent inactif.");
  // Badge de démonstration : un jeton versionné est refusé.
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { badgeCode: `FANN-BADGE:n1:${"a".repeat(43)}`, type: "arrivee", idempotencyKey: "cle-station-4" } }, 403, "non_autorise", "Le badge de démonstration ne possède pas de jeton versionné.");
  // Responsable : agent d'un AUTRE service (g1 ∈ s-gar) → le matricule seul est refusé, le badge physique est accepté.
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { matricule: "DEMO-g1", type: "arrivee", idempotencyKey: "cle-station-5" } }, 403, "non_autorise", "Pour un agent d'un autre service, scannez son badge imprimé : le matricule seul n'est accepté que pour les agents de vos services.");
  const autreService = await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { badgeCode: "FANN-BADGE:g1", type: "arrivee", idempotencyKey: "cle-station-6" } }, 201);
  assert.equal((autreService.corps as { reussi: boolean }).reussi, true);
  // Même clé rejouée : 200, pas de doublon.
  const rejeu = await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { badgeCode: "FANN-BADGE:g1", type: "arrivee", idempotencyKey: "cle-station-6" } }, 200);
  assert.equal((rejeu.corps as { rejoue: boolean }).rejoue, true);
  assert.equal((rejeu.corps as { pointageId: string }).pointageId, (autreService.corps as { pointageId: string }).pointageId);
  // Ses propres services : matricule accepté ; l'administrateur peut tout pointer par matricule.
  const parMatricule = await attendre(ctx, "POST", "/api/pointage-station", { jeton: resp, corps: { matricule: "demo-n1", type: "arrivee", idempotencyKey: "cle-station-7" } }, 201);
  assert.equal((parMatricule.corps as { agent: string }).agent, "Agent7 Démo-7");
  // g2 n'a aucun poste planifié à cet instant : le pointage est accepté mais « à vérifier », sans conflit possible.
  const sansPoste = await attendre(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: { matricule: "DEMO-g2", type: "arrivee", idempotencyKey: "cle-station-8" } }, 201);
  assert.equal((sansPoste.corps as { validation: string }).validation, "a_verifier");
  assert.equal((sansPoste.corps as { message: string }).message, "Pointage enregistré, poste à vérifier.");
  assert.equal((parMatricule.corps as { validation: string }).validation, "accepte");
  // Sur un poste planifié : arrivée en double = conflit ; départ sans arrivée = conflit.
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: { matricule: "DEMO-n1", type: "arrivee", idempotencyKey: "cle-station-9" } }, 409, "conflit", "Une arrivée existe déjà pour ce poste.");
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: { matricule: "DEMO-u1", type: "depart", idempotencyKey: "cle-station-10" } }, 409, "conflit", "L'arrivée doit être enregistrée avant le départ.");
  // Hors ligne : date invalide ou trop éloignée refusée.
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: { matricule: "DEMO-g3", type: "arrivee", idempotencyKey: "cle-station-11", horsLigne: true, capturedAt: "n'importe quoi" } }, 400, "requete_invalide", "Date capturée hors ligne invalide.");
  await attendre(ctx, "POST", "/api/pointage-station", { jeton: admin, corps: { matricule: "DEMO-g3", type: "arrivee", idempotencyKey: "cle-station-12", horsLigne: true, capturedAt: "2026-09-01T08:00:00Z" } }, 400, "requete_invalide", "Date hors ligne trop éloignée; une vérification manuelle est nécessaire.");
});

test("caractérisation : routes inconnues et méthodes inattendues", async () => {
  const { ctx } = monter();
  const admin = await connecter(ctx, "admin");
  await attendre(ctx, "GET", "/hors-api", {}, 404, "introuvable");
  await attendre(ctx, "GET", "/api/inconnue", { jeton: admin }, 404, "introuvable");
  const r = await attendre(ctx, "DELETE", "/api/utilisateurs", { jeton: admin }, 405, "methode_non_autorisee");
  assert.equal(r.entetes?.Allow, "GET, POST");
  const r2 = await attendre(ctx, "PUT", "/api/agents/n1", { jeton: admin }, 405, "methode_non_autorisee");
  assert.equal(r2.entetes?.Allow, "PATCH, DELETE");
});
