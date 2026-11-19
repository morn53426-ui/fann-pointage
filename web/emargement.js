// FANN POINTAGE : vue « Feuilles d'émargement par service » (aperçu, impression, export Excel, génération des plannings manquants).
// Extraite de app.js : les fonctions communes de l'application (h, vider, api, impression, dates) sont fournies par injection,
// ce module n'importe donc rien depuis app.js. Comme le reste de l'interface, il n'injecte jamais de HTML (nœuds DOM uniquement).
const CSSI_DEFAUT = "Mme Paulette Flavine MENDY";
function lireStockage(cle, repli) { try { return localStorage.getItem(cle) || repli; } catch { return repli; } }
function ecrireStockage(cle, valeur) { try { localStorage.setItem(cle, valeur); } catch { /* stockage indisponible : la valeur ne sera pas retenue */ } }
function dateFr(cleDate) { return `${cleDate.slice(8, 10)}/${cleDate.slice(5, 7)}/${cleDate.slice(0, 4)}`; }
function finDuMois(cleDate) { const [a, m] = cleDate.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); }

export function creerVueEmargement({ h, vider, api, racine, ouvrirPageImpression, dateDakar, datePlusJours }) {
  function tableauEmargement(e, f, indices) {
    const jours = indices.map((i) => e.jours[i]);
    const entete1 = h("tr", {}, h("th", { rowspan: 2 }, "PRÉNOMS"), h("th", { rowspan: 2 }, "NOMS"), h("th", { rowspan: 2 }, "HEURES"),
      ...jours.map((j) => h("th", { colspan: 2, class: "emarg-debut-jour" }, `${j.jour.toUpperCase()} ${j.libelle}`)));
    const entete2 = h("tr", {}, ...jours.flatMap(() => [h("th", { class: "emarg-sous emarg-debut-jour" }, "Arrivée"), h("th", { class: "emarg-sous" }, "Descente")]));
    const corps = h("tbody", {}, ...f.agents.map((a) => h("tr", {},
      h("td", { class: "emarg-prenom" }, a.prenom), h("td", { class: "emarg-nom" }, a.nom), h("td", { class: "emarg-heures" }, a.heures),
      ...indices.flatMap((i) => {
        const etat = a.jours[i];
        if (etat === "poste") return [h("td", { class: "emarg-case emarg-debut-jour" }), h("td", { class: "emarg-case" })];
        if (etat === "repos") return [h("td", { class: "emarg-case grise emarg-repos emarg-debut-jour", colspan: 2 }, "R")];
        return [h("td", { class: "emarg-case grise emarg-debut-jour" }), h("td", { class: "emarg-case grise" })];
      }))));
    return h("div", { class: "emarg-defilement" }, h("table", { class: "emarg-table" }, h("thead", {}, entete1, entete2), corps));
  }

  function feuilleEmargement(e, f, cssi) {
    return h("section", { class: "feuille-emargement", "aria-label": `Feuille d'émargement ${f.service}` },
      h("h2", { class: "emarg-titre" }, "FEUILLE D'ÉMARGEMENT DES BRANCARDIERS"),
      h("div", { class: "emarg-infos" },
        h("p", { class: "emarg-service" }, h("span", { class: "emarg-etiquette" }, "Service"), f.service.toUpperCase()),
        h("p", { class: "emarg-semaine" }, h("span", { class: "emarg-etiquette" }, `Semaine ${e.numeroSemaine}`), `du ${dateFr(e.debut)} au ${dateFr(e.fin)}`)),
      tableauEmargement(e, f, [0, 1, 2, 3]),
      tableauEmargement(e, f, [4, 5, 6]),
      h("p", { class: "emarg-legende" }, h("strong", {}, "R"), " = jour de repos   ·   case grisée = pas de service ce jour   ·   signer dans chaque case blanche, à l'arrivée et à la descente"),
      h("div", { class: "emarg-signatures" },
        h("div", { class: "emarg-signature" }, h("p", { class: "emarg-qui" }, "Le Responsable du service"), h("div", { class: "emarg-trait" })),
        h("div", { class: "emarg-signature" }, h("p", { class: "emarg-qui" }, "La CSSI"), h("p", { class: "emarg-nom-cssi" }, cssi), h("div", { class: "emarg-trait" }))));
  }

  return async function vueEmargement() {
    const cssi = h("input", { id: "emarg-cssi", type: "text", maxlength: 80, value: lireStockage("fann-emarg-cssi", CSSI_DEFAUT) });
    const date = h("input", { id: "emarg-date", type: "date", required: true, value: dateDakar() });
    const filtre = h("select", { id: "emarg-service" }, h("option", { value: "" }, "Tous les services"));
    const statut = h("div", { role: "status", "aria-live": "polite" });
    const zone = h("div", { class: "zone-imprimable emarg-zone" });
    const planification = h("div", { class: "hors-impression" });
    let courant = null;

    const decaler = (jours) => { date.value = datePlusJours(date.value || dateDakar(), jours); void charger(); };
    const imprimer = () => {
      vider(statut);
      if (!zone.querySelector(".feuille-emargement")) { statut.append(h("p", { class: "etat ko", role: "alert" }, "Aucune feuille à imprimer.")); return; }
      if (!ouvrirPageImpression(`Émargement ${courant ? dateFr(courant.debut) : ""}`, zone)) window.print();
    };
    const exporter = async () => {
      vider(statut);
      try {
        const r = await api("/api/emargement", { q: { date: date.value, format: "xlsx", serviceId: filtre.value, cssi: cssi.value } });
        const octets = Uint8Array.from(atob(r.contenuBase64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([octets], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        const lien = h("a", { href: url, download: r.nomFichier });
        document.body.append(lien); lien.click(); lien.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
        statut.append(h("p", { class: "etat ok" }, `Classeur Excel prêt : ${r.nomFichier} (un onglet par service).`));
      } catch (err) { statut.append(h("p", { class: "etat ko", role: "alert" }, err.message || "Export impossible.")); }
    };

    racine.append(h("h1", {}, "Feuilles d'émargement par service"),
      h("form", { class: "carte form-creation-badge hors-impression", onsubmit: (ev) => { ev.preventDefault(); void charger(); } },
        h("div", { class: "form-badge-grille" },
          h("div", {}, h("label", { for: "emarg-date" }, "Jour de la semaine à afficher"), date),
          h("div", {}, h("label", { for: "emarg-service" }, "Service"), filtre),
          h("div", { class: "champ-large" }, h("label", { for: "emarg-cssi" }, "Nom de la CSSI (imprimé en bas de feuille)"), cssi)),
        h("div", { class: "actions" },
          h("button", { type: "button", class: "secondaire", onclick: () => decaler(-7) }, "← Semaine précédente"),
          h("button", { type: "submit" }, "Afficher"),
          h("button", { type: "button", class: "secondaire", onclick: () => decaler(7) }, "Semaine suivante →")),
        h("div", { class: "actions" },
          h("button", { type: "button", onclick: imprimer }, "Imprimer / PDF"),
          h("button", { type: "button", class: "secondaire", onclick: () => void exporter() }, "Exporter en Excel")),
        h("p", { class: "note" }, "Les feuilles reprennent le registre papier : une page par service, Arrivée et Descente à signer chaque jour, « R » pour les jours de repos. Sur téléphone, « Imprimer / PDF » ouvre une page où vous pouvez imprimer ou enregistrer en PDF. L'export Excel contient un onglet par service (ou le seul service choisi)."),
        statut),
      planification, zone);
    cssi.addEventListener("change", () => { ecrireStockage("fann-emarg-cssi", cssi.value.trim() || CSSI_DEFAUT); void charger(); });
    filtre.addEventListener("change", () => void charger());
    await charger();

    async function charger() {
      vider(statut); vider(planification);
      try {
        const e = await api("/api/emargement", { q: { date: date.value || dateDakar() } });
        courant = e;
        const choisi = filtre.value;
        filtre.replaceChildren(h("option", { value: "" }, "Tous les services"), ...e.services.map((s) => h("option", { value: s.serviceId, selected: s.serviceId === choisi }, s.service)));
        const nom = cssi.value.trim() || CSSI_DEFAUT;
        const visibles = e.services.filter((s) => !filtre.value || s.serviceId === filtre.value);
        zone.replaceChildren(...(visibles.length ? visibles.map((s) => feuilleEmargement(e, s, nom)) : [h("p", { class: "etat ko" }, "Aucun agent actif à afficher. Importez le registre ou créez des agents.")]));
        for (const s of visibles) if (s.agents.some((a) => !a.planifie)) planification.append(panneauPlanification(e, s));
      } catch (err) { zone.replaceChildren(h("p", { class: "etat ko", role: "alert" }, err.message || "Chargement impossible.")); }
    }

    function panneauPlanification(e, s) {
      const sans = s.agents.filter((a) => !a.planifie);
      const fin = h("input", { type: "date", value: finDuMois(e.fin), "aria-label": "Planifier jusqu'au" });
      const retour = h("div", { role: "status", "aria-live": "polite" });
      const choix = sans.map((a, i) => {
        if (a.regime === "garde") return h("select", { "aria-label": `Groupe de garde de ${a.prenom} ${a.nom}` },
          h("option", { value: "0", selected: i % 3 === 0 }, "Groupe A (garde le lundi)"), h("option", { value: "1", selected: i % 3 === 1 }, "Groupe B (garde le mardi)"), h("option", { value: "2", selected: i % 3 === 2 }, "Groupe C (garde le mercredi)"));
        if (a.regime === "urgences") return h("select", { "aria-label": `Équipe de ${a.prenom} ${a.nom}` },
          h("option", { value: "" }, "Équipe à choisir…"), h("option", { value: "jour" }, "Jour 8 h–20 h"), h("option", { value: "nuit" }, "Nuit 20 h–8 h"));
        if (a.regime === "mobil") {
          const eq = h("select", { "aria-label": `Équipe Mobil de ${a.prenom} ${a.nom}`, "data-mobil-equipe": "" },
            h("option", { value: "", selected: true }, "Choisir jour ou nuit…"), h("option", { value: "jour" }, "Jour 08 h–16 h"), h("option", { value: "nuit" }, "Garde : semaine 16 h–08 h / week-end et férié 08 h–08 h (+56 h repos)"));
          const groupe = h("select", { "aria-label": `Groupe de nuit Mobil de ${a.prenom} ${a.nom}`, "data-mobil-groupe": "" },
            h("option", { value: "", selected: true }, "Choisir le groupe A, B ou C…"), h("option", { value: "A" }, "Groupe A · J"), h("option", { value: "B" }, "Groupe B · J+1"), h("option", { value: "C" }, "Groupe C · J+2"));
          const blocGroupe = h("div", {}, groupe);
          const we = h("input", { type: "checkbox", "data-mobil-weekends": "" });
          const hf = h("input", { type: "checkbox", "data-mobil-feries": "" });
          const blocExceptions = h("div", { class: "note" }, h("label", {}, we, " Autoriser samedi/dimanche"), h("label", {}, hf, " Autoriser les jours fériés"));
          const bloc = h("div", {}, eq, blocGroupe, blocExceptions);
          const maj = () => { blocGroupe.hidden = eq.value !== "nuit"; blocExceptions.hidden = eq.value !== "jour"; };
          eq.addEventListener("change", maj); maj();
          return bloc;
        }
        return null;
      });
      const lancer = async (bouton) => {
        bouton.disabled = true; vider(retour);
        const erreurs = []; let faits = 0;
        for (let i = 0; i < sans.length; i++) {
          const a = sans[i], sel = choix[i];
          try {
            if (a.regime === "urgences" && !sel.value) throw new Error("choisissez l'équipe jour ou nuit");
            const corps = { agentId: a.agentId, dateDebut: a.regime === "garde" ? datePlusJours(e.debut, Number(sel.value)) : e.debut, dateFin: fin.value };
            if (a.regime === "urgences") corps.equipeUrgences = sel.value;
            if (a.regime === "mobil") {
              const eq = sel.querySelector("[data-mobil-equipe]")?.value;
              const groupe = sel.querySelector("[data-mobil-groupe]")?.value;
              if (!eq) throw new Error("choisissez l'équipe Mobil de jour ou de nuit");
              if (eq === "nuit" && !groupe) throw new Error("choisissez le groupe de rotation nocturne A, B ou C");
              corps.equipeMobil = eq;
              if (eq === "nuit") corps.groupeNuitMobil = groupe;
              if (eq === "jour") {
                corps.inclureWeekEndsMobil = !!sel.querySelector("[data-mobil-weekends]")?.checked;
                corps.inclureJoursFeriesMobil = !!sel.querySelector("[data-mobil-feries]")?.checked;
              }
            }
            await api("/api/plannings", { methode: "POST", corps });
            faits++;
          } catch (err) { erreurs.push(`${a.prenom} ${a.nom} : ${err.message || "échec"}`); }
        }
        retour.append(h("p", { class: erreurs.length ? "etat ko" : "etat ok", role: erreurs.length ? "alert" : "status" }, `${faits} agent(s) planifié(s).${erreurs.length ? ` ${erreurs.length} échec(s) : ${erreurs.join(" ; ")}` : ""}`));
        bouton.disabled = false;
        if (faits) await charger();
      };
      const bouton = h("button", { type: "button", onclick: () => void lancer(bouton) }, "Générer le planning");
      return h("details", { class: "carte", open: true },
        h("summary", {}, `${s.service} : ${sans.length} agent(s) sans planning cette semaine`),
        h("p", { class: "note" }, "Sans planning, les cases restent grisées et un pointage serait classé « à vérifier ». Garde classique : 24 h puis 48 h de repos. Mobil jour : 08 h–16 h du lundi au vendredi, sans samedi ni dimanche (hors jours fériés par défaut). Mobil garde : 16 h–08 h les jours ouvrés non fériés ; 08 h–08 h (24 h) si la garde tombe un samedi, un dimanche ou un jour férié, suivie d’au moins 56 h de repos. Les groupes A, B et C décalent les premières dates de garde."),
        ...sans.map((a, i) => h("div", { class: "emarg-ligne-plan" }, h("span", {}, `${a.prenom} ${a.nom} · ${a.heures}`), choix[i] ?? h("span", { class: "note" }, "Service général"))),
        h("div", { class: "form-badge-grille" }, h("div", {}, h("label", {}, "Planifier jusqu'au"), fin)),
        h("div", { class: "actions" }, bouton), retour);
    }
  };
}
