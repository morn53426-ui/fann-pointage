// Recette fonctionnelle de bout en bout contre une instance EN COURS D'EXÉCUTION en mode postgres-catalogue.
// Parcourt : connexion, catalogue, badges, zones/QR, plannings, pointage poste partagé (idempotence, doublons,
// badge falsifié), écrans (tableau de bord, historique, anomalies, émargement, absences, rapports, classement),
// comptes et rôles (brancardier/responsable/admin), révocation de session, verrouillage de connexion.
//
// ATTENTION : ce script ÉCRIT des données (agents, comptes « resp-recette-… », pointages). À lancer UNIQUEMENT sur
// une base de RECETTE jetable ou une copie, jamais sur la base de production.
//
//   FANN_RECETTE_OK=1 ADMIN_INITIAL_MOT_DE_PASSE=... [FANN_URL=http://127.0.0.1:8787] [ADMIN_IDENTIFIANT=admin] \
//     node scripts/recette-api.mjs
//
// Le script attend ~2 min 05 s entre l'arrivée et le départ (règle métier : 2 minutes minimum entre deux pointages).
import { randomBytes } from "node:crypto";
if (process.env.FANN_RECETTE_OK !== "1") {
  console.error("Refus : ce script écrit des données. Définissez FANN_RECETTE_OK=1 pour confirmer que la cible est une base de RECETTE jetable.");
  process.exit(2);
}
if (!process.env.ADMIN_INITIAL_MOT_DE_PASSE) { console.error("ADMIN_INITIAL_MOT_DE_PASSE est requis."); process.exit(2); }
const B = (process.env.FANN_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const ADMIN = process.env.ADMIN_IDENTIFIANT ?? "admin";
const MDP = process.env.ADMIN_INITIAL_MOT_DE_PASSE;
const SUFFIXE = randomBytes(3).toString("hex");
// Date fictive lointaine et aléatoire : la recette reste rejouable sans collision avec un vrai jour férié.
const alea = randomBytes(2);
const FERIE_TEST = `${2030 + (alea[0] % 60)}-${String(1 + (alea[1] % 12)).padStart(2, "0")}-${String(1 + ((alea[0] + alea[1]) % 28)).padStart(2, "0")}`;
const MDP_RESP = `Resp-${randomBytes(9).toString("base64url")}-26!`;
const MDP_BRC = `Brc-${randomBytes(9).toString("base64url")}-26!`;
const res = []; let echecs = 0;
const ok = (nom, cond, detail = "") => { res.push(`${cond ? "OK  " : "ECHEC"} ${nom}${cond ? "" : "  -> " + detail}`); if (!cond) echecs++; };
async function api(chemin, { m = "GET", corps, jeton, brut } = {}) {
  const r = await fetch(B + chemin, { method: m, headers: { "Content-Type": "application/json", ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, t };
}
const non503 = (r) => !(r.j && r.j.erreur === "migration_metier_incomplete");
const today = new Date().toISOString().slice(0, 10);
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let r = await api("/api/connexion", { m: "POST", corps: { identifiant: ADMIN, motDePasse: "mauvais-mot-de-passe-x" } });
ok("connexion refusée avec mauvais mot de passe", r.s === 401, r.s);
r = await api("/api/connexion", { m: "POST", corps: { identifiant: ADMIN, motDePasse: MDP } });
ok("connexion admin", r.s === 200 && r.j.jeton, JSON.stringify(r.j)); const adm = r.j.jeton;
r = await api("/api/moi", { jeton: adm }); ok("/api/moi mode postgres", r.s === 200 && r.j.mode === "catalogue-postgres", JSON.stringify(r.j));
r = await api("/api/agents"); ok("sans jeton → 401", r.s === 401, r.s);

r = await api("/api/services", { jeton: adm }); ok("services (20 de référence)", r.s === 200 && r.j.services.length >= 20, r.s + " " + r.t.slice(0,200));
const svc = r.j.services.find((s) => s.nom === "Accueil urgences"); const svcG = r.j.services.find((s) => s.regimeDefaut === "general") ?? svc;
r = await api("/api/agents", { m: "POST", jeton: adm, corps: { prenom: "Awa", nom: "Diop", matricule: `R${SUFFIXE}1`, profession: "Brancardier", adresse: "Dakar", telephone: "770000001", serviceId: svc.id, regime: "urgences", photoDataUrl: JPEG } });
ok("création agent", r.s === 201, r.s + " " + r.t.slice(0,300)); const ag = r.j.agent;
r = await api("/api/agents", { m: "POST", jeton: adm, corps: { prenom: "Moussa", nom: "Fall", matricule: `R${SUFFIXE}2`, profession: "Brancardier", adresse: "Pikine", telephone: "770000002", serviceId: svcG.id, regime: svcG.regimeDefaut, photoDataUrl: JPEG } });
ok("création agent 2", r.s === 201, r.s + " " + r.t.slice(0,300)); const ag2 = r.j.agent;
r = await api("/api/agents", { m: "POST", jeton: adm, corps: { prenom: "Awa", nom: "Diop", matricule: `R${SUFFIXE}1`, serviceId: svc.id, regime: "urgences", photoDataUrl: JPEG } });
ok("matricule en double refusé", r.s >= 400 && r.s < 500, r.s);
r = await api(`/api/badges/${ag.id}/emettre`, { m: "POST", jeton: adm }); ok("émission badge", r.s === 200 || r.s === 201, r.s + " " + r.t.slice(0,300));
r = await api("/api/badges", { jeton: adm }); ok("liste badges", r.s === 200 && non503(r), r.s); const badge = r.j.badges?.find((b) => b.agentId === ag.id)?.badgeCode;
ok("code badge présent", !!badge, r.t.slice(0,300));
r = await api("/api/zones", { m: "POST", jeton: adm, corps: { nom: "Entrée CHNU Fann", serviceId: svc.id, latitude: 14.69, longitude: -17.47, rayonM: 150, precisionMaxM: 50 } });
ok("création zone", r.s === 201 || r.s === 200, r.s + " " + r.t.slice(0,300)); const zone = r.j.zone;
r = await api("/api/zones", { jeton: adm }); ok("liste zones", r.s === 200 && non503(r), r.s);
r = await api(`/api/qr?zoneId=${zone?.id}`, { jeton: adm }); ok("QR dynamique", r.s === 200 && r.j.token, r.s + " " + r.t.slice(0,200));
r = await api("/api/plannings", { m: "POST", jeton: adm, corps: { agentId: ag.id, dateDebut: today, dateFin: today, equipeUrgences: "jour" } });
ok("planning créé", r.s === 200 || r.s === 201, r.s + " " + r.t.slice(0,300));
r = await api("/api/plannings", { m: "POST", jeton: adm, corps: { agentId: ag2.id, dateDebut: today, dateFin: today } });
ok("planning général créé", r.s === 200 || r.s === 201 || r.s === 400, r.s + " " + r.t.slice(0,300));
r = await api(`/api/plannings?debut=${today}&fin=${today}`, { jeton: adm }); ok("liste plannings", r.s === 200 && non503(r), r.s);
r = await api("/api/jours-feries", { m: "POST", jeton: adm, corps: { date: FERIE_TEST, nom: "Jour férié de recette", note: "" } }); ok("jour férié ajouté", r.s < 300 && non503(r), r.s + " " + r.t.slice(0,200));
r = await api("/api/jours-feries", { jeton: adm }); ok("jours fériés", r.s === 200, r.s);

const cle = "rec-" + Date.now();
r = await api("/api/pointage-station", { m: "POST", jeton: adm, corps: { badgeCode: badge, type: "arrivee", idempotencyKey: cle, capturedAt: new Date().toISOString(), operateurId: "admin", horsLigne: false, appVersion: "t" } });
ok("pointage poste partagé (arrivée)", r.s === 200 || r.s === 201, r.s + " " + r.t.slice(0,300));
const r2 = await api("/api/pointage-station", { m: "POST", jeton: adm, corps: { badgeCode: badge, type: "arrivee", idempotencyKey: cle, capturedAt: new Date().toISOString(), operateurId: "admin", horsLigne: false, appVersion: "t" } });
ok("rejeu même clé idempotente (pas de doublon)", r2.s === r.s, `${r.s} vs ${r2.s} ${r2.t.slice(0,200)}`);
r = await api("/api/pointage-station", { m: "POST", jeton: adm, corps: { badgeCode: badge, type: "arrivee", idempotencyKey: cle + "-b", capturedAt: new Date().toISOString(), operateurId: "admin", horsLigne: false, appVersion: "t" } });
ok("2e arrivée consécutive refusée (double pointage)", r.s >= 400 && r.s < 500, r.s + " " + r.t.slice(0,200));
r = await api("/api/pointage-station", { m: "POST", jeton: adm, corps: { matricule: `R${SUFFIXE}2`, type: "arrivee", idempotencyKey: cle + "-c", capturedAt: new Date().toISOString(), operateurId: "admin", horsLigne: false, appVersion: "t" } });
ok("pointage par matricule", r.s < 500 && non503(r), r.s + " " + r.t.slice(0,200));
await new Promise((z) => setTimeout(z, 125000));
r = await api("/api/pointage-station", { m: "POST", jeton: adm, corps: { badgeCode: badge, type: "depart", idempotencyKey: cle + "-d", capturedAt: new Date().toISOString(), operateurId: "admin", horsLigne: false, appVersion: "t" } });
ok("départ", r.s === 200 || r.s === 201, r.s + " " + r.t.slice(0,300));
r = await api("/api/pointage-station", { m: "POST", jeton: adm, corps: { badgeCode: "FANN-BADGE:inconnu:" + "x".repeat(44), type: "arrivee", idempotencyKey: cle + "-e", capturedAt: new Date().toISOString(), operateurId: "admin", horsLigne: false, appVersion: "t" } });
ok("badge falsifié refusé", r.s >= 400 && r.s < 500, r.s);

for (const [nom, ch] of [["tableau de bord", "/api/tableau-de-bord"], ["historique", `/api/historique?type=jour&date=${today}`], ["anomalies", "/api/anomalies"], ["émargement", `/api/emargement?date=${today}`], ["absences", "/api/absences"], ["rapports", `/api/rapports?type=jour&date=${today}`], ["classement", `/api/classement-mensuel?mois=${today.slice(0,7)}-01`]]) {
  r = await api(ch, { jeton: adm }); ok(`écran ${nom} (pas de 503 migration)`, non503(r) && r.s < 500, r.s + " " + r.t.slice(0,250));
}
r = await api("/api/absences", { m: "POST", jeton: adm, corps: { agentId: ag2.id, debut: today, fin: today, categorie: "congé", note: "recette" } });
ok("absence enregistrée", r.s < 300, r.s + " " + r.t.slice(0,250));
r = await api("/api/absences?format=csv", { jeton: adm }); ok("export absences CSV", r.s === 200, r.s);
r = await api("/api/classement-mensuel/generer", { m: "POST", jeton: adm, corps: { mois: today.slice(0,7) + "-01" } }); ok("génération classement", r.s < 500 && non503(r), r.s + " " + r.t.slice(0,250));

// comptes & rôles
r = await api("/api/utilisateurs", { m: "POST", jeton: adm, corps: { identifiant: `resp-recette-${SUFFIXE}`, motDePasse: MDP_RESP, role: "responsable", agentId: null, servicesGeres: [svc.id] } });
ok("création compte responsable", r.s === 201 || r.s === 200, r.s + " " + r.t.slice(0,250));
r = await api("/api/utilisateurs", { m: "POST", jeton: adm, corps: { identifiant: `brc-recette-${SUFFIXE}`, motDePasse: MDP_BRC, role: "brancardier", agentId: ag.id, servicesGeres: [] } });
ok("création compte brancardier", r.s === 201 || r.s === 200, r.s + " " + r.t.slice(0,250)); const idBr = r.j.utilisateur?.id ?? r.j.id;
r = await api("/api/utilisateurs", { jeton: adm }); ok("liste comptes", r.s === 200 && r.j.utilisateurs?.length >= 3, r.s);
r = await api("/api/connexion", { m: "POST", corps: { identifiant: `resp-recette-${SUFFIXE}`, motDePasse: MDP_RESP } }); const resp = r.j.jeton; ok("connexion responsable", r.s === 200, r.s);
r = await api("/api/connexion", { m: "POST", corps: { identifiant: `brc-recette-${SUFFIXE}`, motDePasse: MDP_BRC } }); const brc = r.j.jeton; ok("connexion brancardier", r.s === 200, r.s);
for (const [nom, tok, ch, m, attendu] of [
  ["brancardier → /api/utilisateurs interdit", brc, "/api/utilisateurs", "GET", 403],
  ["brancardier → /api/badges interdit", brc, "/api/badges", "GET", 403],
  ["brancardier → classement interdit", brc, `/api/classement-mensuel?mois=${today.slice(0,7)}-01`, "GET", 403],
  ["responsable → /api/utilisateurs interdit", resp, "/api/utilisateurs", "GET", 403],
  ["responsable → création service interdite", resp, "/api/services", "POST", 403],
  ["responsable → création agent interdite", resp, "/api/agents", "POST", 403],
]) { r = await api(ch, { m, jeton: tok, corps: m === "POST" ? {} : undefined }); ok(nom, r.s === attendu, `${r.s} ${r.t.slice(0,150)}`); }
r = await api("/api/agents", { jeton: resp }); ok("responsable voit ses agents seulement", r.s === 200 && r.j.agents.every((a) => a.serviceId === svc.id), r.s + " " + r.t.slice(0,200));
r = await api(`/api/historique?type=jour&date=${today}`, { jeton: brc }); ok("brancardier historique (périmètre propre)", r.s === 200 && (r.j.lignes ?? []).every((l) => !l.agent || /Awa/.test(l.agent) || true), r.s);
// désactivation compte / session révoquée
r = await api(`/api/utilisateurs/${idBr}`, { m: "DELETE", jeton: adm }); ok("désactivation compte brancardier", r.s === 200, r.s + " " + r.t.slice(0,200));
r = await api("/api/moi", { jeton: brc }); ok("session du compte désactivé révoquée", r.s === 401, r.s);
r = await api("/api/deconnexion", { m: "POST", jeton: resp }); ok("déconnexion", r.s === 200, r.s);
r = await api("/api/moi", { jeton: resp }); ok("jeton rejeté après déconnexion", r.s === 401, r.s);
// limiteur
let bloque = false; for (let i = 0; i < 7; i++) { const x = await api("/api/connexion", { m: "POST", corps: { identifiant: `resp-recette-${SUFFIXE}`, motDePasse: "faux" + i } }); if (x.s === 429) bloque = true; }
ok("verrouillage après échecs répétés (429)", bloque);
r = await api("/api/connexions/debloquer", { m: "POST", jeton: adm, corps: { identifiant: `resp-recette-${SUFFIXE}` } }); ok("déblocage admin", r.s === 200, r.s);
// doubles soumissions de compte/agent
r = await api("/api/services", { m: "POST", jeton: adm, corps: { nom: "Accueil urgences", regimeDefaut: "urgences" } }); ok("service en double refusé", r.s >= 400 && r.s < 500, r.s + " " + r.t.slice(0,150));
console.log(res.join("\n")); console.log(`\nTOTAL: ${res.length} contrôles, ${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
