// Recette de bout en bout des correctifs v21 contre un serveur réel (PostgreSQL) déjà démarré.
// Usage : BASE_URL=http://127.0.0.1:8787 RECETTE_ADMIN=admin RECETTE_ADMIN_MDP=... node scripts/recette-v21.mjs
// Crée un service et des agents « RECETTE-… » dans la base visée : à lancer sur une base de recette, jamais en production.
import assert from "node:assert/strict";
const base = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const adminId = process.env.RECETTE_ADMIN ?? "admin";
const adminMdp = process.env.RECETTE_ADMIN_MDP ?? "";
if (!adminMdp) throw new Error("RECETTE_ADMIN_MDP est obligatoire.");
const suffixe = String(Date.now()).slice(-6);
async function appel(methode, chemin, { corps, jeton } = {}) {
  const r = await fetch(base + chemin, { method: methode, headers: { ...(corps ? { "Content-Type": "application/json" } : {}), ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => ({})) };
}
const connexion = (identifiant, motDePasse) => appel("POST", "/api/connexion", { corps: { identifiant, motDePasse } });
let ok = 0; const etape = (nom) => { ok++; console.log(`OK ${ok} — ${nom}`); };

const admin = await connexion(adminId, adminMdp); assert.equal(admin.statut, 200); const jetonAdmin = admin.corps.jeton;
etape("connexion administrateur");

// 1. Règle administrateur
let r = await appel("POST", "/api/utilisateurs", { jeton: jetonAdmin, corps: { identifiant: `adm-faible-${suffixe}`, motDePasse: "abcdef", role: "administrateur" } });
assert.equal(r.statut, 400); etape("administrateur « abcdef » refusé (400)");
r = await appel("PATCH", "/api/moi", { jeton: jetonAdmin, corps: { motDePasseActuel: adminMdp, nouveauMotDePasse: "12345678" } });
assert.equal(r.statut, 400); etape("administrateur : changement vers 8 caractères refusé");

// Service et agents
r = await appel("POST", "/api/services", { jeton: jetonAdmin, corps: { nom: `RECETTE-${suffixe}`, regimeDefaut: "general" } });
assert.equal(r.statut, 201); const serviceId = r.corps.service.id;
const creerAgent = (prenom, nom, matricule, telephone) => appel("POST", "/api/agents", { jeton: jetonAdmin, corps: { prenom, nom, matricule, telephone, serviceId, regime: "general" } });

// 2. Compte agent automatique
const mat1 = `RC${suffixe}A`, mat2 = `RC${suffixe}B`, mat3 = `RC${suffixe}C`;
r = await creerAgent("Awa", "Recette", mat1, "+221 77 123 45 67"); assert.equal(r.statut, 201, JSON.stringify(r.corps));
assert.equal(r.corps.compteAgent.cree, true); assert.ok(!JSON.stringify(r.corps).includes("771234567")); const agent1 = r.corps.agent.id;
etape("création agent → compte créé, aucun mot de passe renvoyé");
r = await creerAgent("Ibou", "Recette", mat2, "78 222 33 44"); assert.equal(r.corps.compteAgent.cree, true); const agent2 = r.corps.agent.id;
r = await creerAgent("Sans", "Telephone", mat3, ""); assert.equal(r.statut, 201); assert.equal(r.corps.compteAgent.cree, false); assert.equal(r.corps.compteAgent.raison, "telephone_absent");
etape("agent sans téléphone : fiche créée, pas de compte");
r = await appel("POST", "/api/comptes-agents", { jeton: jetonAdmin, corps: {} }); assert.equal(r.statut, 200); assert.ok(r.corps.ignores.some((x) => x.raison === "telephone_absent"));
etape("rattrapage des comptes manquants");
r = await appel("PATCH", `/api/agents/${r.corps.ignores.find((x) => x.nom === "Telephone").agentId}`, { jeton: jetonAdmin, corps: { telephone: "70 555 66 77" } });
assert.equal(r.corps.compteAgent.cree, true); etape("téléphone ajouté plus tard → compte créé");

// 3. Connexion agent, blocage, changement
let a = await connexion(mat1.toLowerCase(), "+221 77 123 45 67"); assert.equal(a.statut, 200); assert.equal(a.corps.doitChangerMotDePasse, true);
etape("connexion agent avec matricule + téléphone (format libre)");
let jetonA = a.corps.jeton;
r = await appel("GET", "/api/messages", { jeton: jetonA }); assert.equal(r.statut, 403); assert.equal(r.corps.erreur, "changement_mot_de_passe_requis");
r = await appel("GET", "/api/moi", { jeton: jetonA }); assert.equal(r.statut, 200); assert.equal(r.corps.doitChangerMotDePasse, true);
etape("routes bloquées tant que le mot de passe est provisoire");
r = await appel("PATCH", "/api/moi", { jeton: jetonA, corps: { motDePasseActuel: "771234567", nouveauMotDePasse: "771234567" } }); assert.equal(r.statut, 400);
r = await appel("PATCH", "/api/moi", { jeton: jetonA, corps: { motDePasseActuel: "faux", nouveauMotDePasse: "Nouveau-secret-1" } }); assert.equal(r.statut, 403);
r = await appel("PATCH", "/api/moi", { jeton: jetonA, corps: { motDePasseActuel: "771234567", nouveauMotDePasse: "Nouveau-secret-1" } }); assert.equal(r.statut, 200, JSON.stringify(r.corps));
const ancienJeton = jetonA; jetonA = r.corps.jeton;
assert.equal((await appel("GET", "/api/moi", { jeton: ancienJeton })).statut, 401);
assert.equal((await appel("GET", "/api/moi", { jeton: jetonA })).corps.doitChangerMotDePasse, false);
assert.equal((await connexion(mat1, "771234567")).statut, 401);
assert.equal((await connexion(mat1, "Nouveau-secret-1")).statut, 200);
etape("changement de mot de passe : nouveau jeton, ancien jeton et ancien mot de passe invalides");

// 5. Messagerie : envoi, isolation, retrait
r = await appel("POST", "/api/messages", { jeton: jetonAdmin, corps: { titre: "Urgent recette", contenu: "Message pour Awa", portee: "comptes", priorite: "urgente", destinataireIds: [(await appel("GET", "/api/messages/destinataires", { jeton: jetonAdmin })).corps.comptes.find((c) => c.nom === "Awa Recette").id] } });
assert.equal(r.statut, 201, JSON.stringify(r.corps)); const msg = r.corps.message.id;
r = await appel("GET", "/api/messages", { jeton: jetonA }); assert.equal(r.statut, 200); assert.ok(r.corps.messages.some((m) => m.id === msg));
const b = await connexion(mat2, "782223344"); const jetonB = (await appel("PATCH", "/api/moi", { jeton: b.corps.jeton, corps: { motDePasseActuel: "78 222 33 44", nouveauMotDePasse: "Autre-secret-22" } })).corps.jeton;
assert.ok(!(await appel("GET", "/api/messages", { jeton: jetonB })).corps.messages.some((m) => m.id === msg));
etape("message ciblé : visible par Awa, invisible pour Ibou");
assert.equal((await appel("DELETE", `/api/messages/${msg}`, { jeton: jetonA })).statut, 403);
etape("un agent ne peut pas retirer un message (403)");
r = await appel("DELETE", `/api/messages/${msg}`, { jeton: jetonAdmin }); assert.equal(r.statut, 200); assert.equal(r.corps.dejaArchive, false);
assert.equal((await appel("DELETE", `/api/messages/${msg}`, { jeton: jetonAdmin })).corps.dejaArchive, true);
assert.ok(!(await appel("GET", "/api/messages", { jeton: jetonA })).corps.messages.some((m) => m.id === msg));
assert.equal((await appel("POST", `/api/messages/${msg}/lu`, { jeton: jetonA, corps: {} })).statut, 404);
assert.ok(!(await appel("GET", "/api/messages", { jeton: jetonAdmin })).corps.messages.some((m) => m.id === msg));
const avecArchives = (await appel("GET", "/api/messages?archives=1", { jeton: jetonAdmin })).corps.messages.find((m) => m.id === msg);
assert.ok(avecArchives && avecArchives.archive === true);
assert.equal((await appel("DELETE", "/api/messages/00000000-0000-4000-8000-000000000000", { jeton: jetonAdmin })).statut, 404);
etape("retrait d'un message : disparu chez l'agent, lecture refusée, visible dans les archives de l'administrateur, idempotent, 404 si inconnu");
console.log(`\nRecette v21 : ${ok} étapes réussies.`);
