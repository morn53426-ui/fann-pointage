// FANN POINTAGE : interface web (PWA) sans dépendance. Toutes les données affichées passent par textContent (aucun HTML injecté).
// La position n'est lue qu'une seule fois, au moment du pointage (getCurrentPosition) ; aucun suivi continu.
import { creerSignalStation } from "/signal-station.js";
import { formaterCompteur, libelleAccessible, fusionnerCompteurs, aAugmente } from "/compteurs.js";
import { creerGardeScan, niveauPointageAgent, niveauPointageStation } from "/scan-pointage.js";
import { ordonnerVersoBadges, repartirLotsBadges } from "/badge-print-layout.js";
import { creerVueEmargement } from "/emargement.js";
import { evaluerOrigineQr } from "/origine-qr.js";
import { creerSourceQrBadge } from "/badge-qr.js";
import { CONTRAINTES_CAMERA_QR, INTERVALLE_SCAN_QR_NATIF_MS, INTERVALLE_SCAN_QR_JS_MS, calculerDimensionsDetectionQr } from "/qr-camera.js";
const racine = document.getElementById("contenu");
const menu = document.getElementById("menu");
const btnDeconnexion = document.getElementById("deconnexion");
const zoneCompteurs = document.getElementById("compteurs");
let moi = null;
let cleanupVue = null; // Nettoyage des ressources de la vue courante (caméra, écouteurs temporisés).
const signal = creerSignalStation(); // Son, vibration et notification du poste partagé.

function h(tag, props = {}, ...enfants) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of enfants.flat(Infinity)) e.append(c instanceof Node ? c : String(c ?? ""));
  return e;
}
const vider = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

// File locale IndexedDB pour les pointages faits au poste partagé lorsque le serveur est hors ligne.
// Une entrée reste « en attente » jusqu'à l'accusé du serveur ; le serveur marquera ces pointages à vérifier.
const DB_LOCALE = "fann-pointage-poste";
const STORE_FILE = "pointages-en-attente";
let synchronisationFileEnCours = false;
function ouvrirBaseLocale() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("Ce navigateur ne permet pas le stockage hors ligne."));
    const req = indexedDB.open(DB_LOCALE, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILE)) db.createObjectStore(STORE_FILE, { keyPath: "idempotencyKey" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Impossible d'ouvrir la file hors ligne."));
  });
}
async function stockerLocalement(evt) {
  const db = await ouvrirBaseLocale();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILE, "readwrite");
      tx.objectStore(STORE_FILE).put(evt);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Impossible d'enregistrer le pointage localement."));
      tx.onabort = () => reject(tx.error || new Error("Enregistrement local annulé."));
    });
  } finally { db.close(); }
  window.dispatchEvent(new Event("fann-queue-changed"));
}
async function lireFileLocale() {
  const db = await ouvrirBaseLocale();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILE, "readonly");
      const req = tx.objectStore(STORE_FILE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt))));
      req.onerror = () => reject(req.error || new Error("Lecture de la file hors ligne impossible."));
    });
  } finally { db.close(); }
}
async function retirerDeFileLocale(cle) {
  const db = await ouvrirBaseLocale();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILE, "readwrite");
      tx.objectStore(STORE_FILE).delete(cle);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Suppression de la file hors ligne impossible."));
    });
  } finally { db.close(); }
  window.dispatchEvent(new Event("fann-queue-changed"));
}
async function synchroniserFileLocale() {
  if (synchronisationFileEnCours || !navigator.onLine || !sessionStorage.getItem("jeton") || !moi || !["administrateur", "responsable"].includes(moi.role)) return;
  synchronisationFileEnCours = true;
  try {
    const elements = await lireFileLocale();
    for (const evt of elements) {
      try {
        await api("/api/pointage-station", { methode: "POST", corps: {
          ...(evt.matricule ? { matricule: evt.matricule } : { badgeCode: evt.badgeCode }), type: evt.type, idempotencyKey: evt.idempotencyKey,
          capturedAt: evt.capturedAt, horsLigne: true, operateurDeclare: evt.operateurId, appVersion: "pwa-station-offline-1",
        } });
        await retirerDeFileLocale(evt.idempotencyKey);
      } catch (e) {
        // Conserver l'élément si le réseau est indisponible ou si le serveur l'a refusé : le responsable doit le traiter.
        if (e && typeof e.statut === "number" && e.statut >= 400 && e.statut < 500 && e.statut !== 429) {
          evt.erreurSynchronisation = e.data?.message || e.message || "Événement à examiner";
          await stockerLocalement(evt);
          continue; // un événement refusé ne doit pas bloquer la synchronisation des suivants
        }
        break;
      }
    }
  } catch { /* Le statut sera visible dans la vue du poste ; aucun événement n'est supprimé. */ }
  finally { synchronisationFileEnCours = false; window.dispatchEvent(new Event("fann-queue-changed")); }
}
window.addEventListener("online", () => { void synchroniserFileLocale(); });

const LOC = {
  dans_zone: "Dans la zone autorisée", hors_zone: "Hors de la zone autorisée", precision_insuffisante: "Précision insuffisante",
  indisponible: "Position indisponible", refusee: "Localisation refusée", ancienne: "Position trop ancienne",
  suspecte: "Position suspecte", zone_inactive: "Zone désactivée", zone_inconnue: "Zone inconnue",
};
const VALIDATION = { accepte: "Pointage confirmé", refuse: "Pointage refusé", a_verifier: "Pointage à vérifier par un responsable", valide_manuellement: "Pointage validé par un responsable", non_enregistre: "Pointage non enregistré" };

async function api(chemin, { methode = "GET", corps, q, brut = false } = {}) {
  const url = new URL(chemin, location.origin);
  if (q) for (const [k, v] of Object.entries(q)) if (v) url.searchParams.set(k, v);
  const jeton = sessionStorage.getItem("jeton");
  const r = await fetch(url, {
    method: methode, headers: { ...(corps ? { "Content-Type": "application/json" } : {}), ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  if (r.status === 401 && chemin !== "/api/connexion") { deconnecter(); throw new Error("Session expirée"); }
  if (brut) return r;
  const data = await r.json().catch(() => ({}));
  if (!r.ok && r.status === 403 && data.erreur === "changement_mot_de_passe_requis" && moi) {
    // Mot de passe provisoire : le serveur refuse tout le reste tant qu'il n'est pas remplacé.
    moi.doitChangerMotDePasse = true;
    afficherChangementMotDePasse(true);
  }
  if (!r.ok && r.status === 403 && data.erreur === "mot_de_passe_provisoire_expire" && chemin !== "/api/connexion") { deconnecter(); }
  if (!r.ok) throw Object.assign(new Error(data.message || "Erreur"), { statut: r.status, data });
  return data;
}

function deconnecter() { arreterCompteurs(); cleanupVue?.(); cleanupVue = null; sessionStorage.removeItem("jeton"); try { localStorage.removeItem("fann-pointage-moi-cache"); } catch { /* stockage indisponible */ } moi = null; menu.hidden = true; btnDeconnexion.hidden = true; afficherConnexion(); }
btnDeconnexion.addEventListener("click", async () => {
  // Invalide d'abord le jeton côté serveur ; l'échec réseau ne doit pas empêcher la déconnexion locale.
  const jeton = sessionStorage.getItem("jeton");
  try { if (jeton) await fetch("/api/deconnexion", { method: "POST", headers: { Authorization: `Bearer ${jeton}` } }); } catch { /* hors ligne */ }
  deconnecter();
});

// ---------- Connexion ----------
function afficherConnexion() {
  vider(racine); menu.hidden = true;
  const msg = h("p", { role: "alert", class: "etat ko", hidden: true });
  const id = h("input", { id: "identifiant", autocomplete: "username", required: true });
  const mdp = h("input", { id: "mdp", type: "password", autocomplete: "current-password", required: true });
  const voir = h("button", { type: "button", class: "secondaire connexion-voir", "aria-pressed": "false", "aria-controls": "mdp", onclick: () => {
    const visible = mdp.type === "password";
    mdp.type = visible ? "text" : "password";
    voir.textContent = visible ? "Masquer" : "Afficher";
    voir.setAttribute("aria-pressed", String(visible));
  } }, "Afficher");
  const form = h("form", { class: "carte connexion-formulaire", onsubmit: async (ev) => {
    ev.preventDefault(); msg.hidden = true;
    try {
      const r = await api("/api/connexion", { methode: "POST", corps: { identifiant: id.value.trim(), motDePasse: mdp.value } });
      sessionStorage.setItem("jeton", r.jeton); mdp.value = ""; await demarrer();
    } catch (e) {
      msg.textContent = e.statut === 429
        ? "Trop de tentatives. Réessayez plus tard."
        : e.statut === 401
          ? "Identifiants invalides."
          : e.statut === 403 && e.data?.erreur === "mot_de_passe_provisoire_expire"
            ? "Votre mot de passe provisoire a expiré. Demandez à l’administrateur de le réinitialiser."
            : "Connexion impossible : vérifiez le réseau puis réessayez.";
      msg.hidden = false;
    }
  } },
  h("img", { class: "connexion-logo", src: "/icons/logo-chnuf.png", alt: "", width: "64", height: "64" }),
  h("h1", {}, "Connexion"),
  h("p", { class: "connexion-sous-titre" }, "Accédez à votre espace de pointage."),
  h("label", { for: "identifiant" }, "Identifiant"), id,
  h("label", { for: "mdp" }, "Mot de passe"), h("div", { class: "connexion-mdp" }, mdp, voir), msg,
  h("div", { class: "actions" }, h("button", { type: "submit" }, "Se connecter")),
  h("ul", { class: "connexion-atouts", "aria-label": "Points forts" }, h("li", {}, "Pointage en quelques secondes"), h("li", {}, "Données protégées"), h("li", {}, "Téléphone et ordinateur")),
  h("p", { class: "connexion-note" }, "Accès réservé au personnel autorisé du CHNUF."));
  const presentation = h("aside", { class: "connexion-visuel", "aria-label": "Présentation de FANN POINTAGE" },
    h("img", { src: "/images/fann-pointage-publicite.jpg", alt: "Affiche du CHNUF présentant FANN POINTAGE, application de pointage dédiée aux brancardiers", width: "1672", height: "941", decoding: "async", fetchpriority: "high" }));
  const disposition = h("section", { class: "connexion-layout", "aria-label": "Connexion à FANN POINTAGE" }, presentation, form);
  racine.append(disposition);
  id.focus();
}

// ---------- Changement de mot de passe (obligatoire avec un mot de passe provisoire, sinon volontaire) ----------
function afficherChangementMotDePasse(obligatoire) {
  cleanupVue?.(); cleanupVue = null;
  vider(racine);
  if (obligatoire) { menu.hidden = true; vider(menu); }
  racine.append(construireFormulaireMotDePasse(obligatoire));
}
function vueMotDePasse() { racine.append(construireFormulaireMotDePasse(false)); }
function construireFormulaireMotDePasse(obligatoire) {
  const estAdmin = moi?.role === "administrateur";
  const minimum = estAdmin ? 9 : 8;
  const statut = h("div", { role: "status", "aria-live": "polite" });
  const actuel = h("input", { id: "mdp-actuel", type: "password", autocomplete: "current-password", required: true, maxlength: "200" });
  const nouveau = h("input", { id: "mdp-nouveau", type: "password", autocomplete: "new-password", required: true, minlength: String(minimum), maxlength: "200" });
  const confirmation = h("input", { id: "mdp-confirmation", type: "password", autocomplete: "new-password", required: true, minlength: String(minimum), maxlength: "200" });
  const bouton = h("button", { type: "submit" }, "Enregistrer le nouveau mot de passe");
  const form = h("form", { class: "carte connexion-formulaire", onsubmit: async (ev) => {
    ev.preventDefault(); vider(statut);
    if (nouveau.value !== confirmation.value) { statut.append(h("p", { class: "etat ko", role: "alert" }, "La confirmation ne correspond pas au nouveau mot de passe.")); confirmation.focus(); return; }
    bouton.disabled = true;
    try {
      const r = await api("/api/moi", { methode: "PATCH", corps: { motDePasseActuel: actuel.value, nouveauMotDePasse: nouveau.value } });
      // L'ancien jeton est révoqué par le serveur : on garde immédiatement le nouveau.
      sessionStorage.setItem("jeton", r.jeton);
      actuel.value = ""; nouveau.value = ""; confirmation.value = "";
      if (moi) moi.doitChangerMotDePasse = false;
      if (obligatoire) { await demarrer(); return; }
      statut.append(h("p", { class: "etat ok", role: "status" }, r.message || "Mot de passe modifié."));
    } catch (e) {
      statut.append(h("p", { class: "etat ko", role: "alert" }, e.statut === 429 ? "Trop de tentatives. Réessayez plus tard." : (e.message || "Changement impossible : vérifiez le réseau puis réessayez.")));
    } finally { bouton.disabled = false; }
  } },
    h("h1", {}, obligatoire ? "Choisissez votre mot de passe" : "Mon mot de passe"),
    obligatoire ? h("p", { class: "etat attention", role: "status" }, "Votre mot de passe actuel est provisoire (il a été donné par l’administration). Remplacez-le par un mot de passe que vous êtes seul à connaître avant de continuer.") : null,
    h("label", { for: "mdp-actuel" }, obligatoire ? "Mot de passe provisoire (celui remis par l’administration)" : "Mot de passe actuel"), actuel,
    h("label", { for: "mdp-nouveau" }, `Nouveau mot de passe (${minimum} caractères minimum)`), nouveau,
    h("label", { for: "mdp-confirmation" }, "Confirmer le nouveau mot de passe"), confirmation,
    h("p", { class: "note" }, "Évitez votre numéro de téléphone, votre matricule ou une suite comme 12345678. Les autres appareils connectés à ce compte devront se reconnecter."),
    h("div", { class: "actions" }, bouton),
    obligatoire ? h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => btnDeconnexion.click() }, "Se déconnecter")) : null,
    statut);
  return form;
}

// ---------- Compteurs : messages non lus et anomalies ----------
// Mis à jour à la connexion, à chaque changement d'écran, toutes les 30 s et au retour sur l'onglet. Le serveur reste la seule source des chiffres.
const compteurs = { messages: null, anomalies: null };
let minuteurCompteurs = null;
function arreterCompteurs() {
  clearInterval(minuteurCompteurs); minuteurCompteurs = null; compteurs.messages = null; compteurs.anomalies = null;
  if (zoneCompteurs) { vider(zoneCompteurs); zoneCompteurs.hidden = true; }
  document.title = "FANN POINTAGE";
}
const NS_SVG = "http://www.w3.org/2000/svg";
function icone(cle) {
  const svg = document.createElementNS(NS_SVG, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "22", height: "22", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  const chemins = cle === "messages" ? ["M3 6h18v12H3z", "M3 7l9 7 9-7"] : ["M12 3l10 18H2z", "M12 10v5", "M12 18h.01"];
  for (const d of chemins) { const c = document.createElementNS(NS_SVG, "path"); c.setAttribute("d", d); svg.append(c); }
  return svg;
}
/** Les pages Messages et Anomalies ont déjà leur icône dans l'en-tête : on évite le doublon dans le menu (le menu les garde tant que l'icône n'est pas affichée). */
function masquerDoublonsMenu() {
  for (const a of menu.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    a.hidden = (href === "#/messages" && compteurs.messages !== null) || (href === "#/anomalies" && compteurs.anomalies !== null);
  }
}
/** Code provisoire aléatoire d'un agent : montré UNE fois à l'administrateur, à remettre séparément du badge. */
function blocCodesProvisoires(liste) {
  const texte = liste.map((c) => `${c.prenom} ${c.nom} — identifiant : ${c.identifiant} — code provisoire : ${c.motDePasseProvisoire}`).join("\n");
  const etat = h("span", { class: "note", role: "status" });
  return h("section", { class: "carte code-provisoire", role: "alert" },
    h("h3", {}, liste.length > 1 ? "Codes provisoires à remettre aux agents" : "Code provisoire à remettre à l’agent"),
    h("p", { class: "note" }, "Affichés une seule fois : ils ne sont ni enregistrés en clair ni réaffichables. Remettez-les séparément du badge ; chaque agent doit le remplacer à sa première connexion (valable 7 jours)."),
    h("ul", {}, ...liste.map((c) => h("li", {}, `${c.prenom} ${c.nom} — identifiant `, h("strong", {}, c.identifiant), " — code ", h("strong", { class: "code-valeur" }, c.motDePasseProvisoire)))),
    h("button", { type: "button", class: "secondaire", onclick: async () => { try { await navigator.clipboard.writeText(texte); etat.textContent = " Copié."; } catch { etat.textContent = " Copie impossible : recopiez les codes à la main."; } } }, "Copier"), etat);
}
/** Une modification de fiche peut créer le compte de l'agent (matricule ajouté, agent réactivé) : en mode « aleatoire », le code n'existe que dans cette réponse. */
function signalerCodeApresModification(r, agent) {
  const c = r?.compteAgent;
  if (c?.cree && c.motDePasseProvisoire) alert(`Compte créé pour ${agent}.\nIdentifiant : ${c.identifiant}\nCode provisoire : ${c.motDePasseProvisoire}\n\nAffiché une seule fois : notez-le et remettez-le à l'agent séparément du badge.`);
}
function afficherCompteurs(precedent) {
  if (!zoneCompteurs || !moi) return;
  vider(zoneCompteurs);
  const elements = [];
  if (compteurs.messages !== null) elements.push(["messages", "Messages", compteurs.messages, "#/messages"]);
  if (compteurs.anomalies !== null) elements.push(["anomalies", "Anomalies", compteurs.anomalies, "#/anomalies"]);
  for (const [cle, libelle, n, lien] of elements) {
    const texte = formaterCompteur(n);
    const augmente = precedent && precedent[cle] !== null && n > precedent[cle];
    // La pastille garde sa place (visibility) pour que l'en-tête ne bouge pas quand le compteur change.
    zoneCompteurs.append(h("a", { href: lien, class: `compteur${n > 0 ? " actif" : ""}${augmente ? " nouveau" : ""}${location.hash === lien ? " courant" : ""}`, "aria-current": location.hash === lien ? "page" : false, "aria-label": libelleAccessible(cle, n), title: libelleAccessible(cle, n) },
      icone(cle), h("span", { class: "compteur-libelle" }, libelle), h("b", { class: texte ? "pastille" : "pastille vide", "aria-hidden": "true" }, texte || "0")));
  }
  zoneCompteurs.hidden = elements.length === 0;
  masquerDoublonsMenu();
  const total = (compteurs.messages ?? 0) + (compteurs.anomalies ?? 0);
  document.title = total > 0 ? `(${total}) FANN POINTAGE` : "FANN POINTAGE";
  if (precedent && aAugmente(precedent, compteurs)) { try { navigator.vibrate?.(150); } catch { /* vibration indisponible */ } }
}
let actualisationCompteursEnCours = false;
async function actualiserCompteurs() {
  if (!moi || moi.doitChangerMotDePasse || !sessionStorage.getItem("jeton") || document.hidden || actualisationCompteursEnCours) return;
  actualisationCompteursEnCours = true; // pas de requêtes empilées si le réseau est lent
  const avant = { ...compteurs };
  try {
    if (moi.mode === "catalogue-postgres") {
      // Une seule requête légère : chiffres calculés par PostgreSQL pour le compte connecté. Une erreur conserve les valeurs affichées.
      const d = await api("/api/compteurs").catch(() => null);
      Object.assign(compteurs, fusionnerCompteurs(compteurs, d));
    } else if (moi.role === "administrateur" || moi.role === "responsable") {
      const d = await api("/api/anomalies").catch(() => null);
      if (d && Array.isArray(d.anomalies)) compteurs.anomalies = d.anomalies.length;
    }
  } finally { actualisationCompteursEnCours = false; }
  afficherCompteurs(avant);
}
function demarrerCompteurs() {
  clearInterval(minuteurCompteurs);
  void actualiserCompteurs();
  minuteurCompteurs = setInterval(() => { void actualiserCompteurs(); }, 30_000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) void actualiserCompteurs(); });
window.addEventListener("hashchange", () => { void actualiserCompteurs(); });

// ---------- Navigation ----------
// Vue des feuilles d'émargement : module séparé (/emargement.js), les fonctions communes lui sont transmises.
const vueEmargement = creerVueEmargement({ h, vider, api, racine, ouvrirPageImpression, dateDakar, datePlusJours });
const VUES = {
  pointage: ["Pointage", vuePointage, (m) => !!m.agentId],
  historique: ["Mon historique", vueHistorique, (m) => !!m.agentId],
  tableau: ["Tableau de bord", vueTableau, (m) => m.role !== "brancardier"],
  anomalies: ["Anomalies", vueAnomalies, (m) => m.role !== "brancardier"],
  absences: ["Absences & justifications", vueAbsences, (m) => m.role !== "brancardier"],
  rapports: ["Rapports", vueRapports, (m) => m.role !== "brancardier"],
  qr: ["QR de pointage", vueQr, (m) => m.role !== "brancardier"],
  station: ["Poste partagé", vuePostePartage, (m) => m.role !== "brancardier"],
  catalogue: ["Agents et services", vueCatalogue, (m) => m.role === "administrateur" && m.mode === "catalogue-postgres"],
  badges: ["Badges à imprimer", vueBadges, (m) => m.role === "administrateur"],
  planning: ["Planning & jours fériés", vuePlanning, (m) => m.role !== "brancardier"],
  emargement: ["Feuilles d'émargement", vueEmargement, (m) => m.role !== "brancardier"],
  comptes: ["Comptes utilisateurs", vueComptes, (m) => m.role === "administrateur"],
  classement: ["Classement mensuel", vueClassementMensuel, (m) => m.role === "administrateur" || m.role === "responsable"],
  messages: ["Messages", vueMessages, (m) => m.mode === "catalogue-postgres"],
  sauvegarde: ["Sauvegarde en ligne", vueSauvegarde, (m) => m.role === "administrateur" && m.mode === "catalogue-postgres"],
  motdepasse: ["Mon mot de passe", vueMotDePasse, (m) => m.mode === "catalogue-postgres"],
};
let minuteur = null;
function parseHash() {
  const [chemin, requete = ""] = location.hash.replace(/^#\/?/, "").split("?");
  return { nom: chemin || "", params: new URLSearchParams(requete) };
}
function naviguer() {
  if (!moi) return;
  clearInterval(minuteur); minuteur = null;
  cleanupVue?.(); cleanupVue = null;
  const { nom, params } = parseHash();
  const dispo = Object.entries(VUES).filter(([, v]) => v[2](moi));
  const cle = dispo.find(([k]) => k === nom)?.[0] ?? dispo[0]?.[0];
  vider(menu);
  for (const [k, v] of dispo) menu.append(h("a", { href: `#/${k}`, "aria-current": k === cle ? "page" : false }, v[0]));
  masquerDoublonsMenu();
  afficherCompteurs(null); // met à jour l'icône « page courante » de l'en-tête
  menu.hidden = false;
  vider(racine);
  try {
    VUES[cle][1](params);
    racine.focus();
  } catch (erreur) {
    // Une exception d'interface ne doit pas laisser un écran entièrement blanc.
    console.error(`Échec du rendu de la vue « ${cle} ».`, erreur);
    vider(racine);
    racine.append(
      h("section", { class: "carte etat ko", role: "alert" },
        h("h1", {}, "Cette page n’a pas pu être affichée"),
        h("p", {}, "Une erreur empêche le chargement de cette fonctionnalité. Actualisez la page. Si le problème persiste, transmettez ce message à l’administrateur technique."),
        h("p", { class: "note" }, `Vue concernée : ${VUES[cle][0]}`),
        h("button", { type: "button", onclick: () => naviguer() }, "Réessayer")),
    );
  }
}
window.addEventListener("hashchange", naviguer);

// Détecteur QR : moteur natif rapide quand disponible, jsQR optimisé en secours (notamment Safari iPhone).
function creerDetecteurQr() {
  if ("BarcodeDetector" in window) {
    try {
      const d = new window.BarcodeDetector({ formats: ["qr_code"] });
      return { detect: (video) => d.detect(video), intervalleMs: INTERVALLE_SCAN_QR_NATIF_MS };
    } catch { /* Constructeur présent mais format QR indisponible : utiliser jsQR. */ }
  }
  if (typeof window.jsQR !== "function") return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  return {
    intervalleMs: INTERVALLE_SCAN_QR_JS_MS,
    detect: async (video) => {
      if (!video.videoWidth || !video.videoHeight) return [];
      const dimensions = calculerDimensionsDetectionQr(video.videoWidth, video.videoHeight);
      if (!dimensions.width || !dimensions.height) return [];
      if (canvas.width !== dimensions.width || canvas.height !== dimensions.height) {
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
      }
      ctx.drawImage(video, 0, 0, dimensions.width, dimensions.height);
      const img = ctx.getImageData(0, 0, dimensions.width, dimensions.height);
      // Les badges sont imprimés en noir sur blanc : ne pas perdre du temps à chercher un QR inversé.
      const r = window.jsQR(img.data, dimensions.width, dimensions.height, { inversionAttempts: "dontInvert" });
      return r && r.data ? [{ rawValue: r.data }] : [];
    },
  };
}

async function ouvrirCameraQr() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: CONTRAINTES_CAMERA_QR });
  // Demander la mise au point continue uniquement si le téléphone l'annonce comme capacité.
  const piste = stream.getVideoTracks?.()[0];
  try {
    const capacites = piste?.getCapabilities?.();
    if (capacites?.focusMode?.includes("continuous")) {
      void piste.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    }
  } catch { /* La caméra garde son autofocus par défaut si le réglage n'est pas accepté. */ }
  return stream;
}
function messageErreurCamera(e) {
  if (!window.isSecureContext) return "La caméra exige une adresse HTTPS (ou localhost).";
  const n = e && e.name;
  if (n === "NotAllowedError" || n === "SecurityError") return "Accès à la caméra refusé : autorisez-la dans les réglages du navigateur pour ce site.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "Aucune caméra arrière trouvée sur cet appareil.";
  if (n === "NotReadableError") return "La caméra est utilisée par une autre application : fermez-la puis réessayez.";
  return "Caméra inaccessible : autorisez-la ou saisissez le code.";
}
function demarrerVideo(video) {
  video.muted = true; video.playsInline = true;
  const p = video.play(); if (p && p.catch) p.catch(() => {});
}

// ---------- Pointage ----------
function vuePointage(params) {
  const qr = h("input", { id: "qr", autocomplete: "off", value: params.get("qr") || "" });
  // Trois moyens : QR du service (uniquement le VÔTRE), MON badge imprimé (scanné), MON matricule. Badge et matricule valent partout dans l'hôpital ;
  // le QR affiché dans un autre service est refusé par le serveur. Badge et matricule se contrôlent sur le compte connecté.
  const moyen = h("select", { id: "moyen-pointage" },
    h("option", { value: "qr" }, "QR affiché dans MON service"),
    h("option", { value: "badge" }, "Mon badge imprimé (scanner)"),
    h("option", { value: "matricule" }, "Mon matricule (saisie)"));
  const libelleCode = h("label", { for: "qr" }, "Code du QR affiché dans votre service");
  const boutonCamera = h("button", { type: "button", class: "secondaire", onclick: () => { signal.preparer(); void scanner(); } }, "Scanner avec la caméra");
  const majMoyen = () => {
    libelleCode.textContent = moyen.value === "badge" ? "Code de votre badge (scannez le QR imprimé au verso)" : moyen.value === "matricule" ? "Votre matricule (ex. FANN-004)" : "Code du QR affiché dans votre service";
    boutonCamera.hidden = moyen.value === "matricule";
    qr.placeholder = moyen.value === "matricule" ? "FANN-004" : "";
    qr.inputMode = moyen.value === "matricule" ? "text" : "";
  };
  moyen.addEventListener("change", () => { qr.value = ""; majMoyen(); });
  const zoneVideo = h("div"); const resultat = h("div", { "aria-live": "polite" });
  const bouton = h("button", { type: "button" }, "Pointer maintenant");
  let cle = null; let flux = null;
  let generationCamera = 0;
  let lancementCamera = false;
  const caseSon = h("input", { id: "son-pointage", type: "checkbox" });
  caseSon.checked = signal.sonActif();
  caseSon.addEventListener("change", () => { signal.definirSon(caseSon.checked); if (caseSon.checked) { signal.preparer(); signal.jouer("scan"); } });
  const zoneNotifications = h("div");
  function actualiserNotifications() {
    vider(zoneNotifications);
    const etat = signal.permission();
    if (etat === "granted") zoneNotifications.append(h("p", { class: "note" }, "Notifications activées sur cet appareil."));
    else if (etat === "default") zoneNotifications.append(h("button", { type: "button", class: "secondaire", onclick: async () => { await signal.demanderPermission(); actualiserNotifications(); } }, "Activer les notifications"));
    else if (etat === "denied") zoneNotifications.append(h("p", { class: "note" }, "Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site."));
    else zoneNotifications.append(h("p", { class: "note" }, "Les notifications ne sont pas prises en charge par ce navigateur."));
  }

  function normaliserTokenQr(valeur) {
    const brut = String(valeur || "").trim();
    try {
      const url = new URL(brut);
      const hash = url.hash.replace(/^#\/?/, "");
      const i = hash.indexOf("?");
      if (i >= 0) {
        const token = new URLSearchParams(hash.slice(i + 1)).get("qr");
        if (token) return token;
      }
      const tokenDirect = url.searchParams.get("qr");
      if (tokenDirect) return tokenDirect;
    } catch { /* Le contenu est peut-être le jeton brut. */ }
    return brut;
  }
  const garde = creerGardeScan();
  async function scanner() {
    if (flux || lancementCamera) return; // Évite plusieurs flux concurrents si le bouton est tapé plusieurs fois.
    const detecteur = creerDetecteurQr();
    if (!detecteur || !navigator.mediaDevices?.getUserMedia) { zoneVideo.textContent = !window.isSecureContext ? "La caméra exige une adresse HTTPS (ou localhost)." : "Scan caméra non disponible sur cet appareil : collez le code du QR ou ouvrez le lien du QR."; return; }
    const generation = ++generationCamera;
    lancementCamera = true;
    try {
      const nouveauFlux = await ouvrirCameraQr();
      // La vue a pu être quittée pendant la demande d'autorisation : ne jamais garder le flux tardif.
      if (generation !== generationCamera) { nouveauFlux.getTracks().forEach((t) => t.stop()); return; }
      flux = nouveauFlux;
      const video = h("video", { autoplay: true, playsinline: true, muted: true, "aria-label": "Caméra arrière : placez le QR dans le cadre blanc" }); video.srcObject = flux; zoneVideo.classList.add("scan-camera-zone"); zoneVideo.setAttribute("aria-label", "Placez le QR au centre du cadre blanc"); vider(zoneVideo); zoneVideo.append(video); demarrerVideo(video);
      const boucle = async () => {
        if (!flux || generation !== generationCamera) return;
        const codes = await detecteur.detect(video).catch(() => []);
        if (!flux || generation !== generationCamera) return;
        if (codes.length) {
          const brut = String(codes[0].rawValue || "").trim();
          // Un badge scanné bascule automatiquement le moyen de pointage sur « Mon badge ».
          if (brut.startsWith("FANN-BADGE:")) { moyen.value = "badge"; majMoyen(); qr.value = brut; } else qr.value = normaliserTokenQr(brut);
          // Pas de bip ici : le signal de succès n'est émis qu'après la confirmation du serveur (un seul bip et une seule vibration par scan).
          arreter();
          // Anti-doublon : un même QR détecté plusieurs fois ne déclenche qu'un seul envoi.
          if (garde.accepter(qr.value)) { vider(resultat); resultat.append(h("p", { class: "etat attention", role: "status" }, "Code lu, envoi du pointage…")); bouton.click(); }
          return;
        }
        setTimeout(boucle, detecteur.intervalleMs);
      };
      boucle();
    } catch (e) {
      if (generation === generationCamera) zoneVideo.textContent = messageErreurCamera(e);
    } finally {
      if (generation === generationCamera) lancementCamera = false;
    }
  }
  function arreter() {
    generationCamera += 1; // Invalide les boucles de détection et une demande getUserMedia encore en cours.
    lancementCamera = false;
    if (flux) flux.getTracks().forEach((t) => t.stop());
    flux = null;
    vider(zoneVideo);
    zoneVideo.classList.remove("scan-camera-zone");
    zoneVideo.removeAttribute("aria-label");
  }
  cleanupVue = arreter;

  bouton.addEventListener("click", async () => {
    signal.preparer();
    vider(resultat);
    if (!qr.value.trim()) { resultat.append(h("p", { class: "etat ko", role: "alert" }, moyen.value === "matricule" ? "Saisissez d'abord votre matricule." : "Scannez ou collez d'abord le QR code.")); signal.jouer("ko"); garde.terminer({ rearmer: true }); return; }
    if (moyen.value === "qr" && qr.value.trim().startsWith("FANN-BADGE:")) { moyen.value = "badge"; majMoyen(); }
    bouton.disabled = true; resultat.append(h("p", { class: "etat attention" }, "Localisation en cours…"));
    cle = cle || crypto.randomUUID();     // la même clé est conservée si la requête doit être renvoyée
    try {
      const lecture = await lirePosition();
      const preuve = moyen.value === "badge" ? { badgeCode: qr.value.trim() } : moyen.value === "matricule" ? { matricule: qr.value.trim() } : { qrToken: normaliserTokenQr(qr.value) };
      const r = await api("/api/pointage", { methode: "POST", corps: { ...preuve, idempotencyKey: cle, permission: lecture.permission, position: lecture.position, appVersion: "pwa-1" } });
      cle = null; afficherResultat(resultat, r);
      if (r.confirme) resultat.prepend(h("p", { class: "etat ok", role: "status" }, "Pointage enregistré avec succès"));
      garde.terminer({ rearmer: !r.confirme });
      void signal.signaler(niveauPointageAgent(r),
        r.confirme ? "Pointage enregistré" : (r.validation === "a_verifier" ? "Pointage à vérifier" : "Pointage refusé"),
        r.message || VALIDATION[r.validation] || "Résultat du pointage", { arrierePlanSeulement: true });
    } catch (e) {
      vider(resultat);
      const messageErreur = e && typeof e.statut === "number"
        ? (e.data?.message || e.message || "Pointage refusé par le serveur.")
        : "Réseau indisponible : le pointage n'est PAS confirmé. Réessayez.";
      resultat.append(h("p", { class: "etat ko", role: "alert" }, messageErreur));
      garde.terminer({ rearmer: true });
      void signal.signaler("ko", "Pointage non confirmé", messageErreur, { arrierePlanSeulement: true });
    } finally {
      bouton.disabled = false;
    }
  });

  racine.append(h("section", { class: "carte" },
    h("h1", {}, "Pointage"),
    h("p", { class: "note" }, "Votre position est lue une seule fois, au moment du pointage. Elle n'est pas suivie en continu."),
    h("p", { class: "note" }, "Connecté à votre compte, pointez une fois sur place avec le QR du service, votre propre badge ou votre matricule. La localisation est vérifiée dans tous les cas."),
    h("label", { for: "moyen-pointage" }, "Moyen de pointage"), moyen,
    libelleCode, qr,
    h("div", { class: "controle-selection" }, h("label", { for: "son-pointage" }, caseSon, "Bip et vibration à chaque pointage")),
    zoneNotifications,
    h("div", { class: "actions" }, boutonCamera, bouton),
    zoneVideo), resultat);
  majMoyen();
  actualiserNotifications();
}

function lirePosition() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ permission: "indisponible", position: null });
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ permission: "accordee", position: {
          latitude: p.coords.latitude, longitude: p.coords.longitude, precisionM: p.coords.accuracy,
          ageMs: Math.max(0, Date.now() - p.timestamp),   // durée mesurée sur l'appareil : l'heure du téléphone n'est pas l'heure de pointage
          methode: "geolocation_api" } }),
        (e) => resolve({ permission: e.code === 1 ? "refusee" : "indisponible", position: null }),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    } catch {
      resolve({ permission: "indisponible", position: null });
    }
  });
}

function afficherResultat(zone, r) {
  vider(zone);
  const classe = r.confirme ? "ok" : (r.validation === "a_verifier" ? "attention" : "ko");
  const carte = h("div", { class: "carte", role: "status" },
    h("p", { class: `etat ${classe}` }, VALIDATION[r.validation] || "Résultat"), h("p", {}, r.message));
  const lignes = [];
  if (r.type) lignes.push(["Type", r.type === "arrivee" ? "Arrivée" : "Départ"]);
  if (r.zone?.nom) lignes.push(["Zone détectée", r.zone.nom]);
  if (r.zone?.distanceM != null) lignes.push(["Distance au centre de la zone", `${Math.round(r.zone.distanceM)} m`]);
  if (r.zone?.ecartZoneM) lignes.push(["Écart avec la limite de la zone", `${Math.round(r.zone.ecartZoneM)} m`]);
  if (r.zone?.precisionM != null) lignes.push(["Précision de la position", `${Math.round(r.zone.precisionM)} m`]);
  if (r.statutLocalisation) lignes.push(["Localisation", LOC[r.statutLocalisation] || r.statutLocalisation]);
  if (r.serverTs) lignes.push(["Heure du serveur", new Date(r.serverTs).toLocaleString("fr-FR", { timeZone: "Africa/Dakar" })]);
  carte.append(h("dl", {}, lignes.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
  if (r.procedureGps) carte.append(h("p", { class: "note" }, r.procedureGps));
  zone.append(carte);
}

// ---------- Outils ----------
const aujourdhui = () => new Date().toISOString().slice(0, 10);
function selecteurPeriode(onChange) {
  const type = h("select", { id: "type" }, [["jour", "Jour"], ["semaine", "Semaine"], ["mois", "Mois"]].map(([v, t]) => h("option", { value: v }, t)));
  const date = h("input", { id: "date", type: "date", value: aujourdhui() });
  const go = h("button", { type: "button", onclick: () => onChange(type.value, date.value) }, "Afficher");
  return { type, date, bloc: h("div", { class: "carte" }, h("label", { for: "type" }, "Période"), type, h("label", { for: "date" }, "Date de référence"), date, h("div", { class: "actions" }, go)) };
}
function tableau(colonnes, lignes) {
  return h("div", { class: "tableau" }, h("table", {}, h("thead", {}, h("tr", {}, colonnes.map((c) => h("th", { scope: "col" }, c[0])))),
    h("tbody", {}, lignes.map((l) => h("tr", {}, colonnes.map((c) => h("td", {}, c[1](l) ?? "")))))));
}
const COLONNES_LIGNES = [
  ["Nom", (l) => `${l.agent_prenom} ${l.agent_nom}`], ["Service", (l) => l.service], ["Régime", (l) => l.regime], ["Poste", (l) => l.type_poste],
  ["Début prévu", (l) => l.prevu_debut], ["Arrivée", (l) => l.arrivee_reelle], ["Départ", (l) => l.depart_reel], ["Retard (min)", (l) => l.retard_min],
  ["Statut", (l) => l.statut_presence], ["Localisation", (l) => LOC[l.statut_localisation] || l.statut_localisation], ["Anomalies", (l) => l.anomalies],
];

// ---------- Historique ----------
function vueHistorique() {
  const sortie = h("div");
  const charger = async (type, date) => {
    vider(sortie);
    try { const r = await api("/api/historique", { q: { type, date } }); sortie.append(r.lignes.length ? tableau(COLONNES_LIGNES.slice(2), r.lignes) : h("p", {}, "Aucun poste sur cette période.")); }
    catch (e) { sortie.append(h("p", { class: "etat ko", role: "alert" }, e.message)); }
  };
  const p = selecteurPeriode(charger);
  racine.append(h("h1", {}, "Mon historique"), p.bloc, sortie); charger("jour", aujourdhui());
}

// ---------- Tableau de bord ----------
const REGIMES = [["general", "Service général"], ["garde", "Gardes classiques"], ["urgences", "Urgences"], ["mobil", "Mobil · jour 08 h–16 h / garde 16 h–08 h ou 08 h–08 h"]];
function vueTableau() {
  const sortie = h("div", { class: "dashboard", "aria-live": "polite" });
  const regime = h("select", { id: "regime-dashboard", "aria-label": "Filtrer les régimes" },
    [["", "Tous les régimes"], ...REGIMES].map(([v, t]) => h("option", { value: v }, t)));
  const fmt = (v) => new Intl.NumberFormat("fr-FR").format(Number(v || 0));
  const charger = async () => {
    try {
      const t = await api("/api/tableau-de-bord", { q: { regime: regime.value } });
      const resume = t.resume || {};
      const regimesAffiches = REGIMES.filter(([key]) => !regime.value || key === regime.value);
      const etatDb = t.source === "postgresql" && t.fictif === false;
      const hero = h("section", { class: "dashboard-hero" },
        h("div", { class: "dashboard-hero-copy" },
          h("p", { class: "dashboard-kicker" }, "CENTRE DE SUPERVISION · CHNU FANN"),
          h("h1", {}, "Tableau de bord"),
          h("p", { class: "dashboard-subtitle" }, "Vision opérationnelle des présences, des postes en cours et des situations à examiner.")),
        h("div", { class: "dashboard-meta" },
          h("span", { class: `dashboard-state ${etatDb ? "is-live" : "is-demo"}` }, h("span", { class: "dashboard-state-dot" }), etatDb ? "PostgreSQL connecté" : "Source à vérifier"),
          h("small", {}, `Actualisé à ${new Date(t.genereLe).toLocaleTimeString("fr-FR", { timeZone: "Africa/Dakar", hour: "2-digit", minute: "2-digit" })}`)));
      const kpis = [
        { label: "Agents actifs", valeur: resume.agentsActifs, aide: "Registre actif", icon: "👥", ton: "green" },
        { label: "Postes en cours", valeur: resume.postesEnCours, aide: "Tous régimes confondus", icon: "◷", ton: "navy" },
        { label: "Présents maintenant", valeur: resume.presents, aide: "Arrivée enregistrée", icon: "✓", ton: "teal" },
        { label: "Badges actifs", valeur: resume.badgesActifs, aide: "Émis et non révoqués", icon: "▣", ton: "gold" },
        { label: "À examiner", valeur: resume.pointagesAExaminer, aide: "Anomalies ou localisation", icon: "!", ton: Number(resume.pointagesAExaminer || 0) ? "rose" : "green" },
      ];
      const cartes = h("section", { class: "dashboard-kpis", "aria-label": "Indicateurs clés" }, ...kpis.map((k) =>
        h("article", { class: `dashboard-kpi ${k.ton}` },
          h("div", { class: "dashboard-kpi-head" }, h("span", { class: "dashboard-kpi-icon", "aria-hidden": "true" }, k.icon), h("span", { class: "dashboard-kpi-label" }, k.label)),
          h("strong", { class: "dashboard-kpi-value" }, fmt(k.valeur)), h("small", {}, k.aide))));
      const presence = h("section", { class: "dashboard-section dashboard-presence" },
        h("div", { class: "dashboard-section-head" }, h("div", {}, h("p", { class: "dashboard-kicker" }, "INDICATEUR GLOBAL"), h("h2", {}, "Taux de présence des postes actifs")),
          h("strong", { class: "dashboard-rate" }, `${fmt(resume.tauxPresence)} %`)),
        h("progress", { class: "dashboard-progress", max: 100, value: Math.min(100, Math.max(0, Number(resume.tauxPresence || 0))), "aria-label": `Taux de présence : ${fmt(resume.tauxPresence)} pour cent` }),
        h("p", { class: "note" }, `${fmt(resume.presents)} présence(s) sur ${fmt(resume.postesEnCours)} poste(s) actuellement actif(s).`));
      const trend = h("section", { class: "dashboard-section dashboard-trend" },
        h("div", { class: "dashboard-section-head" }, h("div", {}, h("p", { class: "dashboard-kicker" }, "ÉVOLUTION"), h("h2", {}, "Présences sur 7 jours")), h("span", { class: "dashboard-pill" }, "Arrivées validées")));
      const joursTrend = Array.isArray(t.tendance7Jours) ? t.tendance7Jours : [];
      const maxTrend = Math.max(1, ...joursTrend.map((d) => Number(d.presents || 0)));
      const bars = h("div", { class: "dashboard-chart" }, ...joursTrend.map((d) => {
        const label = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Dakar", day: "2-digit", month: "short" }).format(new Date(`${d.date}T12:00:00Z`));
        const presents = Number(d.presents || 0);
        // Barre dessinée avec des <div> : le <progress> vertical tourné n'est pas rendu de façon fiable sur téléphone.
        // La hauteur est posée par le DOM (compatible avec la politique de sécurité qui interdit les styles en ligne).
        const remplissage = h("span", { class: "dashboard-chart-fill" });
        remplissage.style.height = `${Math.round(presents / maxTrend * 100)}%`;
        if (presents > 0) remplissage.style.minHeight = "4px";
        return h("div", { class: "dashboard-chart-day" }, h("strong", {}, fmt(d.presents)),
          h("div", { class: "dashboard-chart-bar", role: "img", "aria-label": `${label} : ${fmt(d.presents)} présence(s)` }, remplissage), h("small", {}, label));
      }));
      trend.append(bars);
      const regimes = h("section", { class: "dashboard-regimes" }, h("div", { class: "dashboard-section-head" }, h("div", {}, h("p", { class: "dashboard-kicker" }, "SUIVI PAR ORGANISATION"), h("h2", {}, "Vue par régime")), h("div", { class: "dashboard-filter" }, h("label", { for: "regime-dashboard" }, "Afficher"), regime)));
      for (const [key, nom] of regimesAffiches) {
        const i = t.parRegime?.[key] || {};
        const taux = Number(i.attendus || 0) ? Math.round(Number(i.presents || 0) / Number(i.attendus) * 100) : 0;
        const compteurs = [
          ["En attente", i.enAttenteArrivee], ["Retards", i.retards], ["À vérifier", i.aVerifier],
          ["Hors zone", i.horsZone], ["Pointages incomplets", i.pointagesIncomplets], ["Absents à confirmer", i.absentsAConfirmer],
        ];
        regimes.append(h("article", { class: "dashboard-regime-card" },
          h("div", { class: "dashboard-regime-top" }, h("div", {}, h("span", { class: `dashboard-regime-mark regime-${key}` }), h("h3", {}, nom)), h("span", { class: "dashboard-regime-count" }, `${fmt(i.presents)} / ${fmt(i.attendus)} présents`)),
          h("progress", { class: "dashboard-progress", max: 100, value: taux, "aria-label": `${nom} : ${taux} pour cent de présence` }),
          h("div", { class: "dashboard-regime-stats" }, ...compteurs.map(([label, value]) => h("div", { class: Number(value || 0) > 0 && ["À vérifier", "Hors zone", "Retards", "Absents à confirmer"].includes(label) ? "has-alert" : "" }, h("span", {}, label), h("strong", {}, fmt(value)))))));
      }
      const noteSource = h("p", { class: "dashboard-footnote" }, t.indisponible?.length ? `Fonctions non encore raccordées : ${t.indisponible.join(", ")}.` : "Les indicateurs sont calculés depuis PostgreSQL. Les anomalies doivent être examinées par l’encadrement ; le tableau n’effectue aucun suivi continu de localisation.");
      vider(sortie); sortie.append(hero, cartes, presence, trend, regimes, noteSource);
    } catch (e) { vider(sortie); sortie.append(h("div", { class: "dashboard-error" }, h("strong", {}, "Tableau de bord indisponible"), h("p", {}, e.message || "La connexion aux indicateurs PostgreSQL a échoué."))); }
  };
  regime.addEventListener("change", charger);
  racine.append(sortie); charger(); minuteur = setInterval(charger, 30000);
}

// ---------- Anomalies ----------
function vueAnomalies() {
  const sortie = h("div");
  const LIBELLE_STATUT = { nouvelle: "Nouvelle", consultee: "Consultée", traitee: "Traitée" };
  const filtre = h("select", { id: "filtre-anomalies", "aria-label": "Filtrer par statut" },
    h("option", { value: "a_suivre" }, "À suivre (nouvelles et consultées)"), h("option", { value: "nouvelle" }, "Nouvelles"),
    h("option", { value: "consultee" }, "Consultées"), h("option", { value: "traitee" }, "Traitées"), h("option", { value: "toutes" }, "Toutes"));
  const changerStatut = async (a, statut) => {
    try { await api(`/api/anomalies/${encodeURIComponent(a.pointageId)}/statut`, { methode: "POST", corps: { statut } }); await charger(); void actualiserCompteurs(); } catch (e) { alert(e.message); }
  };
  const charger = async () => {
    vider(sortie);
    try {
      const { anomalies } = await api("/api/anomalies", moi?.mode === "catalogue-postgres" ? { q: { statut: filtre.value } } : undefined);
      if (!anomalies.length) { sortie.append(h("p", {}, "Aucune anomalie dans cette catégorie.")); return; }
      for (const a of anomalies) {
        const suivi = a.statut !== undefined; // le suivi (nouvelle / consultée / traitée) est conservé dans PostgreSQL
        const carte = h("div", { class: "carte" }, h("span", { class: `badge ${a.gravite}` }, a.gravite), " ",
          suivi ? h("span", { class: `badge statut-${a.statut}` }, LIBELLE_STATUT[a.statut] || a.statut) : null, " ",
          h("strong", {}, a.type.replaceAll("_", " ")),
          h("p", {}, `${a.agent}${a.service ? ` · ${a.service}` : ""}${a.at ? ` · ${new Date(a.at).toLocaleString("fr-FR", { timeZone: "Africa/Dakar" })}` : ""} · ${a.message}`));
        if (suivi) {
          const actions = h("div", { class: "actions" });
          // Ouvrir la liste ne change aucun statut : « consultée » et « traitée » sont deux actions explicites.
          if (a.statut === "nouvelle") actions.append(h("button", { type: "button", class: "secondaire", onclick: () => changerStatut(a, "consultee") }, "Marquer comme consultée"));
          if (a.statut !== "traitee") actions.append(h("button", { type: "button", class: "secondaire", onclick: () => changerStatut(a, "traitee") }, "Marquer comme traitée"));
          else actions.append(h("button", { type: "button", class: "secondaire", onclick: () => changerStatut(a, "consultee") }, "Rouvrir"));
          carte.append(actions);
        }
        if (a.type === "verification_manuelle" && a.pointageId) {
          carte.append(h("button", { type: "button", class: "secondaire", onclick: async () => {
            const motif = prompt("Motif de la validation manuelle (obligatoire) :");
            if (!motif || !motif.trim()) return;
            try { await api(`/api/pointages/${a.pointageId}/validation`, { methode: "POST", corps: { motif } }); await charger(); void actualiserCompteurs(); } catch (e) { alert(e.message); }
          } }, "Valider manuellement"));
        }
        sortie.append(carte);
      }
    } catch (e) { sortie.append(h("p", { class: "etat ko", role: "alert" }, e.message)); }
  };
  filtre.addEventListener("change", charger);
  racine.append(h("h1", {}, "Anomalies (48 dernières heures)"), moi?.mode === "catalogue-postgres" ? h("div", { class: "controle-selection" }, h("label", { for: "filtre-anomalies" }, "Statut : "), filtre) : null, sortie); charger();
}

// ---------- Registre des absences et validation motivée ----------
async function vueAbsences() {
  const statut = h("div", { role: "status", "aria-live": "polite" });
  const liste = h("div", { class: "tableau-responsive" });
  const agent = h("select", { required: true }, h("option", { value: "", selected: true, disabled: true }, "Choisir un agent…"));
  const debut = h("input", { type: "date", required: true, value: aujourdhui() });
  const fin = h("input", { type: "date", required: true, value: aujourdhui() });
  const categorie = h("select", {}, ...["absence", "congé", "autorisation", "autre"].map((v) => h("option", { value: v }, v[0].toLocaleUpperCase("fr") + v.slice(1))));
  const note = h("textarea", { rows: "2", maxlength: "500", placeholder: "Note administrative facultative. Ne pas inscrire de diagnostic médical." });
  const formulaire = h("form", { class: "carte form-creation-badge", onsubmit: async (ev) => {
    ev.preventDefault(); vider(statut);
    if (fin.value < debut.value) { statut.append(h("p", { class: "etat ko", role: "alert" }, "La date de fin précède la date de début.")); return; }
    try {
      const r = await api("/api/absences", { methode: "POST", corps: { agentId: agent.value, debut: debut.value, fin: fin.value, categorie: categorie.value, note: note.value } });
      statut.append(h("p", { class: "etat ok" }, r.message || "Absence enregistrée à confirmer.")); note.value = ""; await charger();
    } catch (e) { statut.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Enregistrement impossible.")); }
  } },
    h("h2", {}, "Enregistrer une absence ou une autorisation"),
    h("p", { class: "note" }, "Toute nouvelle entrée reste « à confirmer ». Seule une décision d’un responsable habilité, avec motif, peut la rendre justifiée ou injustifiée ; une entrée à confirmer n’impacte pas le Top 5."),
    h("div", { class: "form-badge-grille" },
      h("div", {}, h("label", {}, "Agent"), agent),
      h("div", {}, h("label", {}, "Du"), debut),
      h("div", {}, h("label", {}, "Au"), fin),
      h("div", {}, h("label", {}, "Catégorie"), categorie),
      h("div", {}, h("label", {}, "Note administrative"), note)),
    h("button", { type: "submit" }, "Enregistrer à confirmer"), statut);
  const exporter = async () => {
    try {
      const r = await api("/api/absences", { q: { format: "csv" }, brut: true });
      if (!r.ok) throw new Error("Export du registre refusé.");
      const url = URL.createObjectURL(await r.blob());
      const lien = h("a", { href: url, download: (r.headers.get("Content-Disposition") || "").match(/filename="(.+)"/)?.[1] || "absences.csv" });
      document.body.append(lien); lien.click(); lien.remove(); URL.revokeObjectURL(url);
    } catch (e) { alert(e.message || "Export impossible."); }
  };
  racine.append(h("h1", {}, "Absences & justifications"), formulaire,
    h("section", { class: "carte" }, h("h2", {}, "Registre et décisions"), h("p", { class: "note" }, "Les décisions sont historisées. Les responsables ne voient que les services qui leur sont attribués."), h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: exporter }, "Exporter le registre (CSV)")), liste));
  try {
    const agents = await api("/api/agents");
    for (const a of agents.agents || []) agent.append(h("option", { value: a.id }, `${a.prenom} ${a.nom} · ${a.service}`));
  } catch (e) { statut.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Chargement des agents impossible.")); }
  await charger();

  async function charger() {
    try {
      const data = await api("/api/absences");
      const corps = h("tbody", {});
      const statutLibelle = { a_confirmer: "À confirmer", justifiee: "Justifiée", injustifiee: "Injustifiée validée", refusee: "Refusée" };
      for (const a of data.absences || []) {
        const actions = h("div", { class: "actions-compte" });
        if (a.statut === "a_confirmer") {
          for (const [valeur, libelle] of [["justifiee", "Marquer justifiée"], ["injustifiee", "Valider injustifiée"], ["refusee", "Refuser"]]) {
            actions.append(h("button", { type: "button", class: "secondaire", onclick: async () => {
              const motif = prompt(`${libelle} — indiquez le motif (obligatoire) :`);
              if (!motif || motif.trim().length < 4) { alert("Un motif d’au moins 4 caractères est obligatoire."); return; }
              if (valeur === "injustifiee" && !confirm("Confirmer l’absence comme injustifiée ? Cette décision sera prise en compte dans le calcul du classement mensuel.")) return;
              try { await api(`/api/absences/${encodeURIComponent(a.id)}`, { methode: "PATCH", corps: { statut: valeur, motif } }); await charger(); }
              catch (e) { alert(e.message || "Décision impossible."); }
            } }, libelle));
          }
        } else actions.append(h("span", { class: "note" }, `Décision : ${a.motifValidation || "—"}`));
        corps.append(h("tr", {}, h("td", {}, a.agent), h("td", {}, a.service), h("td", {}, `${a.debut} → ${a.fin}`), h("td", {}, a.categorie), h("td", {}, statutLibelle[a.statut] || a.statut), h("td", {}, a.note || "—"), h("td", {}, actions)));
      }
      if (!corps.childElementCount) corps.append(h("tr", {}, h("td", { colspan: "7" }, "Aucune absence enregistrée.")));
      const table = h("table", {}); table.append(h("thead", {}, h("tr", {}, ...["Agent", "Service", "Période", "Catégorie", "Statut", "Note", "Action"].map((t) => h("th", {}, t)))), corps);
      liste.replaceChildren(table);
    } catch (e) { liste.replaceChildren(h("p", { class: "etat ko", role: "alert" }, e.message || "Chargement du registre impossible.")); }
  }
}

// ---------- Rapports ----------
function vueRapports() {
  const sortie = h("div"); let courant = { type: "jour", date: aujourdhui() };
  const telecharger = async (format) => {
    const r = await api("/api/rapports", { q: { ...courant, format }, brut: true });
    if (!r.ok) { alert("Export refusé."); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = h("a", { href: url, download: (r.headers.get("Content-Disposition") || "").match(/filename="(.+)"/)?.[1] || "rapport.csv" });
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const charger = async (type, date) => {
    courant = { type, date }; vider(sortie);
    try {
      const r = await api("/api/rapports", { q: courant });
      sortie.append(h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => telecharger("csv") }, "Exporter les pointages (CSV)"),
        h("button", { type: "button", class: "secondaire", onclick: () => telecharger("synthese-csv") }, "Exporter la synthèse (CSV)")),
        h("h2", {}, `Pointages · ${r.periode.libelle}`), r.lignes.length ? tableau(COLONNES_LIGNES, r.lignes) : h("p", {}, "Aucun poste sur cette période."),
        h("p", { class: "note" }, r.notes.join(" ")));
    } catch (e) { sortie.append(h("p", { class: "etat ko", role: "alert" }, e.message)); }
  };
  const p = selecteurPeriode(charger);
  racine.append(h("h1", {}, "Rapports"), p.bloc, sortie); charger("jour", aujourdhui());
}

// ---------- QR de pointage (administrateur et responsables) ----------
/** Affiche A4 d'une zone : QR permanent + marche à suivre. Le QR encode un lien (le téléphone l'ouvre directement dans l'application). */
function afficheQrPermanent({ zone, service, lien, base, test = false }) {
  const svg = window.FannQRCode.toSvg(lien, { margin: 4, errorCorrectionLevel: "Q" });
  return h("section", { class: test ? "affiche-qr affiche-qr-test" : "affiche-qr", "aria-label": `Affiche QR de pointage ${service || zone}${test ? " (TEST)" : ""}` },
    test ? h("p", { class: "affiche-filigrane-test", role: "note" }, "TEST — NE PAS AFFICHER") : null,
    h("div", { class: "affiche-entete" },
      h("img", { src: "/icons/logo-chnuf.png", alt: "", width: "72", height: "72" }),
      h("div", {}, h("strong", {}, "CHNUF · FANN POINTAGE"), h("small", {}, "Pointage des brancardiers"))),
    h("p", { class: "affiche-surtitre" }, "Je pointe mon arrivée et mon départ"),
    h("h2", { class: "affiche-service" }, service || zone),
    service && zone && zone !== service ? h("p", { class: "affiche-zone" }, zone) : null,
    h("img", { class: "affiche-qr-image", alt: `QR de pointage ${service || zone}`, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }),
    h("ol", { class: "affiche-etapes" },
      h("li", {}, "Ouvrez l’appareil photo de votre téléphone et scannez ce QR."),
      h("li", {}, "Connectez-vous à FANN POINTAGE avec votre compte personnel."),
      h("li", {}, "Autorisez la localisation et attendez la confirmation à l’écran.")),
    h("p", { class: "affiche-pied" }, test ? `TEST — NE PAS AFFICHER — adresse non définitive : ${base}` : `Affiche permanente — ne pas modifier ni déplacer hors de l’hôpital. ${base.replace(/^https?:\/\//, "")}`));
}

async function vueQr() {
  const sortie = h("div", { "aria-live": "polite" });
  const choix = h("select", { id: "zone", required: true });
  const origineSauvee = localStorage.getItem("fann-pointage-origine-publique") || location.origin;
  const origine = h("input", { id: "origine-publique-qr", type: "url", value: origineSauvee, placeholder: "https://votre-adresse-publique.example", autocomplete: "url" });
  const aideOrigine = h("p", { class: "note" }, "Pour scanner avec un autre appareil, indiquez une adresse accessible depuis cet appareil. N'utilisez pas localhost si le téléphone doit ouvrir le QR. Si vous avez ouvert FANN POINTAGE via ngrok, cette adresse est normalement déjà renseignée.");
  const genererBtn = h("button", { type: "button", class: "secondaire" }, "Mettre à jour l'adresse et le QR");
  let zones = [];

  // La création/édition d'une zone modifie le périmètre autorisé au pointage : formulaire uniquement administrateur.
  let formZone = null;
  let serviceZone = null;
  let nomZone = null, latZone = null, lngZone = null, rayonZone = null, precisionZone = null;
  const resultatZone = h("div", { "aria-live": "polite" });
  if (moi.role === "administrateur") {
    serviceZone = h("select", { id: "zone-service", required: true }, h("option", { value: "", selected: true, disabled: true }, "Choisir un service…"));
    for (const s of (Array.isArray(moi.services) ? moi.services : [])) {
      if (s && s.id && s.nom) serviceZone.append(h("option", { value: s.id }, s.nom));
    }
    nomZone = h("input", { id: "zone-nom", required: true, maxlength: "100", placeholder: "Ex. : Entrée principale CHNU Fann" });
    latZone = h("input", { id: "zone-latitude", type: "number", required: true, min: "-90", max: "90", step: "any", placeholder: "Ex. : 14.69" });
    lngZone = h("input", { id: "zone-longitude", type: "number", required: true, min: "-180", max: "180", step: "any", placeholder: "Ex. : -17.47" });
    rayonZone = h("input", { id: "zone-rayon", type: "number", required: true, min: "20", max: "5000", step: "1", value: "150" });
    precisionZone = h("input", { id: "zone-precision", type: "number", required: true, min: "10", max: "1000", step: "1", value: "50" });
    const creerZoneBtn = h("button", { type: "submit" }, "Enregistrer la zone");
    formZone = h("form", { class: "carte form-zone-pointage", onsubmit: async (ev) => {
      ev.preventDefault(); vider(resultatZone); creerZoneBtn.disabled = true;
      try {
        if (!latZone.value.trim() || !lngZone.value.trim()) throw new Error("Saisissez la latitude et la longitude exactes de l'établissement.");
        const r = await api("/api/zones", { methode: "POST", corps: {
          nom: nomZone.value.trim(), serviceId: serviceZone.value,
          latitude: Number(latZone.value), longitude: Number(lngZone.value),
          rayonM: Number(rayonZone.value), precisionMaxM: Number(precisionZone.value),
        } });
        resultatZone.append(h("p", { class: "etat ok", role: "status" }, r.message || "Zone enregistrée dans PostgreSQL."));
        nomZone.value = ""; latZone.value = ""; lngZone.value = "";
        await chargerZones(r.zone?.id || "");
        if (choix.value) await generer();
      } catch (e) {
        resultatZone.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Impossible d'enregistrer la zone."));
      } finally { creerZoneBtn.disabled = false; }
    } },
      h("h2", {}, "Configurer une zone de pointage"),
      h("p", { class: "note" }, "Les coordonnées déterminent le périmètre géographique accepté. Saisissez les coordonnées validées du site, pas une valeur approximative ; la création est réservée à l'administrateur."),
      h("div", { class: "form-zone-grille" },
        h("div", {}, h("label", { for: "zone-nom" }, "Nom de la zone"), nomZone),
        h("div", {}, h("label", { for: "zone-service" }, "Service associé"), serviceZone),
        h("div", {}, h("label", { for: "zone-latitude" }, "Latitude"), latZone),
        h("div", {}, h("label", { for: "zone-longitude" }, "Longitude"), lngZone),
        h("div", {}, h("label", { for: "zone-rayon" }, "Rayon accepté (mètres)"), rayonZone),
        h("div", {}, h("label", { for: "zone-precision" }, "Précision GPS maximale (mètres)"), precisionZone)),
      h("div", { class: "actions" }, creerZoneBtn), resultatZone);
  }

  // ----- Affiches QR permanentes (une par zone, à imprimer et afficher pendant des mois) -----
  const choixServiceAffiches = h("select", { id: "service-affiches" });
  const sortieAffiches = h("div", { class: "impression-badges-recto-verso apercu-impression", "aria-live": "polite" });
  const btnAffiches = h("button", { type: "button" }, "Préparer les affiches QR permanentes");
  const confirmationInterne = h("input", { type: "checkbox", id: "confirmation-origine-interne" });
  const blocConfirmationInterne = h("label", { class: "note", for: "confirmation-origine-interne" }, confirmationInterne, " Si l’adresse est une adresse du réseau interne (IP privée, .local) : je confirme qu’elle est fixe, en https, et que le certificat racine est installé sur tous les téléphones.");
  const remplirServicesAffiches = () => {
    vider(choixServiceAffiches);
    const services = new Map(zones.map((z) => [z.serviceId, z.service || z.serviceId]));
    if (services.size > 1) choixServiceAffiches.append(h("option", { value: "" }, "Tous les services"));
    for (const [id, nom] of services) choixServiceAffiches.append(h("option", { value: id }, nom));
  };
  btnAffiches.addEventListener("click", async () => {
    vider(sortieAffiches);
    // Garde-fou (audit v31, F-01) : une affiche permanente ne doit jamais encoder une adresse inutilisable depuis les téléphones.
    const evaluation = evaluerOrigineQr(origine.value);
    if (evaluation.niveau === "invalide") { sortieAffiches.append(h("p", { class: "etat ko", role: "alert" }, "Saisissez d’abord l’adresse définitive de l’application (URL complète en https) dans « Adresse à encoder dans le QR ».")); return; }
    const base = evaluation.base;
    const modeTest = evaluation.niveau === "test";
    if (evaluation.niveau === "interne" && !confirmationInterne.checked) {
      sortieAffiches.append(h("p", { class: "etat ko", role: "alert" }, `L’adresse « ${base} » est une adresse du réseau interne. Cochez la confirmation ci-dessus (adresse fixe, certificat installé sur les téléphones) pour préparer des affiches définitives.`)); return;
    }
    if (!window.FannQRCode || typeof window.FannQRCode.toSvg !== "function") { sortieAffiches.append(h("p", { class: "etat ko", role: "alert" }, "Le module QR local n’est pas chargé. Actualisez la page.")); return; }
    const retenues = zones.filter((z) => !choixServiceAffiches.value || z.serviceId === choixServiceAffiches.value);
    if (!retenues.length) { sortieAffiches.append(h("p", { class: "etat ko", role: "alert" }, "Aucune zone de pointage dans ce périmètre.")); return; }
    btnAffiches.disabled = true;
    try {
      const affiches = [];
      for (const z of retenues) {
        const q = await api("/api/qr", { q: { zoneId: z.id, permanent: "1" } });
        affiches.push(afficheQrPermanent({ zone: z.nom, service: z.service || "", lien: `${base}/#/pointage?qr=${encodeURIComponent(q.token)}`, base, test: modeTest }));
      }
      if (modeTest) sortieAffiches.append(h("p", { class: "etat ko hors-impression", role: "alert" }, `Mode TEST — affiches non définitives : ${evaluation.raisons.join(" ; ")}. Les affiches générées portent la mention « TEST — NE PAS AFFICHER ». Pour des affiches de production, utilisez l’adresse définitive (domaine fixe en https).`));
      else if (evaluation.niveau === "interne") sortieAffiches.append(h("p", { class: "etat hors-impression", role: "note" }, `Adresse du réseau interne confirmée : ${base}. Conservez ce serveur sur une IP fixe et gardez le certificat racine installé sur tous les téléphones.`));
      sortieAffiches.append(h("div", { class: "apercu-impression-actions" },
        h("h2", {}, `Aperçu : ${affiches.length} affiche(s)`),
        h("div", { class: "actions" },
          h("button", { type: "button", onclick: () => { if (!ouvrirPageImpression("Affiches QR de pointage", sortieAffiches)) window.print(); } }, modeTest ? "Imprimer / PDF (TEST)" : "Imprimer / PDF"))),
        ...affiches);
    } catch (e) { sortieAffiches.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Impossible de préparer les affiches.")); }
    finally { btnAffiches.disabled = false; }
  });

  racine.append(h("h1", {}, "QR de pointage"),
    formZone,
    h("div", { class: "carte" }, h("label", { for: "zone" }, "Zone de pointage"), choix),
    h("div", { class: "carte" }, h("label", { for: "origine-publique-qr" }, "Adresse à encoder dans le QR"), origine, aideOrigine, genererBtn), sortie,
    h("section", { class: "carte" },
      h("h2", {}, "Affiches QR permanentes par service"),
      h("p", { class: "note" }, "Ces QR n’expirent pas : imprimez-les une fois et affichez-les pendant des mois. Chaque affiche est liée à une zone ; l’agent doit toujours être connecté et sa position GPS est vérifiée à chaque pointage. Le QR contient l’adresse saisie ci-dessus : utilisez l’adresse définitive (un domaine fixe, pas une adresse de test temporaire) sinon les affiches cesseront de fonctionner. Pour révoquer une affiche (perte, vol), désactivez la zone (section « Zones de pointage » ci-dessus)."),
      h("label", { for: "service-affiches" }, "Service"), choixServiceAffiches,
      blocConfirmationInterne,
      h("div", { class: "actions" }, btnAffiches), sortieAffiches));

  // Audit v31 F-05 : révocation d'une affiche perdue/volée = désactivation de sa zone (administrateur, motif obligatoire, journalisé).
  if (moi.role === "administrateur") {
    const motifZone = h("input", { id: "motif-zone", maxlength: "300", placeholder: "Motif (obligatoire) : ex. affiche volée dans le couloir B" });
    const listeGestionZones = h("div", { "aria-live": "polite" });
    const retourGestionZones = h("div", { "aria-live": "polite" });
    const afficherGestionZones = async () => {
      vider(listeGestionZones);
      try {
        const r = await api("/api/zones", { q: { inclureInactives: "1" } });
        const toutes = Array.isArray(r.zones) ? r.zones : [];
        if (!toutes.length) { listeGestionZones.append(h("p", { class: "note" }, "Aucune zone enregistrée.")); return; }
        for (const z of toutes) {
          const bouton = h("button", { type: "button", class: z.actif ? "danger" : "secondaire" }, z.actif ? "Désactiver (révoquer les affiches)" : "Réactiver");
          bouton.addEventListener("click", async () => {
            vider(retourGestionZones);
            const motif = motifZone.value.trim();
            if (motif.length < 3) { retourGestionZones.append(h("p", { class: "etat ko", role: "alert" }, "Saisissez d’abord un motif (3 caractères minimum).")); motifZone.focus(); return; }
            if (z.actif && !window.confirm(`Désactiver la zone « ${z.nom} » ? Toutes ses affiches QR cesseront de fonctionner immédiatement.`)) return;
            bouton.disabled = true;
            try {
              const rep = await api(`/api/zones/${encodeURIComponent(z.id)}`, { methode: "PATCH", corps: { actif: !z.actif, motif } });
              retourGestionZones.append(h("p", { class: "etat ok", role: "status" }, rep.message || "Zone mise à jour."));
              motifZone.value = "";
              await chargerZones(); await afficherGestionZones();
            } catch (e) { retourGestionZones.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Impossible de modifier la zone.")); bouton.disabled = false; }
          });
          listeGestionZones.append(h("div", { class: "ligne-zone" },
            h("span", {}, `${z.nom} · ${z.service || ""} — `, h("strong", {}, z.actif ? "active" : "DÉSACTIVÉE")), " ", bouton));
        }
      } catch (e) { listeGestionZones.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Impossible de charger les zones.")); }
    };
    racine.append(h("section", { class: "carte" },
      h("h2", {}, "Zones de pointage — désactivation / réactivation"),
      h("p", { class: "note" }, "Une zone désactivée refuse tout pointage : toutes ses affiches QR sont révoquées. Pour remplacer une affiche perdue, désactivez la zone puis créez-en une nouvelle (ou réactivez-la après avoir récupéré l’affiche). Chaque action est journalisée."),
      h("label", { for: "motif-zone" }, "Motif"), motifZone, retourGestionZones, listeGestionZones));
    void afficherGestionZones();
  }

  async function chargerZones(selection = "") {
    const r = await api("/api/zones");
    zones = Array.isArray(r.zones) ? r.zones : [];
    vider(choix);
    if (!zones.length) {
      choix.append(h("option", { value: "", selected: true, disabled: true }, "Aucune zone active — créez-en une"));
      return;
    }
    choix.append(h("option", { value: "", selected: !selection, disabled: true }, "Sélectionner une zone…"));
    for (const z of zones) choix.append(h("option", { value: z.id, selected: z.id === selection }, `${z.nom} · ${z.service}`));
  }

  const generer = async () => {
    if (!choix.value) {
      vider(sortie);
      sortie.append(h("p", { class: "note" }, moi.role === "administrateur"
        ? "Créez une zone avec des coordonnées vérifiées, puis sélectionnez-la pour émettre un QR dynamique."
        : "Aucune zone de pointage n'est configurée pour votre périmètre. Contactez l'administrateur."));
      return;
    }
    let base;
    try {
      const url = new URL(origine.value.trim());
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Adresse invalide. Saisissez une URL complète en HTTPS (recommandé) ou HTTP sur un réseau local de confiance.");
      base = url.origin;
      localStorage.setItem("fann-pointage-origine-publique", base);
      origine.value = base;
    } catch (e) {
      vider(sortie); sortie.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Adresse publique invalide."));
      return;
    }
    try {
      const q = await api("/api/qr", { q: { zoneId: choix.value } });
      const lien = `${base}/#/pointage?qr=${encodeURIComponent(q.token)}`;
      if (!window.FannQRCode || typeof window.FannQRCode.toSvg !== "function") throw new Error("Le module QR local n'est pas chargé. Actualisez la page.");
      const svg = window.FannQRCode.toSvg(lien, { margin: 4, errorCorrectionLevel: "M" });
      const image = h("img", { class: "qr-image", alt: "QR code dynamique de pointage", width: "320", height: "320", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
      vider(sortie);
      sortie.append(h("div", { class: "carte qr-carte" }, image,
        h("p", {}, `QR valable jusqu'à ${new Date(q.expireLe).toLocaleTimeString("fr-FR", { timeZone: "Africa/Dakar" })}. Il est renouvelé automatiquement toutes les 45 secondes.`),
        h("p", { class: "note" }, "Le QR contient un lien de pointage, contrairement aux badges imprimés qui contiennent un code FANN-BADGE à lire dans la page Poste partagé."),
        h("p", { class: "note" }, "Lien de secours à copier :"), h("code", { class: "jeton" }, lien),
        h("button", { type: "button", class: "secondaire", onclick: async () => { try { await navigator.clipboard.writeText(lien); alert("Lien copié."); } catch { alert("Copie non autorisée par ce navigateur ; sélectionnez le lien manuellement."); } } }, "Copier le lien")));
    } catch (e) { vider(sortie); sortie.append(h("p", { class: "etat ko", role: "alert" }, e.message)); }
  };
  choix.addEventListener("change", generer);
  genererBtn.addEventListener("click", generer);
  origine.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void generer(); } });
  await chargerZones(); remplirServicesAffiches();
  void generer(); minuteur = setInterval(generer, 45000);
}

// ---------- Feuilles d'émargement hebdomadaires par service (format du registre papier) ----------
const CLE_IMPRESSION = "fann-impression";

// L'impression passe par une page dédiée (/imprimer.html) : sur téléphone ou application installée, window.print() sur la vue
// courante ne réagit pas toujours, alors qu'une page ordinaire propose « Imprimer / Enregistrer en PDF » de façon fiable.
function ouvrirPageImpression(titre, noeud) {
  const enregistrer = (n) => { localStorage.setItem(CLE_IMPRESSION, JSON.stringify({ titre, xml: new XMLSerializer().serializeToString(n), le: Date.now() })); };
  try { enregistrer(noeud); }
  catch {
    // Stockage plein (photos des badges en data: URL, surtout sur iPhone) : on retente sans les photos plutôt que de rester muet.
    try {
      try { localStorage.removeItem(CLE_IMPRESSION); } catch { /* ignoré */ }
      const copie = noeud.cloneNode(true);
      for (const img of copie.querySelectorAll("img")) { if ((img.getAttribute("src") || "").startsWith("data:")) img.remove(); }
      enregistrer(copie);
      alert("Mémoire du téléphone insuffisante : les photos ont été retirées de l'aperçu d'impression. Imprimez depuis un ordinateur pour avoir les photos.");
    } catch {
      alert("Impossible de préparer l'impression sur cet appareil (stockage du navigateur indisponible ou plein). Essayez avec moins de badges, ou depuis un ordinateur.");
      return true; // message déjà affiché : ne pas enchaîner sur un window.print() muet
    }
  }
  const fenetre = window.open("/imprimer.html", "_blank");
  if (!fenetre) location.href = "/imprimer.html";
  return true;
}


// ---------- Administration du planning et calendrier civil ----------
function dateDakar(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dakar", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function datePlusJours(yyyyMMdd, nb) {
  const d = new Date(`${yyyyMMdd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + nb); return d.toISOString().slice(0, 10);
}
function afficherDateHeureDakar(value) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Dakar", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
async function vuePlanning() {
  const racinePlanning = racine;
  const debutParDefaut = dateDakar();
  const finParDefaut = datePlusJours(debutParDefaut, 30);
  const agent = h("select", { id: "planning-agent", required: true }, h("option", { value: "", selected: true, disabled: true }, "Sélectionner un agent…"));
  const debut = h("input", { id: "planning-debut", type: "date", required: true, value: debutParDefaut });
  const fin = h("input", { id: "planning-fin", type: "date", required: true, value: finParDefaut });
  const equipe = h("select", { id: "planning-equipe" }, h("option", { value: "jour" }, "Équipe de jour · 08 h–20 h"), h("option", { value: "nuit" }, "Équipe de nuit · 20 h–08 h"));
  const blocEquipe = h("div", {}, h("label", { for: "planning-equipe" }, "Équipe des urgences"), equipe);
  const equipeMobil = h("select", { id: "planning-equipe-mobil" }, h("option", { value: "jour" }, "Équipe de jour · 08 h–16 h"), h("option", { value: "nuit" }, "Équipe de garde · semaine 16 h–08 h / week-end et férié 08 h–08 h"));
  const groupeNuitMobil = h("select", { id: "planning-groupe-mobil" }, h("option", { value: "A" }, "Groupe A · première garde le jour de début"), h("option", { value: "B" }, "Groupe B · première garde le lendemain"), h("option", { value: "C" }, "Groupe C · première garde à J+2"));
  const blocGroupeMobil = h("div", {}, h("label", { for: "planning-groupe-mobil" }, "Rotation nocturne"), groupeNuitMobil);
  const inclureWeekEndsMobil = h("input", { id: "planning-mobil-weekends", type: "checkbox" });
  const inclureJoursFeriesMobil = h("input", { id: "planning-mobil-feries", type: "checkbox" });
  const blocExceptionsMobil = h("div", { class: "note" },
    h("label", {}, inclureWeekEndsMobil, " Exception autorisée : inclure le samedi et le dimanche"),
    h("label", {}, inclureJoursFeriesMobil, " Exception autorisée : inclure les jours fériés"));
  const blocMobil = h("div", { class: "form-creation-badge" },
    h("label", { for: "planning-equipe-mobil" }, "Équipe Mobil"), equipeMobil, blocGroupeMobil, blocExceptionsMobil);
  const afficherOptionsMobil = () => { blocGroupeMobil.hidden = equipeMobil.value !== "nuit"; blocExceptionsMobil.hidden = equipeMobil.value !== "jour"; };
  equipeMobil.addEventListener("change", afficherOptionsMobil); afficherOptionsMobil();
  // Service général : heure de fin réglable (10 h à 16 h) pour les services qui terminent avant 16 h ; le départ doit alors être pointé avant cette heure.
  const heureFinGeneral = h("select", { id: "planning-heure-fin" }, ...[16, 15, 14, 13, 12, 11, 10].map((hh) => h("option", { value: String(hh) }, hh === 16 ? "16 h (horaire standard)" : `${hh} h (service qui termine plus tôt)`)));
  const blocHeureFin = h("div", {}, h("label", { for: "planning-heure-fin" }, "Heure de fin du service général"), heureFinGeneral);
  const afficherHeureFin = () => { blocHeureFin.hidden = agent.options[agent.selectedIndex]?.dataset.regime !== "general"; };
  agent.addEventListener("change", afficherHeureFin); afficherHeureFin();
  const statutPlanning = h("div", { role: "status", "aria-live": "polite" });
  const listePlanning = h("div", { class: "tableau-responsive" });
  const listeFeries = h("div", { class: "tableau-responsive" });
  const formPlanning = h("form", { class: "carte form-creation-badge", onsubmit: async (ev) => {
    ev.preventDefault(); vider(statutPlanning);
    try {
      const a = agent.options[agent.selectedIndex];
      const estMobil = a?.dataset.regime === "mobil";
      const reponse = await api("/api/plannings", { methode: "POST", corps: {
        agentId: agent.value, dateDebut: debut.value, dateFin: fin.value,
        equipeUrgences: a?.dataset.regime === "urgences" ? equipe.value : undefined,
        equipeMobil: estMobil ? equipeMobil.value : undefined,
        heureFin: a?.dataset.regime === "general" ? Number(heureFinGeneral.value) : undefined,
        groupeNuitMobil: estMobil && equipeMobil.value === "nuit" ? groupeNuitMobil.value : undefined,
        inclureWeekEndsMobil: estMobil && equipeMobil.value === "jour" && inclureWeekEndsMobil.checked,
        inclureJoursFeriesMobil: estMobil && equipeMobil.value === "jour" && inclureJoursFeriesMobil.checked,
      } });
      statutPlanning.append(h("p", { class: "etat ok" }, reponse.message || `${reponse.nombrePostes} poste(s) généré(s).`));
      await rechargerPlanning();
    } catch (e) { statutPlanning.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Création du planning impossible.")); }
  } },
    h("h2", {}, "Générer un planning"),
    h("p", { class: "note" }, "Le logiciel applique le régime de la fiche agent. Mobil jour : 08 h–16 h du lundi au vendredi, sans samedi ni dimanche (les jours fériés enregistrés sont exclus sauf exception autorisée). Mobil garde : 16 h–08 h les jours ouvrés non fériés ; 08 h–08 h (24 h) si la date de garde tombe un samedi, un dimanche ou un jour férié. Après chaque garde, le repos obligatoire est d’au moins 56 h, calculé depuis la fin du poste. Les groupes A, B et C décalent la première date de garde. Les règles des autres régimes restent inchangées."),
    h("div", { class: "form-badge-grille" },
      h("div", {}, h("label", { for: "planning-agent" }, "Agent"), agent),
      h("div", {}, h("label", { for: "planning-debut" }, "Début de période"), debut),
      h("div", {}, h("label", { for: "planning-fin" }, "Fin de période"), fin),
      blocEquipe, blocMobil, blocHeureFin),
    h("button", { type: "submit" }, "Générer et enregistrer le planning"), statutPlanning);
  const formFerie = h("form", { class: "carte form-creation-badge", onsubmit: async (ev) => {
    ev.preventDefault();
    const ferDate = inputDateFerie.value, nom = inputNomFerie.value.trim(), note = inputNoteFerie.value.trim();
    try {
      await api("/api/jours-feries", { methode: "POST", corps: { date: ferDate, nom, note } });
      inputNomFerie.value = ""; inputNoteFerie.value = "";
      await rechargerFeries(); await rechargerPlanning();
    } catch (e) { statutFerie.replaceChildren(h("p", { class: "etat ko", role: "alert" }, e.message || "Ajout impossible.")); }
  } }, h("h2", {}, "Ajouter un jour férié"));
  const inputDateFerie = h("input", { id: "jour-ferie-date", type: "date", value: debutParDefaut, required: true });
  const inputNomFerie = h("input", { id: "jour-ferie-nom", maxlength: "120", placeholder: "Ex. : Fête nationale", required: true });
  const inputNoteFerie = h("input", { id: "jour-ferie-note", maxlength: "300", placeholder: "Note facultative" });
  const statutFerie = h("div", { role: "status", "aria-live": "polite" });
  if (moi?.role === "administrateur") formFerie.append(h("div", { class: "form-badge-grille" },
    h("div", {}, h("label", { for: "jour-ferie-date" }, "Date"), inputDateFerie),
    h("div", {}, h("label", { for: "jour-ferie-nom" }, "Nom"), inputNomFerie),
    h("div", {}, h("label", { for: "jour-ferie-note" }, "Note"), inputNoteFerie)),
    h("button", { type: "submit" }, "Enregistrer le jour férié"), statutFerie);
  else formFerie.append(h("p", { class: "note" }, "La consultation du calendrier est autorisée. Seul l’administrateur peut ajouter ou supprimer une date fériée."));
  racinePlanning.append(h("h1", {}, "Planning et calendrier des jours fériés"), formPlanning,
    h("section", { class: "carte" }, h("h2", {}, "Postes programmés"),
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => void rechargerPlanning() }, "Actualiser la liste")), listePlanning),
    formFerie, h("section", { class: "carte" }, h("h2", {}, "Calendrier des jours fériés enregistrés"),
      h("p", { class: "note" }, "Aucun calendrier officiel n’est prérempli : faites saisir et vérifier les dates par l’administration. Le service général n’est pas planifié pendant les dates déclarées fériées."), listeFeries));
  let tousAgents = [];
  try {
    const resultats = await Promise.all([api("/api/agents"), api("/api/jours-feries")]);
    tousAgents = resultats[0].agents || [];
    for (const a of tousAgents) agent.append(h("option", { value: a.id, "data-regime": a.regime }, `${a.prenom} ${a.nom} · ${a.service} · ${a.regime === "general" ? "Service général" : a.regime === "garde" ? "Garde 24 h" : a.regime === "mobil" ? "Mobil" : "Urgences"}`));
    const afficherEquipes = () => { const reg = agent.options[agent.selectedIndex]?.dataset.regime; blocEquipe.hidden = reg !== "urgences"; blocMobil.hidden = reg !== "mobil"; };
    agent.addEventListener("change", afficherEquipes);
    afficherEquipes();
    void rechargerFeries(resultats[1].joursFeries || []);
    await rechargerPlanning();
  } catch (e) {
    listePlanning.replaceChildren(h("p", { class: "etat ko", role: "alert" }, e.message || "Chargement du planning impossible."));
  }

  debut.addEventListener("change", () => void rechargerPlanning());
  fin.addEventListener("change", () => void rechargerPlanning());
  async function rechargerPlanning() {
    try {
      const result = await api("/api/plannings", { q: { debut: debut.value, fin: fin.value } });
      const table = h("table", {});
      table.append(h("thead", {}, h("tr", {}, ...["Date et heure", "Agent", "Service", "Poste", "Fin", "Repos / reprise théorique", "Gestion"].map((x) => h("th", {}, x)))));
      const corps = h("tbody", {});
      for (const p of result.plannings || []) {
        const action = p.modifiable ? h("div", { class: "actions-compte" },
          h("button", { type: "button", class: "secondaire", onclick: async () => {
            const debutNouveau = prompt("Nouveau début au format ISO 8601 UTC (ex. 2026-10-15T08:00:00Z) :", p.debut);
            if (debutNouveau === null) return;
            const finNouveau = prompt("Nouvelle fin au format ISO 8601 UTC :", p.fin);
            if (finNouveau === null) return;
            const motif = prompt("Motif de la modification (obligatoire) :");
            if (!motif || motif.trim().length < 4) { alert("Un motif d’au moins 4 caractères est obligatoire."); return; }
            try { await api(`/api/plannings/${encodeURIComponent(p.planningId)}`, { methode: "PATCH", corps: { debut: debutNouveau.trim(), fin: finNouveau.trim(), motif } }); await rechargerPlanning(); }
            catch (e) { alert(e.message || "Modification impossible."); }
          } }, "Modifier avec motif"),
          h("button", { type: "button", class: "secondaire", onclick: async () => {
            if (!confirm(`Supprimer ce poste de ${p.agent} le ${afficherDateHeureDakar(p.debut)} ? Cette action est refusée si des pointages sont liés.`)) return;
            try { await api(`/api/plannings/${encodeURIComponent(p.planningId)}`, { methode: "DELETE" }); await rechargerPlanning(); }
            catch (e) { alert(e.message || "Suppression impossible."); }
          } }, "Supprimer")) : h("span", { class: "note" }, "Poste démarré ou passé · consultation seule");
        const libellePoste = p.regime === "mobil" ? (p.type === "nuit" ? (new Date(p.fin).getTime() - new Date(p.debut).getTime() >= 24 * 3600_000 ? "Mobil garde · 08 h–08 h (24 h)" : "Mobil garde · 16 h–08 h") : "Mobil jour · 08 h–16 h") : p.type === "service" ? "Service général" : p.type === "garde" ? "Garde 24 h" : p.type === "jour" ? "Urgences jour" : "Urgences nuit";
        const reprise = p.regime === "mobil" && p.type === "nuit" ? afficherDateHeureDakar(new Date(new Date(p.fin).getTime() + 56 * 3600_000).toISOString()) : "—";
        corps.append(h("tr", {}, h("td", {}, afficherDateHeureDakar(p.debut)), h("td", {}, p.agent || "Agent inconnu"), h("td", {}, p.service || "—"), h("td", {}, libellePoste), h("td", {}, afficherDateHeureDakar(p.fin)), h("td", {}, reprise), h("td", {}, action)));
      }
      if (!corps.childElementCount) corps.append(h("tr", {}, h("td", { colspan: "7" }, "Aucun poste programmé sur cette période.")));
      table.append(corps); listePlanning.replaceChildren(table);
    } catch (e) { listePlanning.replaceChildren(h("p", { class: "etat ko", role: "alert" }, e.message || "Chargement du planning impossible.")); }
  }
  async function rechargerFeries(valeurs) {
    try {
      const feries = valeurs || (await api("/api/jours-feries")).joursFeries || [];
      const table = h("table", {}); table.append(h("thead", {}, h("tr", {}, ...["Date", "Motif", "Note", "Action"].map((x) => h("th", {}, x)))));
      const corps = h("tbody", {});
      for (const f of feries) {
        const action = moi?.role === "administrateur" ? h("button", { type: "button", class: "secondaire", onclick: async () => {
          if (!confirm(`Retirer « ${f.nom} » du calendrier ? Cette action ne recréera pas automatiquement les postes supprimés ; vérifiez/regénérez le planning ensuite.`)) return;
          try { await api(`/api/jours-feries/${f.date}`, { methode: "DELETE" }); await rechargerFeries(); }
          catch (e) { alert(e.message || "Suppression impossible."); }
        } }, "Supprimer") : "—";
        corps.append(h("tr", {}, h("td", {}, f.date), h("td", {}, f.nom), h("td", {}, f.note || "—"), h("td", {}, action)));
      }
      if (!corps.childElementCount) corps.append(h("tr", {}, h("td", { colspan: "4" }, "Aucun jour férié saisi.")));
      table.append(corps); listeFeries.replaceChildren(table);
    } catch (e) { listeFeries.replaceChildren(h("p", { class: "etat ko", role: "alert" }, e.message || "Chargement du calendrier impossible.")); }
  }
}

// ---------- Registre réel PostgreSQL : gestion des agents et des services ----------
async function vueCatalogue() {
  const statut = h("div", { role: "status", "aria-live": "polite" });
  const statutAgent = h("div", { role: "status", "aria-live": "polite" });
  const statutService = h("div", { role: "status", "aria-live": "polite" });
  const recherche = h("input", { id: "catalogue-recherche", type: "search", placeholder: "Rechercher un agent ou un service…", autocomplete: "off" });
  const prenom = h("input", { id: "catalogue-prenom", maxlength: "80", autocomplete: "given-name", required: true });
  const nom = h("input", { id: "catalogue-nom", maxlength: "80", autocomplete: "family-name", required: true });
  const matricule = h("input", { id: "catalogue-matricule", maxlength: "40", placeholder: "Facultatif — ne pas l’inventer", autocomplete: "off" });
  const serviceAgent = h("select", { id: "catalogue-agent-service", required: true });
  const regimeAgent = h("select", { id: "catalogue-agent-regime", required: true, title: "Régime d’affectation : les horaires détaillés sont définis par le planning du service." },
    h("option", { value: "general", title: "Service général : 08 h–16 h, du lundi au vendredi." }, "Général · 08–16 h (lun.–ven.)"),
    h("option", { value: "garde", title: "Garde : 24 h de service suivies de 48 h de repos." }, "Garde · 24 h / 48 h repos"),
    h("option", { value: "urgences", title: "Urgences : horaires de jour ou de nuit selon le planning autonome." }, "Urgences · jour / nuit"),
    h("option", { value: "mobil", title: "Mobil : jour 08 h–16 h ; garde 16 h–08 h ou 08 h–08 h ; repos minimum de 56 h." }, "Mobil · jour / nuit"));
  const photoAgentInput = h("input", { id: "catalogue-agent-photo", type: "file", accept: "image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif", "aria-describedby": "catalogue-agent-photo-status" });
  const photoAgentStatus = h("p", { id: "catalogue-agent-photo-status", class: "note", role: "status" }, "Photo facultative. Choisissez une nouvelle photo pour remplacer celle du dossier.");
  const photoAgentPreview = h("img", { class: "miniature-photo-agent", alt: "Aperçu de la photo enregistrée pour cet agent", hidden: true });
  const enleverPhotoAgent = h("button", { type: "button", class: "secondaire", hidden: true }, "Retirer la photo actuelle");
  let photoAgentDataUrl = null;
  let photoAgentModifiee = false;
  let photoAgentInitiale = null;
  let revisionPhotoCatalogue = 0;
  photoAgentInput.addEventListener("change", async () => {
    const revision = ++revisionPhotoCatalogue;
    const fichier = photoAgentInput.files?.[0];
    if (!fichier) {
      photoAgentDataUrl = null; photoAgentModifiee = false;
      if (photoAgentInitiale) { photoAgentPreview.src = photoAgentInitiale; photoAgentPreview.hidden = false; photoAgentStatus.textContent = "Photo existante conservée. Choisissez une photo uniquement pour la remplacer."; }
      else { photoAgentPreview.hidden = true; photoAgentStatus.textContent = "Aucune photo choisie. La photo est facultative."; }
      enleverPhotoAgent.hidden = !photoAgentInitiale;
      return;
    }
    photoAgentStatus.className = "note"; photoAgentStatus.textContent = "Préparation et compression de la photo…";
    try {
      const data = await preparerPhotoBadge(fichier);
      if (revision !== revisionPhotoCatalogue) return;
      photoAgentDataUrl = data; photoAgentModifiee = true;
      photoAgentPreview.src = data; photoAgentPreview.hidden = false;
      photoAgentStatus.className = "note etat ok"; photoAgentStatus.textContent = `Nouvelle photo prête : ${fichier.name}. Elle sera enregistrée lors de la validation du formulaire.`;
      enleverPhotoAgent.hidden = false;
    } catch (err) {
      if (revision !== revisionPhotoCatalogue) return;
      photoAgentDataUrl = null; photoAgentModifiee = false;
      photoAgentStatus.className = "note etat ko"; photoAgentStatus.textContent = err.message || "Impossible de préparer cette photo.";
    }
  });
  enleverPhotoAgent.addEventListener("click", () => {
    ++revisionPhotoCatalogue; photoAgentInput.value = ""; photoAgentDataUrl = null; photoAgentModifiee = true; photoAgentInitiale = null;
    photoAgentPreview.hidden = true; photoAgentStatus.className = "note"; photoAgentStatus.textContent = "La photo sera supprimée lors de l’enregistrement."; enleverPhotoAgent.hidden = true;
  });
  const btnAgent = h("button", { type: "submit" }, "Ajouter l’agent");
  const annulerAgent = h("button", { type: "button", class: "secondaire", hidden: true }, "Annuler la modification");
  const formAgent = h("form", { class: "carte", onsubmit: async (ev) => {
    ev.preventDefault(); statutAgent.replaceChildren();
    try {
      const corps = { prenom: prenom.value.trim(), nom: nom.value.trim(), matricule: matricule.value.trim() || null, serviceId: serviceAgent.value, regime: regimeAgent.value };
      if (photoAgentModifiee) corps.photoDataUrl = photoAgentDataUrl;
      const url = idAgentEdite ? `/api/agents/${encodeURIComponent(idAgentEdite)}` : "/api/agents";
      const r = await api(url, { methode: idAgentEdite ? "PATCH" : "POST", corps });
      statutAgent.append(h("p", { class: "etat ok" }, r.message || "Fiche enregistrée."));
      reinitialiserAgent(); await charger();
    } catch (e) { statutAgent.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Enregistrement impossible.")); }
  } }, h("h2", {}, "Fiche agent"),
    h("p", { class: "note" }, "Les fiches et affectations sont enregistrées dans PostgreSQL. Les matricules restent vides tant qu’ils ne sont pas communiqués officiellement. Les régimes importés depuis la liste sont des propositions initiales à confirmer par l’administration."),
    h("div", { class: "form-badge-grille" },
      h("div", {}, h("label", { for: "catalogue-prenom" }, "Prénom(s)"), prenom),
      h("div", {}, h("label", { for: "catalogue-nom" }, "Nom"), nom),
      h("div", {}, h("label", { for: "catalogue-matricule" }, "Matricule"), matricule),
      h("div", {}, h("label", { for: "catalogue-agent-service" }, "Service"), serviceAgent),
      h("div", {}, h("label", { for: "catalogue-agent-regime" }, "Régime de l’affectation"), regimeAgent),
      h("div", { class: "champ-photo-badge" }, h("label", { for: "catalogue-agent-photo" }, "Photo de l’agent (facultative)"), photoAgentInput, photoAgentStatus, photoAgentPreview, enleverPhotoAgent)),
    h("div", { class: "actions" }, btnAgent, annulerAgent), statutAgent);

  const nomService = h("input", { id: "catalogue-service-nom", maxlength: "100", required: true });
  const regimeService = h("select", { id: "catalogue-service-regime", required: true, title: "Régime par défaut utilisé uniquement pour préremplir les nouvelles affectations." },
    h("option", { value: "general", title: "Service général : 08 h–16 h, du lundi au vendredi." }, "Général · 08–16 h (lun.–ven.)"),
    h("option", { value: "garde", title: "Garde : 24 h de service suivies de 48 h de repos." }, "Garde · 24 h / 48 h repos"),
    h("option", { value: "urgences", title: "Urgences : horaires de jour ou de nuit selon le planning autonome." }, "Urgences · jour / nuit"),
    h("option", { value: "mobil", title: "Mobil : équipe de jour ou équipe de nuit selon le planning du service." }, "Mobil · équipe jour / nuit"));
  const btnService = h("button", { type: "submit" }, "Ajouter le service");
  const annulerService = h("button", { type: "button", class: "secondaire", hidden: true }, "Annuler la modification");
  let idAgentEdite = null;
  let idServiceEdite = null;
  let agents = [];
  let services = [];
  const formService = h("form", { class: "carte", onsubmit: async (ev) => {
    ev.preventDefault(); statutService.replaceChildren();
    try {
      const corps = { nom: nomService.value.trim(), regimeDefaut: regimeService.value };
      const url = idServiceEdite ? `/api/services/${encodeURIComponent(idServiceEdite)}` : "/api/services";
      const r = await api(url, { methode: idServiceEdite ? "PATCH" : "POST", corps });
      statutService.append(h("p", { class: "etat ok" }, r.message || "Service enregistré."));
      reinitialiserService(); await charger();
    } catch (e) { statutService.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Enregistrement impossible.")); }
  } }, h("h2", {}, "Service"),
    h("p", { class: "note" }, "Le régime par défaut sert aux nouvelles affectations. Modifier ce régime ne réécrit pas l’historique des agents."),
    h("p", { class: "note" }, "Services mixtes (Pneumologie, Maladies infectieuses, ORL, Gériatrie, Neurologie/Hospitalisation, CTCV, Neurochirurgie et Cardiologie médicale) : choisissez le régime individuel de chaque agent, soit service général, soit garde. Le défaut du service sert uniquement à préremplir les nouvelles fiches."),
    h("div", { class: "form-badge-grille" },
      h("div", {}, h("label", { for: "catalogue-service-nom" }, "Nom du service"), nomService),
      h("div", {}, h("label", { for: "catalogue-service-regime" }, "Régime par défaut"), regimeService)),
    h("div", { class: "actions" }, btnService, annulerService), statutService);

  const agentsListe = h("div", { class: "tableau-responsive tableau-catalogue tableau-catalogue-agents" });
  const servicesListe = h("div", { class: "tableau-responsive tableau-catalogue tableau-catalogue-services" });
  const compteur = h("p", { class: "note", role: "status" }, "Chargement du registre réel…");
  racine.append(h("h1", {}, "Registre des agents et services"),
    h("p", { class: "note" }, "Source initiale : la liste papier des brancardiers du CHNU Fann fournie dans cette conversation. Aucun agent fictif n’est chargé dans ce mode. Les suppressions sont des archivages réversibles afin de préserver l’historique."),
    statut, compteur,
    h("div", { class: "catalogue-formulaires" }, formAgent, formService),
    h("section", { class: "carte" }, h("h2", {}, "Agents enregistrés"), h("label", { for: "catalogue-recherche" }, "Recherche"), recherche, agentsListe),
    h("section", { class: "carte" }, h("h2", {}, "Services enregistrés"), servicesListe));

  function reinitialiserAgent() {
    idAgentEdite = null; prenom.value = ""; nom.value = ""; matricule.value = ""; serviceAgent.value = ""; regimeAgent.value = "general";
    ++revisionPhotoCatalogue; photoAgentInput.value = ""; photoAgentDataUrl = null; photoAgentModifiee = false; photoAgentInitiale = null;
    photoAgentPreview.hidden = true; enleverPhotoAgent.hidden = true; photoAgentStatus.className = "note"; photoAgentStatus.textContent = "Photo facultative. Choisissez une nouvelle photo pour remplacer celle du dossier.";
    btnAgent.textContent = "Ajouter l’agent"; annulerAgent.hidden = true;
  }
  function reinitialiserService() {
    idServiceEdite = null; nomService.value = ""; regimeService.value = "general";
    btnService.textContent = "Ajouter le service"; annulerService.hidden = true;
  }
  annulerAgent.addEventListener("click", reinitialiserAgent);
  annulerService.addEventListener("click", reinitialiserService);
  function alimenterServices() {
    const choisi = serviceAgent.value;
    vider(serviceAgent);
    serviceAgent.append(h("option", { value: "", disabled: true, selected: true }, "Choisir un service actif…"));
    for (const s of services.filter((x) => x.actif)) serviceAgent.append(h("option", { value: s.id }, `${s.nom} · ${s.regimeDefaut === "general" ? "SG" : s.regimeDefaut === "garde" ? "Garde" : s.regimeDefaut === "mobil" ? "Mobil" : "Urgences"}`));
    if (services.some((s) => s.id === choisi && s.actif)) serviceAgent.value = choisi;
  }
  // Le régime par défaut du service préremplit les nouvelles fiches, sans écraser le régime d'un agent déjà enregistré.
  serviceAgent.addEventListener("change", () => {
    if (idAgentEdite) return;
    const service = services.find((s) => s.id === serviceAgent.value && s.actif);
    if (service) regimeAgent.value = service.regimeDefaut;
  });
  function afficherAgents() {
    const rechercheVal = recherche.value.trim().toLocaleLowerCase("fr");
    const visibles = agents.filter((a) => `${a.prenom} ${a.nom} ${a.service} ${a.matricule || ""}`.toLocaleLowerCase("fr").includes(rechercheVal));
    const table = h("table", { class: "tableau-catalogue-table", "aria-label": "Liste des agents enregistrés" });
    table.append(h("thead", {}, h("tr", {}, ...["Prénom(s)", "Nom", "Service", "Régime", "Matricule", "État", "Actions"].map((t) => h("th", { scope: "col" }, t)))));
    const corps = h("tbody", {});
    for (const a of visibles) {
      const btnModifier = h("button", { type: "button", class: "secondaire", onclick: () => {
        idAgentEdite = a.id; prenom.value = a.prenom; nom.value = a.nom; matricule.value = a.matricule || "";
        alimenterServices(); if (a.serviceId && services.some((x) => x.id === a.serviceId && x.actif)) serviceAgent.value = a.serviceId; else serviceAgent.value = "";
        regimeAgent.value = a.regime; ++revisionPhotoCatalogue; photoAgentInput.value = ""; photoAgentDataUrl = null; photoAgentModifiee = false;
        photoAgentInitiale = typeof a.photoDataUrl === "string" && a.photoDataUrl.startsWith("data:image/jpeg;base64,") ? a.photoDataUrl : null;
        photoAgentPreview.hidden = !photoAgentInitiale; if (photoAgentInitiale) photoAgentPreview.src = photoAgentInitiale;
        photoAgentStatus.className = "note"; photoAgentStatus.textContent = photoAgentInitiale ? "Photo actuelle chargée. Choisissez un fichier pour la remplacer ou cliquez sur Retirer la photo actuelle." : "Aucune photo enregistrée. La photo est facultative.";
        enleverPhotoAgent.hidden = !photoAgentInitiale;
        btnAgent.textContent = "Enregistrer la modification"; annulerAgent.hidden = false;
        formAgent.scrollIntoView({ behavior: "smooth", block: "start" }); prenom.focus();
      } }, "Modifier");
      const btnEtat = a.actif
        ? h("button", { type: "button", class: "secondaire", onclick: async () => {
            if (!confirm(`Désactiver ${a.prenom} ${a.nom} ? Son historique sera conservé ; ses prochaines connexions seront révoquées.`)) return;
            try { await api(`/api/agents/${encodeURIComponent(a.id)}`, { methode: "DELETE" }); await charger(); }
            catch (e) { alert(e.message || "Désactivation impossible."); }
          } }, "Supprimer / archiver")
        : h("button", { type: "button", class: "secondaire", onclick: async () => {
            if (!confirm(`Réactiver ${a.prenom} ${a.nom} ? Son compte associé, s’il existe, sera réactivé également.`)) return;
            try { signalerCodeApresModification(await api(`/api/agents/${encodeURIComponent(a.id)}`, { methode: "PATCH", corps: { actif: true } }), `${a.prenom ?? ""} ${a.nom ?? ""}`.trim()); await charger(); }
            catch (e) { alert(e.message || "Réactivation impossible."); }
          } }, "Réactiver");
      corps.append(h("tr", {},
        h("td", { "data-label": "Prénom(s)" }, a.prenom),
        h("td", { "data-label": "Nom" }, a.nom),
        h("td", { "data-label": "Service" }, a.service),
        h("td", { "data-label": "Régime" }, a.regime === "general" ? "Service général" : a.regime === "garde" ? "Garde" : a.regime === "mobil" ? "Mobil" : "Urgences"),
        h("td", { "data-label": "Matricule" }, a.matricule || "Non renseigné"),
        h("td", { "data-label": "État" }, a.actif ? "Actif" : "Désactivé"),
        h("td", { "data-label": "Actions" }, h("div", { class: "catalogue-actions" }, btnModifier, btnEtat))));
    }
    if (!corps.childElementCount) corps.append(h("tr", {}, h("td", { colspan: "7" }, rechercheVal ? "Aucun agent ne correspond à cette recherche." : "Aucun agent dans le registre.")));
    table.append(corps); agentsListe.replaceChildren(table);
  }
  function afficherServices() {
    const table = h("table", { class: "tableau-catalogue-table", "aria-label": "Liste des services enregistrés" });
    table.append(h("thead", {}, h("tr", {}, ...["Service", "Régime par défaut", "État", "Actions"].map((t) => h("th", { scope: "col" }, t)))));
    const corps = h("tbody", {});
    for (const s of services) {
      const edit = h("button", { type: "button", class: "secondaire", onclick: () => {
        idServiceEdite = s.id; nomService.value = s.nom; regimeService.value = s.regimeDefaut;
        btnService.textContent = "Enregistrer la modification"; annulerService.hidden = false;
        formService.scrollIntoView({ behavior: "smooth", block: "start" }); nomService.focus();
      } }, "Modifier");
      const etat = s.actif
        ? h("button", { type: "button", class: "secondaire", onclick: async () => {
            if (!confirm(`Archiver le service « ${s.nom} » ? Les services associés à des agents actifs ne peuvent pas être archivés.`)) return;
            try { await api(`/api/services/${encodeURIComponent(s.id)}`, { methode: "DELETE" }); await charger(); }
            catch (e) { alert(e.message || "Archivage impossible."); }
          } }, "Supprimer / archiver")
        : h("button", { type: "button", class: "secondaire", onclick: async () => {
            if (!confirm(`Réactiver le service « ${s.nom} » ?`)) return;
            try { await api(`/api/services/${encodeURIComponent(s.id)}`, { methode: "PATCH", corps: { actif: true } }); await charger(); }
            catch (e) { alert(e.message || "Réactivation impossible."); }
          } }, "Réactiver");
      corps.append(h("tr", {},
        h("td", { "data-label": "Service" }, s.nom),
        h("td", { "data-label": "Régime par défaut" }, s.regimeDefaut === "general" ? "Service général" : s.regimeDefaut === "garde" ? "Garde" : s.regimeDefaut === "mobil" ? "Mobil" : "Urgences"),
        h("td", { "data-label": "État" }, s.actif ? "Actif" : "Archivé"),
        h("td", { "data-label": "Actions" }, h("div", { class: "catalogue-actions" }, edit, etat))));
    }
    if (!corps.childElementCount) corps.append(h("tr", {}, h("td", { colspan: "4" }, "Aucun service.")));
    table.append(corps); servicesListe.replaceChildren(table);
  }
  async function charger() {
    compteur.textContent = "Lecture des services et des agents dans PostgreSQL…";
    try {
      const [a, s] = await Promise.all([api("/api/agents"), api("/api/services")]);
      agents = Array.isArray(a.agents) ? a.agents : []; services = Array.isArray(s.services) ? s.services : [];
      alimenterServices(); afficherAgents(); afficherServices();
      compteur.textContent = `${agents.length} fiche(s) agent · ${agents.filter((x) => x.actif).length} active(s) · ${services.length} service(s), source PostgreSQL.`;
      statut.replaceChildren();
    } catch (e) {
      compteur.textContent = "Le registre n’a pas pu être chargé.";
      statut.replaceChildren(h("p", { class: "etat ko", role: "alert" }, e.message || "Lecture PostgreSQL impossible."));
    }
  }
  recherche.addEventListener("input", afficherAgents);
  void charger();
}

// ---------- Gestion des comptes utilisateurs ----------
async function vueComptes() {
  const statut = h("div", { role: "status", "aria-live": "polite" });
  const identifiant = h("input", { id: "compte-identifiant", minlength: "3", maxlength: "80", pattern: "[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}", autocomplete: "off", required: true });
  const motDePasse = h("input", { id: "compte-mot-de-passe", type: "password", minlength: "6", maxlength: "200", autocomplete: "new-password", required: true });
  const role = h("select", { id: "compte-role" }, h("option", { value: "responsable" }, "Responsable de service"), h("option", { value: "brancardier" }, "Brancardier"), h("option", { value: "administrateur" }, "Administrateur supplémentaire"));
  const agent = h("select", { id: "compte-agent" }, h("option", { value: "", selected: true, disabled: true }, "Choisir un agent actif…"));
  const services = h("select", { id: "compte-services", multiple: true, size: "5", "aria-describedby": "compte-aide-services" });
  const blocAgent = h("div", {}, h("label", { for: "compte-agent" }, "Agent associé"), agent);
  const blocServices = h("div", {}, h("label", { for: "compte-services" }, "Services gérés (Ctrl/Cmd pour plusieurs)"), services, h("p", { id: "compte-aide-services", class: "note" }, "Choisissez au moins un service."));
  const libelleMdp = h("label", { for: "compte-mot-de-passe" }, "Mot de passe initial (6 caractères minimum)");
  function actualiserTypeCompte() {
    const isAgent = role.value === "brancardier"; const isResponsable = role.value === "responsable"; blocAgent.hidden = !isAgent; blocServices.hidden = !isResponsable;
    const minimum = role.value === "administrateur" ? 9 : 6;
    motDePasse.setAttribute("minlength", String(minimum));
    libelleMdp.textContent = role.value === "administrateur" ? "Mot de passe initial (9 caractères minimum, par exemple 9 chiffres ou plus)" : "Mot de passe provisoire (6 caractères minimum, à changer à la première connexion)";
  }
  role.addEventListener("change", actualiserTypeCompte); actualiserTypeCompte();
  const formulaire = h("form", { class: "carte form-creation-badge", onsubmit: async (ev) => {
    ev.preventDefault(); vider(statut);
    const serv = Array.from(services.selectedOptions).map((o) => o.value);
    try {
      const reponse = await api("/api/utilisateurs", { methode: "POST", corps: { identifiant: identifiant.value.trim().toLowerCase(), motDePasse: motDePasse.value, role: role.value, agentId: role.value === "brancardier" ? agent.value : null, servicesGeres: role.value === "responsable" ? serv : [] } });
      statut.append(h("p", { class: "etat ok" }, reponse.message || "Compte créé.")); identifiant.value = ""; motDePasse.value = "";
      await rechargerComptes();
    } catch (e) { statut.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Création du compte impossible.")); }
  } }, h("h2", {}, "Créer un compte"),
    h("p", { class: "note" }, "Les comptes administrateurs accordent l’accès à tous les services : ne les créez que pour des personnes autorisées et journalisez leur remise. Les mots de passe sont hachés avec scrypt dans ce prototype."),
    h("div", { class: "form-badge-grille" },
      h("div", {}, h("label", { for: "compte-identifiant" }, "Identifiant de connexion"), identifiant),
      h("div", {}, libelleMdp, motDePasse),
      h("div", {}, h("label", { for: "compte-role" }, "Rôle"), role), blocAgent, blocServices),
    h("button", { type: "submit" }, "Créer le compte"), statut);
  const catalogue = h("div", { class: "tableau-responsive" });
  const statutRattrapage = h("div", { role: "status", "aria-live": "polite" });
  const boutonRattrapage = h("button", { type: "button", class: "secondaire", onclick: async () => {
    boutonRattrapage.disabled = true; vider(statutRattrapage);
    try {
      const r = await api("/api/comptes-agents", { methode: "POST", corps: {} });
      statutRattrapage.append(h("p", { class: "etat ok", role: "status" }, r.message || "Comptes agents créés."));
      if (Array.isArray(r.codes) && r.codes.length) statutRattrapage.append(blocCodesProvisoires(r.codes));
      if (Array.isArray(r.ignores) && r.ignores.length) {
        const raisons = { matricule_absent: "matricule manquant", matricule_trop_court: "matricule trop court", telephone_absent: "téléphone manquant ou trop court", identifiant_deja_utilise: "identifiant déjà utilisé", erreur_technique: "erreur technique (voir le journal du serveur)" };
        statutRattrapage.append(h("p", { class: "note" }, "Agents sans compte : "), h("ul", {}, ...r.ignores.slice(0, 60).map((x) => h("li", {}, `${x.prenom} ${x.nom} — ${raisons[x.raison] || x.raison}`))));
      }
      await rechargerComptes();
    } catch (e) { statutRattrapage.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Création des comptes impossible.")); }
    finally { boutonRattrapage.disabled = false; }
  } }, "Créer les comptes agents manquants");
  const blocRattrapage = moi?.mode === "catalogue-postgres" ? h("section", { class: "carte" }, h("h2", {}, "Comptes des agents"),
    h("p", { class: "note" }, "Un compte est créé automatiquement à la création d’un badge : identifiant = matricule, mot de passe provisoire = numéro de téléphone ou code généré affiché une seule fois, selon la configuration (à changer à la première connexion). Ce bouton crée les comptes des agents déjà enregistrés qui n’en ont pas, s’ils ont un matricule et un téléphone."),
    h("div", { class: "actions" }, boutonRattrapage), statutRattrapage) : null;
  racine.append(h("h1", {}, "Comptes et permissions"), formulaire, blocRattrapage, h("section", { class: "carte" }, h("h2", {}, "Comptes actifs et inactifs"), catalogue));
  let donneesAgents = { agents: [], services: [] };
  try {
    const [agentsResult, donneesBadges] = await Promise.all([api("/api/agents"), api("/api/utilisateurs")]);
    donneesAgents = agentsResult;
    for (const a of donneesAgents.agents || []) agent.append(h("option", { value: a.id }, `${a.prenom} ${a.nom} · ${a.service}`));
    for (const s of donneesAgents.services || []) services.append(h("option", { value: s.id }, s.nom));
    await rechargerComptes(donneesBadges.utilisateurs || []);
  } catch (e) { catalogue.replaceChildren(h("p", { class: "etat ko", role: "alert" }, e.message || "Chargement des comptes impossible.")); }
  async function rechargerComptes(valeurs) {
    try {
      const utilisateurs = valeurs || (await api("/api/utilisateurs")).utilisateurs || [];
      const table = h("table", {}); table.append(h("thead", {}, h("tr", {}, ...["Identifiant", "Rôle", "Périmètre", "État", "Action"].map((x) => h("th", {}, x)))));
      const corps = h("tbody", {});
      for (const u of utilisateurs) {
        const agentLie = u.agentId ? (donneesAgents.agents || []).find((a) => a.id === u.agentId) : null;
        const servs = (u.servicesGeres || []).map((id) => (donneesAgents.services || []).find((s) => s.id === id)?.nom || id).join(", ");
        const perimetre = agentLie ? `${agentLie.prenom} ${agentLie.nom}` : servs || (u.role === "administrateur" ? "Tous les services" : "—");
        const actions = [];
        actions.push(h("button", { type: "button", class: "secondaire", onclick: async () => {
          const nouveau = prompt(`Nouveau mot de passe pour ${u.identifiant} (6 caractères minimum) :`);
          if (nouveau === null) return;
          if (nouveau.length < 6 || nouveau.length > 200) { alert("Le mot de passe doit contenir entre 6 et 200 caractères."); return; }
          try { const r = await api(`/api/utilisateurs/${encodeURIComponent(u.id)}`, { methode: "PATCH", corps: { motDePasse: nouveau } }); alert(r.message || "Mot de passe réinitialisé."); }
          catch (e) { alert(e.message || "Réinitialisation impossible."); }
        } }, "Réinitialiser le mot de passe"));
        actions.push(h("button", { type: "button", class: "secondaire", onclick: async () => {
          try { const r = await api("/api/connexions/debloquer", { methode: "POST", corps: { identifiant: u.identifiant } }); alert(r.message || "Compte débloqué."); }
          catch (e) { alert(e.message || "Déblocage impossible."); }
        } }, "Débloquer la connexion"));
        if (!u.actif) {
          actions.push(h("button", { type: "button", class: "secondaire", onclick: async () => {
            if (!confirm(`Réactiver le compte « ${u.identifiant} » ?`)) return;
            try { await api(`/api/utilisateurs/${encodeURIComponent(u.id)}`, { methode: "PATCH", corps: { actif: true } }); await rechargerComptes(); }
            catch (e) { alert(e.message || "Réactivation impossible."); }
          } }, "Réactiver"));
        } else if (u.id !== moi?.id) {
          actions.push(h("button", { type: "button", class: "secondaire", onclick: async () => {
            if (!confirm(`Désactiver le compte « ${u.identifiant} » ? Ses prochaines requêtes seront refusées.`)) return;
            try { await api(`/api/utilisateurs/${encodeURIComponent(u.id)}`, { methode: "DELETE" }); await rechargerComptes(); }
            catch (e) { alert(e.message || "Désactivation impossible."); }
          } }, "Désactiver"));
        }
        const action = h("div", { class: "actions-compte" }, ...actions);
        corps.append(h("tr", {}, h("td", {}, u.identifiant), h("td", {}, u.role), h("td", {}, perimetre), h("td", {}, u.actif ? "Actif" : "Désactivé"), h("td", {}, action)));
      }
      if (!corps.childElementCount) corps.append(h("tr", {}, h("td", { colspan: "5" }, "Aucun compte.")));
      table.append(corps); catalogue.replaceChildren(table);
    } catch (e) { catalogue.replaceChildren(h("p", { class: "etat ko", role: "alert" }, e.message || "Chargement des comptes impossible.")); }
  }
}

// ---------- Création et impression de badges professionnels recto-verso ----------
async function preparerPhotoBadge(fichier) {
  if (!fichier) throw new Error("Choisissez une photo depuis votre ordinateur ou votre téléphone.");
  const nomFichier = String(fichier.name || "photo").toLowerCase();
  const extension = nomFichier.includes(".") ? nomFichier.split(".").pop() : "";
  const type = String(fichier.type || "").toLowerCase();
  if (["heic", "heif"].includes(extension) || type.includes("heic") || type.includes("heif")) {
    throw new Error("Cette photo est au format HEIC/HEIF, fréquent sur iPhone, et ce navigateur ne peut pas la convertir automatiquement. Convertissez-la en JPG, puis réessayez. Sur iPhone : Réglages → Appareil photo → Formats → Le plus compatible pour les prochaines photos.");
  }
  if (fichier.size > 20 * 1024 * 1024) throw new Error("La photo d’origine dépasse 20 Mo. Choisissez une photo plus petite.");
  const extensionsImage = ["jpg", "jpeg", "jfif", "png", "webp", "gif", "bmp", "avif"];
  if (type === "image/svg+xml" || extension === "svg") {
    throw new Error("Les images SVG ne sont pas acceptées. Choisissez une photo JPG, PNG ou WebP.");
  }
  if ((!type.startsWith("image/") && !extensionsImage.includes(extension)) || (type && !type.startsWith("image/") && !extensionsImage.includes(extension))) {
    throw new Error("Le fichier choisi ne semble pas être une image. Choisissez un fichier JPG, PNG, WebP, GIF, BMP ou AVIF.");
  }
  const url = URL.createObjectURL(fichier);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Le navigateur ne parvient pas à lire cette image. Ouvrez-la dans Photos ou Paint et enregistrez une copie au format JPG, puis réessayez."));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("Photo invalide ou illisible. Essayez une copie JPG ou PNG.");
    // Recadrage centré au format portrait 4:5, puis compression avec une marge sous la limite HTTP.
    const ratio = 4 / 5;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (sw / sh > ratio) { sw = sh * ratio; sx = (img.naturalWidth - sw) / 2; }
    else { sh = sw / ratio; sy = (img.naturalHeight - sh) / 2; }
    for (const cote of [360, 320, 280, 240, 200]) {
      const canvas = document.createElement("canvas");
      canvas.width = cote; canvas.height = Math.round(cote / ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("La préparation de la photo n’est pas disponible dans ce navigateur. Essayez Chrome ou Edge à jour.");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      for (const qualite of [0.76, 0.68, 0.60, 0.52]) {
        const data = canvas.toDataURL("image/jpeg", qualite);
        if (data.length <= 85_000) return data;
      }
    }
    throw new Error("Cette photo reste trop volumineuse après compression. Essayez une photo moins détaillée ou plus petite.");
  } finally { URL.revokeObjectURL(url); }
}

// Profession imprimée au recto : valeur saisie, sinon « Brancardier » (métier historique de l'application).
// Motif compatible avec le mode « v » des navigateurs récents (parenthèses, point, barre et tiret échappés).
const MOTIF_TELEPHONE = "[0-9+\\(\\)\\.\\/ \\-]{3,30}";
const PROFESSION_PAR_DEFAUT = "Brancardier";
const professionAffichee = (b) => String(b.profession ?? "").trim() || PROFESSION_PAR_DEFAUT;
const PROFESSIONS_SUGGEREES = ["Brancardier", "Chef brancardier", "Superviseur"];
function DATALISTE_PROFESSIONS() {
  return h("datalist", { id: "professions-badge" }, ...PROFESSIONS_SUGGEREES.map((p) => h("option", { value: p })));
}

function vueBadges() {
  const statutForm = h("div", { "aria-live": "polite" });
  const liste = h("div", { class: "grille-badges" });
  const filtreNom = h("input", { id: "recherche-badge", type: "search", placeholder: "Rechercher un nom, prénom ou matricule…", autocomplete: "off" });
  const filtreService = h("select", { id: "filtre-service-badge" });
  const prenom = h("input", { id: "nouveau-prenom", name: "prenom", required: true, maxlength: "80", autocomplete: "given-name", placeholder: "Ex. : Awa" });
  const nom = h("input", { id: "nouveau-nom", name: "nom", required: true, maxlength: "80", autocomplete: "family-name", placeholder: "Ex. : Ndiaye" });
  const matricule = h("input", { id: "nouveau-matricule", name: "matricule", maxlength: "40", placeholder: "Ex. : FANN-001 (facultatif)" });
  const profession = h("input", { id: "nouveau-profession", name: "profession", maxlength: "60", list: "professions-badge", autocomplete: "off", placeholder: "Brancardier (par défaut)" });
  const adresse = h("input", { id: "nouveau-adresse", name: "adresse", maxlength: "100", autocomplete: "street-address", placeholder: "Ex. : Médina, rue 11 x 6, Dakar (facultatif)" });
  const telephone = h("input", { id: "nouveau-telephone", name: "telephone", type: "tel", inputmode: "tel", maxlength: "30", pattern: MOTIF_TELEPHONE, autocomplete: "tel", placeholder: "Ex. : 77 000 00 00 (facultatif)", title: "Chiffres, +, espaces, parenthèses, points et tirets uniquement" });
  const service = h("select", { id: "nouveau-service", name: "service", required: true }, h("option", { value: "", selected: true, disabled: true }, "Choisir un service…"));
  const serviceNouveauNom = h("input", { id: "nouveau-service-nom", maxlength: "100", placeholder: "Ex. : Chirurgie plastique" });
  const serviceNouveauBloc = h("div", { hidden: true }, h("label", { for: "nouveau-service-nom" }, "Nom du nouveau service"), serviceNouveauNom);
  const regime = h("select", { id: "nouveau-regime", name: "regime", required: true },
    h("option", { value: "general" }, "Service général · 08 h–16 h"),
    h("option", { value: "garde" }, "Garde · 24 h / repos 48 h"),
    h("option", { value: "urgences" }, "Urgences · jour ou nuit"));
  const photoInput = h("input", { id: "nouveau-photo", name: "photo", type: "file", accept: "image/*,.heic,.heif", required: true, title: "Choisissez une photo du visage ; les fichiers HEIC/HEIF doivent être convertis en JPG", "aria-describedby": "aide-photo-badge" });
  const photoStatus = h("p", { id: "aide-photo-badge", class: "note", role: "status" }, "Choisissez une photo du visage (JPG, PNG, WebP, GIF, BMP ou AVIF). Les photos HEIC/HEIF doivent être converties en JPG.");
  const photoPreview = h("img", { class: "miniature-photo-agent", alt: "Aperçu de la photo de l’agent", hidden: true });
  let photoAgentDataUrl = "";
  let revisionPhoto = 0;
  photoInput.addEventListener("change", async () => {
    const revision = ++revisionPhoto;
    const fichier = photoInput.files?.[0];
    photoAgentDataUrl = "";
    photoPreview.hidden = true;
    if (!fichier) { photoStatus.className = "note etat ko"; photoStatus.textContent = "Photo obligatoire. Cliquez sur Choisir un fichier et sélectionnez une image."; return; }
    photoStatus.className = "note"; photoStatus.textContent = "Préparation et compression de la photo…";
    try {
      const data = await preparerPhotoBadge(fichier);
      if (revision !== revisionPhoto) return;
      photoAgentDataUrl = data;
      photoPreview.src = data;
      photoPreview.hidden = false;
      photoStatus.className = "note etat ok"; photoStatus.textContent = `Photo prête : ${fichier.name} · recadrée et optimisée pour l’impression.`;
    } catch (err) {
      if (revision !== revisionPhoto) return;
      photoStatus.className = "note etat ko"; photoStatus.textContent = err.message || "Impossible de préparer cette photo.";
    }
  });
  const boutonCreer = h("button", { type: "submit" }, "Créer la fiche et le badge");
  const form = h("form", { class: "carte form-creation-badge", onsubmit: async (e) => {
    e.preventDefault(); vider(statutForm);
    if (!photoAgentDataUrl) {
      statutForm.append(h("p", { class: "etat ko", role: "alert" }, "Ajoutez une photo valide avant de créer le badge."));
      photoInput.focus(); return;
    }
    boutonCreer.disabled = true;
    try {
      const r = await api("/api/agents", { methode: "POST", corps: {
        prenom: prenom.value.trim(), nom: nom.value.trim(), matricule: matricule.value.trim(),
        profession: profession.value.trim(), adresse: adresse.value.trim(), telephone: telephone.value.trim(),
        serviceId: service.value, serviceNom: serviceNouveauNom.value.trim(), regime: regime.value,
        photoDataUrl: photoAgentDataUrl,
      } });
      const badgeDejaCree = r.badgeCree === true;
      if (!badgeDejaCree) {
        try {
          await api(`/api/badges/${encodeURIComponent(r.agent.id)}/emettre`, { methode: "POST" });
        } catch (badgeErreur) {
          await chargerBadges(r.agent.serviceId);
          statutForm.append(h("p", { class: "etat attention", role: "alert" }, `${r.agent.prenom} ${r.agent.nom} : fiche enregistrée, mais l’émission du badge a échoué. ${badgeErreur.message || "Réessayez depuis Agents sans badge actif."}${r.message || ""}`));
          prenom.value = ""; nom.value = ""; matricule.value = ""; profession.value = ""; adresse.value = ""; telephone.value = ""; photoInput.value = ""; photoAgentDataUrl = ""; photoPreview.hidden = true;
          photoStatus.className = "note"; photoStatus.textContent = "Fiche créée. Si nécessaire, émettez le badge depuis la liste des agents sans badge actif.";
          return;
        }
      }
      const sourceEnregistrement = badgeDejaCree ? "dans le stockage de démonstration" : "dans PostgreSQL";
      statutForm.append(h("p", { class: "etat ok", role: "status" }, `${r.agent.prenom} ${r.agent.nom} : fiche et badge enregistrés ${sourceEnregistrement}.`),
        h("p", { class: r.compteAgent && r.compteAgent.cree === false ? "etat attention" : "note" }, r.message),
        r.compteAgent?.motDePasseProvisoire ? blocCodesProvisoires([{ prenom: r.agent.prenom, nom: r.agent.nom, identifiant: r.compteAgent.identifiant, motDePasseProvisoire: r.compteAgent.motDePasseProvisoire }]) : null);
      prenom.value = ""; nom.value = ""; matricule.value = ""; profession.value = ""; adresse.value = ""; telephone.value = ""; photoInput.value = "";
      photoAgentDataUrl = ""; photoPreview.hidden = true;
      photoStatus.className = "note"; photoStatus.textContent = "Choisissez une photo du visage (JPG, PNG, WebP, GIF, BMP ou AVIF). Les photos HEIC/HEIF doivent être converties en JPG.";
      await chargerBadges(r.agent.serviceId);
      prenom.focus();
    } catch (e2) {
      statutForm.append(h("p", { class: "etat ko", role: "alert" }, e2.message || "La création du badge a échoué."));
    } finally { boutonCreer.disabled = false; }
  } },
    h("h2", {}, "Créer un badge pour un agent"),
    h("p", { class: "note" }, "Ajoutez une photo nette du visage. Cliquez sur le champ de sélection de fichier, choisissez la photo, puis attendez que l’aperçu indique « Photo prête » avant de créer le badge. La photo est recadrée au format portrait et compressée automatiquement."),
    h("div", { class: "form-badge-grille" },
      h("div", {}, h("label", { for: "nouveau-prenom" }, "Prénom"), prenom),
      h("div", {}, h("label", { for: "nouveau-nom" }, "Nom"), nom),
      h("div", {}, h("label", { for: "nouveau-matricule" }, "Matricule"), matricule),
      h("div", {}, h("label", { for: "nouveau-profession" }, "Profession (imprimée au recto)"), profession, DATALISTE_PROFESSIONS()),
      h("div", {}, h("label", { for: "nouveau-telephone" }, "Téléphone (imprimé au verso)"), telephone),
      h("div", { class: "champ-large" }, h("label", { for: "nouveau-adresse" }, "Adresse (imprimée au verso)"), adresse),
      h("div", {}, h("label", { for: "nouveau-service" }, "Service"), service, serviceNouveauBloc),
      h("div", {}, h("label", { for: "nouveau-regime" }, "Régime de travail"), regime),
      h("div", { class: "champ-photo-badge" }, h("label", { for: "nouveau-photo" }, "Photo de l’agent (obligatoire)"), photoInput, photoStatus, photoPreview)),
    h("div", { class: "actions" }, boutonCreer), statutForm);

  // Déclarer cette zone avant sa première utilisation dans `zoneListe`.
  // L'ordre précédent levait une ReferenceError (const en zone morte temporelle)
  // pendant le rendu et la page « Badges à imprimer » restait blanche.
  const statutImpression = h("div", { "aria-live": "polite" });
  const commandes = h("div", { class: "actions impression-actions" },
    h("button", { type: "button", onclick: imprimerBadgesSelectionnes }, "Imprimer les badges recto-verso / PDF"),
    h("button", { type: "button", class: "secondaire", onclick: () => selectionnerVisibles(true) }, "Sélectionner les résultats"),
    h("button", { type: "button", class: "secondaire", onclick: () => selectionnerVisibles(false) }, "Désélectionner les résultats"),
    h("button", { type: "button", class: "secondaire", onclick: () => { void chargerBadges(); } }, "Actualiser la liste"));
  const zoneListe = h("section", { class: "carte" },
    h("h2", {}, "Badges prêts à imprimer"),
    h("p", { class: "note" }, "Chaque badge possède deux faces : photo et identité au recto, informations et QR code au verso. Le QR imprimé n'est pas un lien Internet : scannez-le depuis la page Poste partagé. Pour imprimer sur A4, sélectionnez le recto-verso, retournez sur le bord long et gardez l’échelle à 100 %. Pour une imprimante à badges, configurez le format 86 × 54 mm."),
    h("div", { class: "filtres-badges" },
      h("div", {}, h("label", { for: "recherche-badge" }, "Rechercher un agent"), filtreNom),
      h("div", {}, h("label", { for: "filtre-service-badge" }, "Filtrer par service"), filtreService)),
    commandes, statutImpression, liste);
  const zoneSansBadge = h("section", { class: "carte agents-sans-badge" },
    h("h2", {}, "Agents sans badge actif"),
    h("p", { class: "note" }, "Un badge peut être émis uniquement par un administrateur. Émettre ou révoquer un badge ne désactive jamais la fiche de l’agent."));
  const zoneImpression = h("div", { class: "impression-badges-recto-verso apercu-impression", hidden: true });
  racine.append(h("h1", {}, "Atelier de badges professionnels · FANN"), form,
    h("div", { class: "note-avertissement" }, h("strong", {}, "À faire avant le pointage"),
      h("p", {}, "La création d’un badge ne crée pas automatiquement le planning de l’agent. Configurez ses postes de travail : sans poste prévu, un pointage au poste partagé pourra être enregistré « à vérifier ».")),
    zoneSansBadge, zoneListe, zoneImpression);

  let badges = [];
  function actualiserChampNouveauService() {
    const ajouter = service.value === "__nouveau__";
    serviceNouveauBloc.hidden = !ajouter;
    serviceNouveauNom.required = ajouter;
    if (!ajouter) serviceNouveauNom.value = "";
  }
  service.addEventListener("change", actualiserChampNouveauService);
  const selection = new Set();

  function sourceQr(b) {
    return creerSourceQrBadge(window.FannQRCode, b.badgeCode);
  }
  function photoFace(b) {
    if (b.photoDataUrl) return h("img", { class: "badge-photo", src: b.photoDataUrl, alt: `Photo de ${b.prenom} ${b.nom}` });
    return h("div", { class: "badge-photo badge-photo-vide", role: "img", "aria-label": "Photo absente" }, "PHOTO");
  }
  function estBadgeDemo(b) {
    return String(b.matricule || "").startsWith("DEMO-") || String(b.nom || "").startsWith("Démo-");
  }
  const NOM_COMPLET = (b) => `${b.prenom} ${b.nom}`;
  function faceRecto(b) {
    return h("div", { class: "badge-visuel badge-recto", role: "group", "aria-label": `Recto du badge de ${NOM_COMPLET(b)}` },
      filigraneLogo(),
      ...(estBadgeDemo(b) ? [h("div", { class: "filigrane-demo" }, "DÉMONSTRATION")] : []),
      h("header", { class: "badge-recto-entete" },
        h("img", { src: "/icons/logo-chnuf.png", alt: "Logo du CHNUF" }),
        h("div", {}, h("strong", {}, "CENTRE HOSPITALIER NATIONAL UNIVERSITAIRE DE FANN"), h("small", {}, "BADGE PROFESSIONNEL"))),
      h("div", { class: "badge-recto-corps" }, photoFace(b),
        h("div", { class: "badge-recto-identite" },
          // Recto : le prénom d'abord, puis le nom en majuscules.
          h("span", { class: "badge-prenom" }, b.prenom),
          h("span", { class: "badge-nom" }, String(b.nom ?? "").toLocaleUpperCase("fr")),
          h("span", { class: "badge-profession" }, professionAffichee(b)),
          h("span", { class: "badge-matricule" }, `Matricule : ${b.matricule || "Non renseigné"}`))),
      h("footer", { class: "badge-recto-pied" }, h("span", {}, "AVEC SENDIMBEUL SARL"), h("span", {}, "BADGE PERSONNEL")));
  }
  // Filigrane : logo de l'hôpital en encre verte (image réelle, donc imprimée de façon fiable).
  const filigraneLogo = () => h("img", { class: "badge-filigrane", src: "/icons/logo-chnuf-filigrane.png", alt: "", "aria-hidden": "true", decoding: "async" });
  function ligneVerso(libelle, valeur, classe = "") {
    const texte = String(valeur ?? "").trim();
    return h("div", { class: `badge-champ ${classe}${texte ? "" : " badge-champ-vide"}` },
      h("dt", {}, libelle), h("dd", {}, texte || "—"));
  }
  function faceVerso(b) {
    const qr = sourceQr(b);
    return h("div", { class: "badge-visuel badge-verso", role: "group", "aria-label": `Verso du badge de ${NOM_COMPLET(b)}` },
      filigraneLogo(),
      ...(estBadgeDemo(b) ? [h("div", { class: "filigrane-demo" }, "DÉMONSTRATION")] : []),
      h("header", { class: "badge-verso-entete" }, h("strong", {}, "IDENTIFICATION"), h("span", {}, "FANN POINTAGE")),
      h("div", { class: "badge-verso-corps" },
        h("dl", { class: "badge-verso-identite" },
          ligneVerso("Nom", String(b.nom ?? "").toLocaleUpperCase("fr"), "badge-champ-nom"),
          ligneVerso("Prénom", b.prenom, "badge-champ-prenom"),
          ligneVerso("Adresse", b.adresse, "badge-champ-adresse"),
          ligneVerso("Tél.", b.telephone, "badge-champ-telephone"),
          ...(b.matricule ? [ligneVerso("Matr.", b.matricule, "badge-champ-matricule")] : [])),
        h("div", { class: "badge-qr-bloc" },
          h("img", { class: "badge-qr-verso", alt: `QR individuel de ${NOM_COMPLET(b)}`, src: qr }),
          h("small", {}, "Scanner au poste de pointage"))),
      h("footer", { class: "badge-verso-pied" }, "Badge personnel et non transférable. En cas de perte, prévenir immédiatement l’administration."));
  }
  // Éditeur de badge : tous les éléments imprimés sont modifiables, avec aperçu recto-verso en direct.
  function ouvrirEditeurBadge(b) {
    const champ = (id, libelle, input, aide) => h("div", {}, h("label", { for: id }, libelle), input, aide ? h("small", { class: "note" }, aide) : null);
    const iNom = h("input", { id: "edit-nom", name: "nom", required: true, maxlength: "80", autocomplete: "off", value: b.nom || "" });
    const iPrenom = h("input", { id: "edit-prenom", name: "prenom", required: true, maxlength: "80", autocomplete: "off", value: b.prenom || "" });
    const iMatricule = h("input", { id: "edit-matricule", name: "matricule", maxlength: "40", autocomplete: "off", value: b.matricule || "" });
    const iProfession = h("input", { id: "edit-profession", name: "profession", maxlength: "60", list: "professions-badge", autocomplete: "off", placeholder: "Brancardier (par défaut)", value: b.profession || "" });
    const iAdresse = h("textarea", { id: "edit-adresse", name: "adresse", rows: "2", maxlength: "100", autocomplete: "off" }, b.adresse || "");
    const iTelephone = h("input", { id: "edit-telephone", name: "telephone", type: "tel", inputmode: "tel", maxlength: "30", pattern: MOTIF_TELEPHONE, autocomplete: "off", value: b.telephone || "", title: "Chiffres, +, espaces, parenthèses, points et tirets uniquement" });
    const apercu = h("div", { class: "badge-paire-apercu badge-editeur-apercu", "aria-label": "Aperçu du badge" });
    const statut = h("div", { role: "status", "aria-live": "polite" });
    const enregistrer = h("button", { type: "submit" }, "Enregistrer les modifications");
    const dialogue = h("dialog", { class: "dialogue-badge", "aria-labelledby": "edit-titre" });
    const brouillon = () => ({ ...b, nom: iNom.value.trim(), prenom: iPrenom.value.trim(), matricule: iMatricule.value.trim() || null,
      profession: iProfession.value.trim() || null, adresse: iAdresse.value.trim() || null, telephone: iTelephone.value.trim() || null });
    const actualiserApercu = () => { const d = brouillon(); apercu.replaceChildren(faceRecto(d), faceVerso(d)); };
    for (const i of [iNom, iPrenom, iMatricule, iProfession, iAdresse, iTelephone]) i.addEventListener("input", actualiserApercu);
    const fermer = () => { if (dialogue.open) dialogue.close(); dialogue.remove(); };
    const formulaire = h("form", { class: "form-edition-badge", onsubmit: async (ev) => {
      ev.preventDefault(); statut.replaceChildren();
      if (!formulaire.reportValidity()) return;
      const d = brouillon();
      enregistrer.disabled = true;
      try {
        signalerCodeApresModification(await api(`/api/agents/${encodeURIComponent(b.agentId)}`, { methode: "PATCH", corps: {
          prenom: d.prenom, nom: d.nom, matricule: d.matricule || "", profession: d.profession || "", adresse: d.adresse || "", telephone: d.telephone || "",
        } }), `${d.prenom} ${d.nom}`);
        fermer();
        await chargerBadges(b.serviceId);
      } catch (e) {
        statut.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Modification impossible."));
        enregistrer.disabled = false;
      }
    } },
      h("h2", { id: "edit-titre" }, `Modifier le badge de ${NOM_COMPLET(b)}`),
      h("p", { class: "note" }, "Ces informations sont imprimées sur le badge. L’aperçu se met à jour pendant la saisie. Le QR et la photo ne changent pas ; utilisez « Changer la photo » ou « Révoquer / renouveler le QR » pour cela."),
      h("div", { class: "form-badge-grille" },
        champ("edit-nom", "Nom (recto et verso)", iNom),
        champ("edit-prenom", "Prénom (recto et verso)", iPrenom),
        champ("edit-matricule", "Matricule", iMatricule),
        champ("edit-profession", "Profession (recto)", iProfession, "Laisser vide pour afficher « Brancardier »."),
        champ("edit-telephone", "Téléphone (verso)", iTelephone),
        h("div", { class: "champ-large" }, h("label", { for: "edit-adresse" }, "Adresse (verso)"), iAdresse, h("small", { class: "note" }, "100 caractères maximum pour tenir sur le badge."))),
      apercu, statut,
      h("div", { class: "actions" }, enregistrer, h("button", { type: "button", class: "secondaire", onclick: fermer }, "Annuler")));
    dialogue.append(formulaire, DATALISTE_PROFESSIONS());
    dialogue.addEventListener("close", () => dialogue.remove());
    document.body.append(dialogue);
    actualiserApercu();
    dialogue.showModal();
    iProfession.focus();
  }
  function fermerApercuImpression() { zoneImpression.hidden = true; vider(zoneImpression); }
  // Deux temps, identiques sur ordinateur et téléphone : aperçu visible à l'écran, puis impression lancée par un second appui.
  // Sur téléphone, un window.print() immédiat suivi d'un nettoyage automatique donnait une page vide ou aucune réaction.
  function imprimerBadgesSelectionnes() {
    const retenus = badges.filter((b) => selection.has(b.agentId));
    vider(statutImpression);
    if (!retenus.length) {
      statutImpression.append(h("p", { class: "etat ko", role: "alert" }, "Sélectionnez au moins un badge : cochez « Sélectionner pour impression » sur un badge, ou appuyez sur « Sélectionner les résultats »."));
      return;
    }
    vider(zoneImpression);
    zoneImpression.append(h("div", { class: "apercu-impression-actions" },
      h("h2", {}, `Aperçu avant impression : ${retenus.length} badge(s)`),
      h("p", { class: "note" }, "Appuyez sur « Lancer l’impression », puis choisissez une imprimante ou « Enregistrer au format PDF »."),
      h("div", { class: "actions" },
        h("button", { type: "button", onclick: () => { if (!ouvrirPageImpression("Badges FANN", zoneImpression)) window.print(); } }, "Lancer l’impression"),
        h("button", { type: "button", class: "secondaire", onclick: fermerApercuImpression }, "Fermer l’aperçu"))));
    // Une feuille A4 contient 8 emplacements (2 colonnes × 4 rangées) : 222 mm de haut, sans risque de coupure sur téléphone.
    // Chaque verso inverse les colonnes ; les créneaux vides sont conservés pour ne pas décaler une rangée incomplète.
    for (const lot of repartirLotsBadges(retenus, 8)) {
      zoneImpression.append(h("section", { class: "feuille-badges feuille-recto", "aria-label": "Recto des badges" },
        ...lot.map((b) => h("div", { class: "badge-print-face" }, faceRecto(b)))));
      const ordreVerso = ordonnerVersoBadges(lot);
      zoneImpression.append(h("section", { class: "feuille-badges feuille-verso", "aria-label": "Verso des badges" },
        ...ordreVerso.map((b) => h("div", {
          class: `badge-print-face${b === null ? " badge-print-face-vide" : ""}`,
          "aria-hidden": b === null ? "true" : "false",
        }, b === null ? null : faceVerso(b)))));
    }
    zoneImpression.hidden = false;
    zoneImpression.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function selectionnerVisibles(oui) {
    const visibles = Array.from(liste.querySelectorAll(".badge-imprimable"));
    for (const carte of visibles) {
      const id = carte.dataset.agentId;
      if (oui) selection.add(id); else selection.delete(id);
      const cb = carte.querySelector("input[type=checkbox]");
      if (cb) cb.checked = oui;
      carte.classList.toggle("selectionnee", oui);
    }
    actualiserCompteur();
  }
  function actualiserCompteur() {
    const compte = liste.querySelector(".compteur-selection");
    if (compte) compte.textContent = `${selection.size} badge(s) sélectionné(s)`;
  }
  function afficherListe() {
    vider(liste);
    const recherche = filtreNom.value.trim().toLocaleLowerCase("fr");
    const serviceChoisi = filtreService.value;
    const filtres = badges.filter((b) => {
      const texte = `${b.prenom} ${b.nom} ${b.matricule || ""} ${b.service} ${b.profession || ""}`.toLocaleLowerCase("fr");
      return (!recherche || texte.includes(recherche)) && (!serviceChoisi || b.serviceId === serviceChoisi);
    });
    liste.append(h("p", { class: "compteur-selection note" }, `${selection.size} badge(s) sélectionné(s) dans tout le catalogue · ${filtres.length} résultat(s) affiché(s)`));
    if (!filtres.length) { liste.append(h("p", {}, "Aucun badge ne correspond à ces filtres.")); return; }
    for (const b of filtres) {
      const choisi = selection.has(b.agentId);
      const coche = h("input", { type: "checkbox", checked: choisi, "aria-label": `Sélectionner le badge de ${b.prenom} ${b.nom}`, onchange: (e) => {
        if (e.target.checked) selection.add(b.agentId); else selection.delete(b.agentId);
        carte.classList.toggle("selectionnee", e.target.checked); actualiserCompteur();
      } });
      const estDemo = estBadgeDemo(b);
      const carte = h("article", { class: `badge-imprimable${choisi ? " selectionnee" : ""}${estDemo ? " badge-demo" : ""}`, "data-agent-id": b.agentId },
        h("div", { class: "controle-selection" }, h("label", {}, coche, estDemo ? " Badge de démonstration — ne pas distribuer" : " Sélectionner pour impression")),
        h("div", { class: "badge-paire-apercu" }, faceRecto(b), faceVerso(b)));
      if (moi?.role === "administrateur" && !estDemo) {
        const saisieNouvellePhoto = h("input", { type: "file", accept: "image/*,.heic,.heif", hidden: true, "aria-label": `Choisir une photo pour ${b.prenom} ${b.nom}` });
        const etatPhoto = h("span", { class: "note", role: "status" }, b.photoDataUrl ? "Photo enregistrée" : "Aucune photo enregistrée");
        saisieNouvellePhoto.addEventListener("change", async () => {
          const fichier = saisieNouvellePhoto.files?.[0];
          if (!fichier) return;
          saisieNouvellePhoto.disabled = true;
          etatPhoto.className = "note"; etatPhoto.textContent = "Préparation de la nouvelle photo…";
          try {
            const photoDataUrl = await preparerPhotoBadge(fichier);
            etatPhoto.textContent = "Enregistrement de la photo…";
            await api(`/api/agents/${encodeURIComponent(b.agentId)}`, { methode: "PATCH", corps: {
              prenom: b.prenom, nom: b.nom, matricule: b.matricule || "", photoDataUrl,
            } });
            etatPhoto.className = "note etat ok"; etatPhoto.textContent = "Photo mise à jour.";
            await chargerBadges(b.serviceId);
          } catch (e) {
            etatPhoto.className = "note etat ko"; etatPhoto.textContent = e.message || "Mise à jour de la photo impossible.";
          } finally { saisieNouvellePhoto.disabled = false; saisieNouvellePhoto.value = ""; }
        });
        const actions = h("div", { class: "actions badge-actions" },
          h("button", { type: "button", class: "secondaire", onclick: () => saisieNouvellePhoto.click() }, b.photoDataUrl ? "Changer la photo" : "Ajouter une photo"),
          saisieNouvellePhoto, etatPhoto,
          h("button", { type: "button", onclick: () => ouvrirEditeurBadge(b) }, "Modifier le badge"),
          h("button", { type: "button", class: "secondaire", onclick: async () => {
            if (!confirm(`Renouveler le badge de ${b.prenom} ${b.nom} ? L’ancien QR sera immédiatement révoqué. Il faudra imprimer le nouveau badge.`)) return;
            try { await api(`/api/badges/${encodeURIComponent(b.agentId)}/renouveler`, { methode: "POST" }); await chargerBadges(b.serviceId); alert("Ancien QR révoqué. Le nouveau code figure maintenant sur l’aperçu du badge : réimprimez-le avant de le remettre à l’agent."); }
            catch (e) { alert(e.message || "Renouvellement impossible."); }
          } }, "Révoquer / renouveler le QR"),
          h("button", { type: "button", class: "secondaire", onclick: async () => {
            if (!confirm(`Révoquer le badge de ${b.prenom} ${b.nom} ? Il ne permettra plus de pointer. La fiche agent et tout l’historique seront conservés.`)) return;
            try { await api(`/api/badges/${encodeURIComponent(b.agentId)}/revoquer`, { methode: "POST" }); selection.delete(b.agentId); await chargerBadges(b.serviceId); alert("Badge révoqué. La fiche de l’agent reste active."); }
            catch (e) { alert(e.message || "Révocation impossible."); }
          } }, "Révoquer le badge"));
        carte.append(actions);
      }
      liste.append(carte);
    }
  }

  async function chargerBadges(servicePreferee = "") {
    liste.replaceChildren(h("p", { class: "note" }, "Chargement des agents…"));
    try {
      const [donneesAgents, donneesBadges] = await Promise.all([api("/api/agents"), api("/api/badges")]);
      badges = donneesBadges.badges || [];
      const agentsCatalogue = (donneesAgents.agents || []).filter((a) => a.actif === true);
      const agentsSansBadge = agentsCatalogue.filter((a) => !badges.some((b) => b.agentId === a.id));
      vider(zoneSansBadge);
      zoneSansBadge.append(h("h2", {}, `Agents sans badge actif · ${agentsSansBadge.length}`),
        h("p", { class: "note" }, "L’émission, la révocation et le renouvellement sont enregistrés dans PostgreSQL et dans le journal d’audit."));
      if (!agentsSansBadge.length) zoneSansBadge.append(h("p", { class: "etat ok" }, "Tous les agents actifs disposent d’un badge actif."));
      else {
        const tableSansBadge = h("div", { class: "tableau-responsive" });
        const table = h("table", {});
        table.append(h("thead", {}, h("tr", {}, ...["Agent", "Service", "Régime", "Action"].map((label) => h("th", {}, label)))));
        const body = h("tbody", {});
        for (const a of agentsSansBadge) {
          const emit = h("button", { type: "button", class: "secondaire", onclick: async () => {
            emit.disabled = true;
            try { await api(`/api/badges/${encodeURIComponent(a.id)}/emettre`, { methode: "POST" }); selection.add(a.id); await chargerBadges(a.serviceId || ""); }
            catch (e) { alert(e.message || "Émission du badge impossible."); emit.disabled = false; }
          } }, "Émettre le badge");
          body.append(h("tr", {}, h("td", {}, `${a.prenom} ${a.nom}`), h("td", {}, a.service || "—"), h("td", {}, a.regime === "garde" ? "Garde" : a.regime === "urgences" ? "Urgences" : a.regime === "mobil" ? "Mobil" : "Service général"), h("td", {}, emit)));
        }
        table.append(body); tableSansBadge.append(table); zoneSansBadge.append(tableSansBadge);
      }
      vider(service); vider(filtreService);
      service.append(h("option", { value: "", selected: true, disabled: true }, "Choisir un service…"));
      filtreService.append(h("option", { value: "" }, "Tous les services"));
      for (const s of donneesAgents.services || []) {
        service.append(h("option", { value: s.id }, s.nom));
        filtreService.append(h("option", { value: s.id }, s.nom));
      }
      if (moi?.role === "administrateur") service.append(h("option", { value: "__nouveau__" }, "+ Ajouter un nouveau service…"));
      if (servicePreferee && [...service.options].some((o) => o.value === servicePreferee)) service.value = servicePreferee;
      actualiserChampNouveauService();
      if ((donneesAgents.services || []).length === 0 && moi?.role !== "administrateur") {
        liste.replaceChildren(h("p", { class: "etat attention" }, "Aucun service accessible à ce compte.")); return;
      }
      for (const b of badges) if (!selection.has(b.agentId) && !String(b.matricule || "").startsWith("DEMO-") && !String(b.nom || "").startsWith("Démo-")) selection.add(b.agentId);
      afficherListe();
    } catch (e) {
      vider(liste); liste.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Impossible de charger la liste des agents."));
    }
  }
  filtreNom.addEventListener("input", afficherListe);
  filtreService.addEventListener("change", afficherListe);
  void chargerBadges();
}

// ---------- Poste partagé : scan par responsable, fonctionnement sans téléphone personnel ----------
function vuePostePartage() {
  const badge = h("input", { id: "badge-station", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "FANN-BADGE:… ou matricule", "aria-describedby": "aide-badge" });
  const type = h("select", { id: "type-pointage-station" },
    h("option", { value: "arrivee" }, "Arrivée"), h("option", { value: "depart" }, "Départ"));
  const resultat = h("div", { "aria-live": "polite", "aria-atomic": "true" });
  const file = h("section", { class: "carte" });
  const zoneVideo = h("div");
  const btnEnregistrer = h("button", { type: "button" }, "Enregistrer le pointage");
  const btnCamera = h("button", { type: "button", class: "secondaire" }, "Scanner le badge avec la caméra");
  const caseSon = h("input", { id: "son-station", type: "checkbox" });
  caseSon.checked = signal.sonActif();
  const zoneNotifications = h("div");
  let flux = null;
  let generationCamera = 0;
  let lancementCamera = false;
  let envoiEnCours = false;
  let dernierSucces = false;
  const garde = creerGardeScan();

  function actualiserNotifications() {
    vider(zoneNotifications);
    const etat = signal.permission();
    if (etat === "granted") zoneNotifications.append(h("p", { class: "note" }, "Notifications activées sur cet appareil."));
    else if (etat === "default") zoneNotifications.append(h("button", { type: "button", class: "secondaire", onclick: async () => { await signal.demanderPermission(); actualiserNotifications(); } }, "Activer les notifications"));
    else if (etat === "denied") zoneNotifications.append(h("p", { class: "note" }, "Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site."));
    else zoneNotifications.append(h("p", { class: "note" }, "Les notifications ne sont pas prises en charge par ce navigateur."));
  }

  async function actualiserFile() {
    vider(file);
    file.append(h("h2", {}, "Pointages hors ligne en attente"));
    try {
      const elements = await lireFileLocale();
      file.append(h("p", { class: elements.length ? "etat attention" : "etat ok" }, elements.length
        ? `${elements.length} pointage(s) conservé(s) sur cet appareil. Ils ne sont pas encore confirmés.`
        : "Aucun pointage local en attente."));
      if (elements.length) {
        file.append(tableau([["Date capturée", (e) => new Date(e.capturedAt).toLocaleString("fr-FR", { timeZone: "Africa/Dakar" })],
          ["Type", (e) => e.type === "arrivee" ? "Arrivée" : "Départ"], ["Badge / matricule", (e) => e.matricule || e.badgeCode],
          ["État", (e) => e.erreurSynchronisation || "En attente de synchronisation"]], elements));
        if (navigator.onLine) file.append(h("button", { type: "button", class: "secondaire", onclick: () => { void synchroniserFileLocale(); } }, "Réessayer la synchronisation"));
      }
    } catch (e) {
      file.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Le stockage local hors ligne est indisponible."));
    }
  }

  function arreterCamera() {
    generationCamera += 1;
    lancementCamera = false;
    if (flux) flux.getTracks().forEach((t) => t.stop());
    flux = null;
    vider(zoneVideo);
    zoneVideo.classList.remove("scan-camera-zone");
    zoneVideo.removeAttribute("aria-label");
  }

  async function scannerCamera() {
    signal.preparer();
    if (flux || lancementCamera) return;
    const detecteur = creerDetecteurQr();
    if (!detecteur || !navigator.mediaDevices?.getUserMedia) {
      zoneVideo.textContent = !window.isSecureContext ? "La caméra exige une adresse HTTPS (ou localhost)." : "Ce navigateur ne prend pas en charge le scan caméra intégré. Utilisez un lecteur QR USB (qui saisit le code comme un clavier) ou tapez le code du badge.";
      return;
    }
    const gen = ++generationCamera;
    lancementCamera = true;
    try {
      const nouveauFlux = await ouvrirCameraQr();
      if (gen !== generationCamera) { nouveauFlux.getTracks().forEach((t) => t.stop()); return; }
      flux = nouveauFlux;
      const video = h("video", { autoplay: true, playsinline: true, muted: true, "aria-label": "Caméra arrière : placez le QR dans le cadre blanc" });
      video.srcObject = flux;
      zoneVideo.classList.add("scan-camera-zone"); zoneVideo.setAttribute("aria-label", "Placez le QR au centre du cadre blanc");
      vider(zoneVideo); zoneVideo.append(video); demarrerVideo(video);
      const boucle = async () => {
        if (!flux || gen !== generationCamera) return;
        const codes = await detecteur.detect(video).catch(() => []);
        if (!flux || gen !== generationCamera) return;
        if (codes.length) {
          badge.value = String(codes[0].rawValue || "").trim();
          // Pas de bip à la lecture : le signal de succès suit la confirmation du serveur (un seul bip et une seule vibration par scan).
          arreterCamera();
          badge.focus();
          if (garde.accepter(badge.value)) { dernierSucces = false; void enregistrerPointage().finally(() => garde.terminer({ rearmer: !dernierSucces })); }
          return;
        }
        setTimeout(boucle, detecteur.intervalleMs);
      };
      void boucle();
    } catch (e) {
      if (gen === generationCamera) zoneVideo.textContent = messageErreurCamera(e);
    } finally { if (gen === generationCamera) lancementCamera = false; }
  }

  async function enregistrerPointage() {
    if (envoiEnCours) return;
    signal.preparer();
    const badgeCode = badge.value.trim();
    // Second moyen : un matricule saisi à la main (lettres, chiffres, . _ / -), sans badge.
    const estMatricule = !/^FANN-BADGE:/i.test(badgeCode) && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(badgeCode);
    if (!estMatricule && !/^FANN-BADGE:[A-Za-z0-9_-]{1,64}(?::[A-Za-z0-9_-]{40,100})?$/.test(badgeCode)) {
      vider(resultat);
      const lienPointage = /#\/?pointage\?qr=|[?&]qr=/.test(badgeCode) || /^https?:\/\//i.test(badgeCode);
      const apercu = badgeCode.length > 24 ? `${badgeCode.slice(0, 24)}…` : badgeCode;
      const msg = !badgeCode
        ? "Aucun code lu. Scannez le badge imprimé de l'agent, saisissez son code FANN-BADGE ou son matricule."
        : lienPointage
          ? "Ceci est le QR dynamique du lieu de pointage (un lien), pas un badge d'agent. Il se scanne depuis la page « Pointage ». Ici, scannez le badge imprimé de l'agent (code commençant par FANN-BADGE:)."
          : `Code non reconnu (lu : « ${apercu} »). Un badge valide commence par FANN-BADGE: — imprimez-le depuis la page Badges.`;
      resultat.append(h("p", { class: "etat ko", role: "alert" }, msg));
      signal.jouer("ko");
      return;
    }
    const evenement = {
      ...(estMatricule ? { matricule: badgeCode } : { badgeCode }), type: type.value, idempotencyKey: crypto.randomUUID(),
      capturedAt: new Date().toISOString(), operateurId: moi?.id || "operateur-hors-ligne",
    };
    envoiEnCours = true; btnEnregistrer.disabled = true; vider(resultat);
    try {
      if (!navigator.onLine) throw new TypeError("Réseau indisponible");
      const r = await api("/api/pointage-station", { methode: "POST", corps: { ...evenement, horsLigne: false, appVersion: "pwa-station-1" } });
      resultat.append(h("p", { class: r.validation === "accepte" ? "etat ok" : "etat attention", role: "status" },
        `${r.validation === "accepte" ? "Pointage enregistré avec succès · " : ""}${r.agent} · ${r.type === "arrivee" ? "Arrivée" : "Départ"} · ${r.message} · ${new Date(r.serverTs).toLocaleTimeString("fr-FR", { timeZone: "Africa/Dakar" })}`));
      dernierSucces = r.validation === "accepte";
      void signal.signaler(niveauPointageStation(r), r.validation === "accepte" ? "Pointage enregistré" : "Pointage à vérifier",
        `${r.agent} · ${r.type === "arrivee" ? "Arrivée" : "Départ"} · ${new Date(r.serverTs).toLocaleTimeString("fr-FR", { timeZone: "Africa/Dakar" })}`);
      badge.value = ""; badge.focus();
    } catch (e) {
      // Seules les erreurs réseau sont mises en file. Un refus HTTP (droits, badge, séquence) doit être corrigé et non rejoué en boucle.
      if (!e || typeof e.statut !== "number") {
        try {
          await stockerLocalement(evenement);
          resultat.append(h("p", { class: "etat attention", role: "status" }, "Réseau indisponible : pointage enregistré localement sur cet appareil, NON confirmé. Il sera envoyé au retour du réseau et exigera une validation du responsable."));
          void signal.signaler("attention", "Pointage non confirmé", "Réseau indisponible : conservé sur cet appareil, à envoyer au retour du réseau.");
          badge.value = "";
        } catch (stockage) {
          resultat.append(h("p", { class: "etat ko", role: "alert" }, `Pointage non enregistré : ${stockage.message || "stockage local indisponible"}. Notez-le sur le registre papier de secours.`));
          void signal.signaler("ko", "Pointage non enregistré", "Notez-le sur le registre papier de secours.");
        }
      } else {
        resultat.append(h("p", { class: "etat ko", role: "alert" }, e.data?.message || e.message || "Pointage refusé."));
        void signal.signaler("ko", "Pointage refusé", e.data?.message || e.message || "Pointage refusé.");
      }
    } finally {
      envoiEnCours = false; btnEnregistrer.disabled = false; void actualiserFile();
    }
  }

  caseSon.addEventListener("change", () => { signal.definirSon(caseSon.checked); if (caseSon.checked) { signal.preparer(); signal.jouer("scan"); } });
  btnCamera.addEventListener("click", scannerCamera);
  btnEnregistrer.addEventListener("click", enregistrerPointage);
  badge.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void enregistrerPointage(); } });
  window.addEventListener("fann-queue-changed", actualiserFile);
  cleanupVue = () => { arreterCamera(); window.removeEventListener("fann-queue-changed", actualiserFile); };

  racine.append(h("h1", {}, "Poste de pointage partagé"),
    h("section", { class: "carte" },
      h("p", { class: "note" }, "L'agent présente son badge papier à l'appareil commun du service. Aucun smartphone personnel n'est nécessaire. Utilisez uniquement un appareil réservé au poste et gardez la session responsable protégée."),
      h("label", { for: "badge-station" }, "Scanner le badge, saisir son code ou le matricule de l\u2019agent"), badge,
      h("p", { id: "aide-badge", class: "note" }, "Un lecteur QR USB peut fonctionner comme un clavier. Si vous utilisez la caméra intégrée, le navigateur doit l'autoriser."),
      h("label", { for: "type-pointage-station" }, "Type de pointage"), type,
      h("div", { class: "controle-selection" }, h("label", { for: "son-station" }, caseSon, "Signal sonore à chaque pointage")),
      zoneNotifications,
      h("div", { class: "actions" }, btnCamera, btnEnregistrer), zoneVideo), resultat, file);
  actualiserNotifications();
  void actualiserFile();
}

// ---------- Classement mensuel : calcul de points et top 5, sans volet financier ----------
function moisPrecedentCle() {
  const p = aujourdhui().slice(0, 7).split("-").map(Number);
  let [annee, mois] = p;
  if (mois === 1) { annee -= 1; mois = 12; } else mois -= 1;
  return `${annee}-${String(mois).padStart(2, "0")}-01`;
}
function vueClassementMensuel() {
  const sortie = h("div", { "aria-live": "polite" });
  const mois = h("input", { id: "mois-classement", type: "month", value: moisPrecedentCle().slice(0, 7) });
  const chargerBtn = h("button", { type: "button", onclick: () => charger() }, "Afficher le classement");
  racine.append(
    h("h1", {}, "Classement mensuel"),
    h("p", { class: "note" }, "Le logiciel calcule les points à partir de la présence, de la ponctualité, des pointages complets et des anomalies, puis classe les agents. Aucun paiement, prime à verser ou référence de paiement n'est géré ici."),
    h("div", { class: "carte" }, h("label", { for: "mois-classement" }, "Mois à consulter"), mois, h("div", { class: "actions" }, chargerBtn)),
    sortie,
  );

  async function actionGenerer(cle) {
    try { await api("/api/classement-mensuel/generer", { methode: "POST", corps: { mois: cle } }); await charger(); }
    catch (e) { alert(e.message || "Calcul impossible"); }
  }
  async function telecharger() {
    try {
      const r = await api("/api/classement-mensuel", { q: { mois: `${mois.value}-01`, format: "csv" }, brut: true });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || "Export refusé."); }
      const url = URL.createObjectURL(await r.blob());
      const a = h("a", { href: url, download: `classement-mensuel-${mois.value}-01.csv` });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
  }
  async function charger() {
    vider(sortie);
    if (!/^\d{4}-\d{2}$/.test(mois.value)) { sortie.append(h("p", { class: "etat ko" }, "Sélectionnez un mois valide.")); return; }
    const cle = `${mois.value}-01`;
    try {
      const data = await api("/api/classement-mensuel", { q: { mois: cle } });
      const c = data.classement;
      if (!c) {
        const elements = [h("h2", {}, cle), h("p", {}, data.generationPossible ? "Aucun classement n'a encore été calculé pour ce mois terminé." : "Le classement pourra être calculé lorsque le mois sera entièrement terminé.")];
        if (data.generationPossible && moi.role === "administrateur") elements.push(h("button", { type: "button", onclick: () => actionGenerer(cle) }, "Calculer les points et le classement"));
        sortie.append(h("section", { class: "carte" }, elements));
        return;
      }

      sortie.append(h("section", { class: "carte" },
        h("h2", {}, `Classement · ${c.mois}`),
        h("p", {}, `${c.classement.length} agent(s) classé(s) · règles de points version ${c.versionRegles}`),
        h("p", { class: "note" }, `Calcul effectué le ${new Date(c.genereLe).toLocaleString("fr-FR", { timeZone: "Africa/Dakar" })}. Le classement est trié par score, puis par critères de départage ; l'identifiant technique est le dernier départage en cas d'égalité parfaite.`),
      ));

      sortie.append(h("h2", {}, "Les 5 meilleurs agents du mois"),
        c.top5.length ? tableau([
          ["Rang", (e) => e.rang], ["Agent", (e) => e.nom], ["Service", (e) => e.service], ["Équipe", (e) => e.regime],
          ["Points / 100", (e) => Number(e.score).toFixed(3)], ["Présence", (e) => `${Number(e.tauxPresence).toFixed(2)} %`],
        ], c.top5) : h("p", {}, "Aucun agent n'est disponible pour ce mois."),
      );

      sortie.append(h("h2", {}, "Classement complet des agents"), tableau([
        ["Rang", (e) => e.rang], ["Agent", (e) => e.nom], ["Service", (e) => e.service], ["Régime", (e) => e.regime],
        ["Points / 100", (e) => Number(e.score).toFixed(3)], ["Présence", (e) => `${Number(e.tauxPresence).toFixed(2)} %`],
        ["Retards", (e) => e.retards], ["Absences injustifiées validées", (e) => e.absencesInjustifiees === null ? "Non disponible" : e.absencesInjustifiees],
        ["Pointages complets", (e) => e.pointagesComplets], ["Anomalies non résolues", (e) => e.anomalies],
        ["Hors zone", (e) => e.pointagesHorsZone], ["Postes planifiés", (e) => e.postesPlanifies], ["Postes honorés", (e) => e.postesHonores],
      ], c.classement));
      sortie.append(h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: telecharger }, "Exporter le classement (CSV)")));
      if (c.audit?.length) sortie.append(h("details", { class: "carte" }, h("summary", {}, "Historique du calcul"), tableau([
        ["Date", (a) => new Date(a.at).toLocaleString("fr-FR", { timeZone: "Africa/Dakar" })], ["Action", (a) => a.action], ["Auteur", (a) => a.acteurId],
      ], c.audit)));
    } catch (e) { sortie.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Impossible de charger le classement.")); }
  }
  charger();
}

// ---------- Messagerie persistante, diffusion générale et destinataires ciblés ----------
function vueMessages() {
  const statut = h("div", { role: "status", "aria-live": "polite" });
  const liste = h("div", { "aria-live": "polite" });
  const titre = h("input", { id: "message-titre", maxlength: "120", minlength: "3", required: true, placeholder: "Ex. : Changement du planning de garde" });
  const contenu = h("textarea", { id: "message-contenu", maxlength: "4000", rows: "5", required: true, placeholder: "Écrivez votre annonce ou votre message personnalisé…" });
  const portee = h("select", { id: "message-portee", required: true },
    h("option", { value: "tous" }, "Tout le personnel actif"),
    h("option", { value: "comptes" }, "Un ou plusieurs agents/comptes"),
    h("option", { value: "services" }, "Un ou plusieurs services"),
  );
  const priorite = h("select", { id: "message-priorite" },
    h("option", { value: "normale" }, "Normale"),
    h("option", { value: "urgente" }, "Urgente"),
  );
  const recherche = h("input", { type: "search", id: "message-recherche", placeholder: "Rechercher un agent ou un service", autocomplete: "off" });
  const optionsCibles = h("div", { class: "message-destinataires-liste", role: "group", "aria-label": "Choix des destinataires" });
  const choixResume = h("p", { class: "note", role: "status" }, "Aucun destinataire sélectionné.");
  const zoneCibles = h("div", { class: "message-destinataires" },
    h("label", { for: "message-recherche" }, "Filtrer la liste"), recherche, optionsCibles, choixResume,
  );
  const selectionComptes = new Set();
  const selectionServices = new Set();
  let comptes = [];
  let services = [];
  let chargementDestinataires = false;

  function selectionActive() { return portee.value === "comptes" ? selectionComptes : selectionServices; }
  function elementsActifs() { return portee.value === "comptes" ? comptes : services; }
  function nomElement(e) { return portee.value === "comptes" ? `${e.nom} · ${e.role === "responsable" ? "Responsable" : "Agent"}` : e.nom; }
  function actualiserCibles() {
    const cible = portee.value;
    zoneCibles.hidden = cible === "tous";
    recherche.placeholder = cible === "comptes" ? "Rechercher un agent ou responsable" : "Rechercher un service";
    vider(optionsCibles);
    if (cible === "tous") { choixResume.textContent = "Le message sera envoyé à tous les comptes actifs."; return; }
    const texte = recherche.value.trim().toLocaleLowerCase("fr");
    const selection = selectionActive();
    const choix = elementsActifs().filter((e) => nomElement(e).toLocaleLowerCase("fr").includes(texte));
    if (!choix.length) optionsCibles.append(h("p", { class: "note" }, chargementDestinataires ? "Chargement des destinataires…" : "Aucun résultat. Vérifiez les comptes actifs et les affectations."));
    for (const e of choix) {
      const cb = h("input", { type: "checkbox", value: e.id, checked: selection.has(e.id), "aria-label": nomElement(e) });
      cb.addEventListener("change", () => {
        if (cb.checked) selection.add(e.id); else selection.delete(e.id);
        actualiserResume();
      });
      optionsCibles.append(h("label", { class: "message-destinataire-option" }, cb, h("span", {}, nomElement(e))));
    }
    actualiserResume();
  }
  function actualiserResume() {
    if (portee.value === "tous") { choixResume.textContent = "Le message sera envoyé à tous les comptes actifs."; return; }
    const n = selectionActive().size;
    choixResume.textContent = n === 0 ? "Aucun destinataire sélectionné." : `${n} ${portee.value === "comptes" ? "compte(s)" : "service(s)"} sélectionné(s).`;
  }
  portee.addEventListener("change", () => { recherche.value = ""; actualiserCibles(); });
  recherche.addEventListener("input", actualiserCibles);

  const formulaire = h("form", { class: "carte form-message", onsubmit: async (ev) => {
    ev.preventDefault(); vider(statut);
    if (moi?.role !== "administrateur") return;
    const porteeChoisie = portee.value;
    const destinataireIds = porteeChoisie === "comptes" ? [...selectionComptes] : [];
    const serviceIds = porteeChoisie === "services" ? [...selectionServices] : [];
    if (porteeChoisie === "comptes" && destinataireIds.length === 0) { statut.append(h("p", { class: "etat attention" }, "Sélectionnez au moins un agent ou responsable.")); return; }
    if (porteeChoisie === "services" && serviceIds.length === 0) { statut.append(h("p", { class: "etat attention" }, "Sélectionnez au moins un service.")); return; }
    if (porteeChoisie === "comptes" && destinataireIds.length > 100) { statut.append(h("p", { class: "etat attention" }, "Choisissez au maximum 100 comptes par message.")); return; }
    if (porteeChoisie === "services" && serviceIds.length > 50) { statut.append(h("p", { class: "etat attention" }, "Choisissez au maximum 50 services par message.")); return; }
    const bouton = formulaire.querySelector('button[type="submit"]');
    if (bouton) bouton.disabled = true;
    try {
      const resultat = await api("/api/messages", { methode: "POST", corps: { titre: titre.value.trim(), contenu: contenu.value.trim(), portee: porteeChoisie, priorite: priorite.value, destinataireIds, serviceIds } });
      titre.value = ""; contenu.value = ""; portee.value = "tous"; priorite.value = "normale";
      selectionComptes.clear(); selectionServices.clear(); recherche.value = ""; actualiserCibles();
      statut.append(h("p", { class: "etat ok" }, resultat.messageInfo || "Message envoyé."));
      await charger();
    } catch (e) { statut.append(h("p", { class: "etat ko", role: "alert" }, e.message || "L’envoi du message a échoué.")); }
    finally { if (bouton) bouton.disabled = false; }
  } },
    h("h2", {}, "Envoyer un message"),
    h("p", { class: "note" }, "Les messages ciblés ne sont visibles que par les comptes sélectionnés ou les personnes rattachées au service ciblé. L’envoi et le contrôle des destinataires sont vérifiés par le serveur."),
    h("label", { for: "message-titre" }, "Objet du message"), titre,
    h("label", { for: "message-portee" }, "Destinataires"), portee,
    zoneCibles,
    h("label", { for: "message-priorite" }, "Priorité"), priorite,
    h("label", { for: "message-contenu" }, "Message"), contenu,
    h("div", { class: "actions" }, h("button", { type: "submit" }, "Envoyer le message")),
  );
  racine.append(h("h1", {}, "Messagerie"), h("p", { class: "note" }, "Consultez les annonces de l’administration et les messages adressés à votre compte ou service."));
  if (moi?.role === "administrateur") racine.append(formulaire);
  const afficherRetires = h("input", { type: "checkbox", id: "messages-retires" });
  afficherRetires.addEventListener("change", () => { void charger(); });
  racine.append(statut, h("section", { class: "carte" }, h("h2", {}, moi?.role === "administrateur" ? "Messages envoyés" : "Messages reçus"),
    moi?.role === "administrateur" ? h("label", { class: "message-destinataire-option", for: "messages-retires" }, afficherRetires, h("span", {}, "Afficher aussi les messages retirés")) : null, liste));

  async function chargerDestinataires() {
    chargementDestinataires = true; actualiserCibles();
    try {
      const data = await api("/api/messages/destinataires");
      comptes = Array.isArray(data.comptes) ? data.comptes : [];
      services = Array.isArray(data.services) ? data.services : [];
    } catch (e) {
      optionsCibles.append(h("p", { class: "etat ko", role: "alert" }, e.message || "La liste des destinataires n’a pas pu être chargée."));
    } finally { chargementDestinataires = false; actualiserCibles(); }
  }

  async function charger() {
    vider(liste);
    try {
      const data = await api("/api/messages", { q: moi?.role === "administrateur" && afficherRetires.checked ? { archives: "1" } : undefined });
      const messages = Array.isArray(data.messages) ? data.messages : [];
      if (!messages.length) { liste.append(h("p", { class: "note" }, moi?.role === "administrateur" ? "Aucun message envoyé." : "Aucun message pour le moment.")); return; }
      if (moi?.role !== "administrateur" && Number(data.nonLus) > 0) liste.append(h("p", { class: "etat attention" }, `${data.nonLus} message(s) non lu(s).`));
      for (const m of messages) {
        const date = new Date(m.creeLe);
        const meta = `${m.auteur || "Administration"} · ${Number.isNaN(date.getTime()) ? "Date inconnue" : date.toLocaleString("fr-FR", { timeZone: "Africa/Dakar" })}`;
        const badgeTexte = moi?.role === "administrateur" ? (m.portee === "tous" ? "Diffusé à tous" : m.portee === "services" ? "Ciblé par service" : "Message ciblé") : (m.lu ? "Lu" : "Nouveau");
        const cible = m.portee === "services" ? `${Number(m.nombreServicesDestinataires || 0)} service(s)` : m.portee === "comptes" ? `${Number(m.nombreComptesDestinataires || 0)} compte(s)` : "Tous les comptes actifs";
        const carte = h("article", { class: `carte message-carte${!m.lu && moi?.role !== "administrateur" ? " message-non-lu" : " message-lu"}${m.priorite === "urgente" ? " message-urgent" : ""}` },
          h("div", { class: "message-entete" }, h("h3", {}, m.titre), h("span", { class: `badge${m.priorite === "urgente" ? " avertissement" : !m.lu && moi?.role !== "administrateur" ? " avertissement" : ""}` }, m.priorite === "urgente" ? `Urgent · ${badgeTexte}` : badgeTexte)),
          h("p", { class: "message-meta" }, meta),
          moi?.role === "administrateur" ? h("p", { class: "note" }, `${cible} · ${Number(m.nombreLectures || 0)} confirmation(s) de lecture`) : null,
          h("p", { class: "message-contenu" }, m.contenu),
        );
        if (!m.lu && moi?.role !== "administrateur") carte.append(h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: async () => {
          try { await api(`/api/messages/${encodeURIComponent(m.id)}/lu`, { methode: "POST", corps: {} }); await charger(); void actualiserCompteurs(); }
          catch (e) { alert(e.message || "Impossible de confirmer la lecture."); }
        } }, "Marquer comme lu")));
        if (moi?.role === "administrateur") {
          if (m.archive) carte.append(h("p", { class: "note" }, "Message retiré : il n’est plus visible chez les destinataires."));
          else carte.append(h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: async () => {
            if (!confirm(`Retirer le message « ${m.titre} » ? Il disparaîtra immédiatement chez tous les destinataires (l’historique est conservé).`)) return;
            try { await api(`/api/messages/${encodeURIComponent(m.id)}`, { methode: "DELETE" }); await charger(); }
            catch (e) { alert(e.message || "Impossible de retirer le message."); }
          } }, "Retirer ce message")));
        }
        liste.append(carte);
      }
    } catch (e) { liste.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Chargement des messages impossible.")); }
  }
  if (moi?.role === "administrateur") void chargerDestinataires();
  void charger();
}

// ---------- Sauvegarde métier depuis la base en ligne ----------
function vueSauvegarde() {
  const statut = h("div", { role: "status", "aria-live": "polite" });
  const bouton = h("button", { type: "button", onclick: async () => {
    bouton.disabled = true; vider(statut);
    try {
      const reponse = await api("/api/sauvegarde/export", { brut: true });
      if (!reponse.ok) {
        const erreur = await reponse.json().catch(() => ({}));
        throw new Error(erreur.message || "Export de sauvegarde refusé.");
      }
      const blob = await reponse.blob();
      const url = URL.createObjectURL(blob);
      const lien = h("a", { href: url, download: `fann-pointage-sauvegarde-${dateDakar()}.json`, hidden: true });
      document.body.append(lien); lien.click(); lien.remove(); URL.revokeObjectURL(url);
      statut.append(h("p", { class: "etat ok" }, "Copie des données métier téléchargée. Conservez-la dans un emplacement sécurisé."));
    } catch (e) { statut.append(h("p", { class: "etat ko", role: "alert" }, e.message || "Téléchargement impossible.")); }
    finally { bouton.disabled = false; }
  } }, "Télécharger une copie des données métier (JSON)");
  racine.append(
    h("h1", {}, "Sauvegarde en ligne"),
    h("section", { class: "carte" },
      h("h2", {}, "Données synchronisées"),
      h("p", {}, "Les fiches agents, affectations, plannings, pointages, absences, zones, classements et messages sont conservés dans PostgreSQL dès qu’une opération est confirmée par le serveur. Cela fonctionne depuis les téléphones comme depuis les ordinateurs connectés."),
      h("p", { class: "note" }, "Quand le réseau coupe, le poste partagé garde localement les pointages en attente jusqu’à leur synchronisation. Sur le téléphone d’un agent, un pointage n’est officiel qu’après confirmation du serveur : ne considérez pas un écran hors connexion comme une validation."),
    ),
    h("section", { class: "carte" },
      h("h2", {}, "Copie de secours à télécharger"),
      h("p", {}, "L’export contient les données métier utiles au suivi, dont les identifiants d’agents, affectations, plannings, pointages et annonces. Les mots de passe, jetons de session, secrets QR/badges, coordonnées GPS exactes, adresses, téléphones et photos sont exclus."),
      h("p", { class: "etat attention" }, "CONFIDENTIEL : téléchargez ce fichier uniquement sur un appareil protégé, ne le transmettez pas par messagerie non sécurisée et supprimez les copies temporaires après usage."),
      h("p", { class: "note" }, "Cet export JSON expurgé n’est pas restaurable et ne remplace pas la sauvegarde PostgreSQL complète, chiffrée et distante. Pour restaurer les données opérationnelles, utilisez le workflow de sauvegarde du serveur et testez la restauration sur une base isolée."),
      h("div", { class: "actions" }, bouton), statut,
    ),
  );
}

// ---------- Démarrage ----------
async function demarrer() {
  let modeServeur = null;
  try {
    const health = await fetch("/healthz", { cache: "no-store" });
    if (health.ok) modeServeur = (await health.json()).mode || null;
  } catch { /* si hors ligne, le cache sera examiné plus bas */ }
  try {
    moi = await api("/api/moi");
    localStorage.setItem("fann-pointage-moi-cache", JSON.stringify(moi));
  } catch {
    // Politique fail-closed : le cache d'identité n'est réutilisé que si le serveur
    // confirme explicitement le mode démo. Un mode inconnu ou PostgreSQL réel bloque
    // l'accès à l'interface privilégiée et efface le profil périmé.
    if (modeServeur !== "demo") {
      sessionStorage.removeItem("jeton");
      localStorage.removeItem("fann-pointage-moi-cache");
      moi = null;
      afficherConnexion();
      racine.prepend(h("p", { class: "etat attention", role: "status" },
        "Le serveur n’a pas pu confirmer votre session. Reconnectez-vous lorsque la connexion est rétablie."));
      return;
    }
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem("fann-pointage-moi-cache") || "null"); } catch { cache = null; }
    if (!sessionStorage.getItem("jeton") || !cache || !["administrateur", "responsable"].includes(cache.role)) { afficherConnexion(); return; }
    moi = cache;
  }
  btnDeconnexion.hidden = false;
  if (moi.doitChangerMotDePasse) { arreterCompteurs(); afficherChangementMotDePasse(true); return; }
  if (moi.mode === "catalogue-postgres") {
    document.body.classList.add("mode-postgres");
    const banniere = document.querySelector(".banniere-demo");
    if (banniere) banniere.hidden = true;
    const sousTitre = document.querySelector(".entete small");
    if (sousTitre) sousTitre.textContent = "CHNUF · Données persistantes PostgreSQL";
  }
  if (!location.hash) location.hash = "#/";
  naviguer();
  demarrerCompteurs();
  void synchroniserFileLocale();
}
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("/sw.js").catch(() => {});
// La bannière « démonstration » ne doit jamais apparaître sur une installation réelle, y compris avant la connexion.
fetch("/healthz", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((s) => {
  if (s?.mode && s.mode !== "demo") { const b = document.querySelector(".banniere-demo"); if (b) b.hidden = true; }
}).catch(() => { /* hors ligne : la bannière reste telle quelle */ });
if (sessionStorage.getItem("jeton")) demarrer(); else afficherConnexion();
