// Page d'impression autonome : affiche le document préparé par l'application (feuilles d'émargement, badges) et propose l'impression.
// Le contenu provient du stockage local écrit par l'application elle-même ; il est inséré comme nœuds DOM, jamais exécuté.
const CLE = "fann-impression";
const zone = document.getElementById("document");
let donnees = null;
try { donnees = JSON.parse(localStorage.getItem(CLE) || "null"); } catch { donnees = null; }
if (!donnees || typeof donnees.xml !== "string") {
  zone.textContent = "Aucun document à imprimer. Retournez dans l'application et relancez l'impression.";
} else {
  if (typeof donnees.titre === "string" && donnees.titre) document.title = donnees.titre.slice(0, 120);
  // Document XHTML bien formé produit par XMLSerializer : analysé comme XML (un <td/> vide n'est pas ambigu), jamais exécuté.
  const doc = new DOMParser().parseFromString(donnees.xml, "application/xhtml+xml");
  if (doc.querySelector("parsererror")) {
    zone.textContent = "Le document préparé est illisible. Retournez dans l'application et relancez l'impression.";
  } else {
    for (const n of doc.querySelectorAll(".apercu-impression-actions, .hors-impression, script")) n.remove();
    zone.append(document.importNode(doc.documentElement, true));
  }
}
// Sur iPhone et dans une application installée, window.print() peut ne rien faire, sans erreur ni message.
// Si aucune fenêtre d'impression ne semble s'ouvrir, on affiche donc la marche à suivre à la place d'un bouton muet.
const aide = document.getElementById("aide-impression");
let impressionLancee = false;
window.addEventListener("beforeprint", () => { impressionLancee = true; });
function afficherAide() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const etapes = ios
    ? "iPhone : appuyez sur le bouton Partager (carré avec une flèche), puis « Imprimer ». Pour un fichier PDF : sur l'aperçu, écartez deux doigts pour agrandir la page, puis Partager → « Enregistrer dans Fichiers »."
    : "Android : menu ⋮ du navigateur → Partager → Imprimer, puis choisissez « Enregistrer au format PDF ».";
  aide.textContent = `Si la fenêtre d'impression ne s'ouvre pas : ${etapes}${standalone ? " Vous êtes dans l'application installée : si cela ne fonctionne pas, ouvrez cette page dans Safari ou Chrome." : ""} Choisissez le format A4 et l'échelle 100 %.`;
  aide.hidden = false;
}
const bouton = document.getElementById("imprimer");
window.addEventListener("afterprint", () => { impressionLancee = true; });
bouton.addEventListener("click", () => {
  impressionLancee = false;
  aide.hidden = true;
  bouton.setAttribute("aria-busy", "true");
  const fin = () => bouton.removeAttribute("aria-busy");
  try { window.print(); } catch { fin(); afficherAide(); return; }
  setTimeout(() => { fin(); if (!impressionLancee) afficherAide(); }, 1200);
});
// Sur écran tactile, window.print() est souvent sans effet : la marche à suivre est visible d'emblée, sans attendre un clic muet.
if (window.matchMedia("(pointer: coarse)").matches && donnees && typeof donnees.xml === "string") afficherAide();
document.getElementById("retour").addEventListener("click", (ev) => {
  if (document.referrer && history.length > 1) { ev.preventDefault(); history.back(); }
});

// ----- PDF généré sur l'appareil : fiable sur iPhone, où window.print() ne réagit souvent pas -----
// La bibliothèque (html2pdf, licence MIT, copie locale) est chargée seulement au clic. Chaque feuille est capturée avec les règles
// d'impression appliquées temporairement, puis placée sur une page A4. Le PDF est ensuite ouvert ou partagé (Fichiers, Imprimer…).
function chargerScript(src) {
  return new Promise((ok, ko) => {
    if (window.html2pdf) return ok();
    const s = document.createElement("script");
    s.src = src; s.onload = () => ok(); s.onerror = () => ko(new Error("chargement"));
    document.head.append(s);
  });
}
function appliquerReglesImpression() {
  // Feuille séparée (et non insertRule) : la capture recharge les feuilles de style depuis leur adresse, pas depuis le CSSOM.
  const lien = document.createElement("link");
  lien.rel = "stylesheet"; lien.href = "/pdf-capture.css";
  const prete = new Promise((ok) => { lien.onload = lien.onerror = () => ok(); });
  document.head.append(lien);
  return { prete, retirer: () => lien.remove() };
}
const boutonPdf = document.getElementById("pdf");
const sortiePdf = document.getElementById("pdf-resultat");
const voile = document.getElementById("pdf-etat");
boutonPdf.addEventListener("click", async () => {
  sortiePdf.hidden = true; sortiePdf.replaceChildren();
  if (!donnees || typeof donnees.xml !== "string") { sortiePdf.textContent = "Aucun document à convertir."; sortiePdf.hidden = false; return; }
  voile.hidden = false;
  let retirer = () => {}; let conteneur = null;
  try {
    await chargerScript("/vendor/html2pdf.bundle.min.js");
    const regles = appliquerReglesImpression(); retirer = regles.retirer; await regles.prete;
    conteneur = document.createElement("div");
    conteneur.className = "zone-imprimable";
    Object.assign(conteneur.style, { position: "fixed", left: "-10000px", top: "0", width: "194mm", background: "#fff" });
    document.body.append(conteneur);
    const source = zone.querySelectorAll(".feuille-badges, .feuille-emargement, .affiche-qr");
    const feuilles = source.length ? [...source] : [zone.firstElementChild || zone];
    const vide = document.createElement("canvas"); vide.width = 2; vide.height = 2;
    const pdf = await window.html2pdf().set({ margin: 0, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } }).from(vide, "canvas").toPdf().get("pdf");
    for (const f of feuilles) {
      const copie = f.cloneNode(true); conteneur.replaceChildren(copie);
      await Promise.all([...copie.querySelectorAll("img")].map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })));
      const canvas = await window.html2pdf().set({ html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false } }).from(copie).toCanvas().get("canvas");
      let w = 194, h = (canvas.height / canvas.width) * w;
      if (h > 281) { h = 281; w = (canvas.width / canvas.height) * h; }
      pdf.addPage("a4", "portrait");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (210 - w) / 2, 8, w, h);
    }
    pdf.deletePage(1);
    const nom = `${(donnees.titre || "document").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "document"}.pdf`;
    const blob = pdf.output("blob");
    const fichier = new File([blob], nom, { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const ouvrir = document.createElement("a"); ouvrir.href = url; ouvrir.target = "_blank"; ouvrir.rel = "noopener"; ouvrir.textContent = "Ouvrir le PDF"; ouvrir.className = "bouton-lien";
    const telecharger = document.createElement("a"); telecharger.href = url; telecharger.download = nom; telecharger.textContent = "Télécharger"; telecharger.className = "bouton-lien";
    sortiePdf.append(`PDF prêt (${feuilles.length} page${feuilles.length > 1 ? "s" : ""}). `, ouvrir, telecharger);
    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      const partager = document.createElement("button"); partager.type = "button"; partager.textContent = "Partager / Enregistrer / Imprimer";
      partager.addEventListener("click", () => { navigator.share({ files: [fichier], title: nom }).catch(() => {}); });
      sortiePdf.append(partager);
    }
  } catch {
    sortiePdf.textContent = "Impossible de créer le PDF sur cet appareil (mémoire insuffisante ?). Essayez avec moins de pages, ou depuis un ordinateur.";
  } finally {
    retirer(); conteneur?.remove(); voile.hidden = true; sortiePdf.hidden = false;
  }
});
