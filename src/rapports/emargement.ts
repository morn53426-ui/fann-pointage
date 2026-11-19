// Feuilles d'émargement hebdomadaires par service (présentation du registre papier : Arrivée / Descente par jour).
// Fonction pure : aucune lecture de base ni d'horloge. Fuseau Africa/Dakar = UTC+0 toute l'année (pas d'heure d'été),
// comme le reste de l'application qui découpe les jours sur la date ISO UTC.

export type EtatJour = "poste" | "repos" | "ferme" | "non_planifie";

export interface AgentEmargement { id: string; prenom: string; nom: string; serviceId: string; regime: string; actif: boolean }
export interface PosteEmargement { agentId: string; debut: Date; fin?: Date; regime: string; type: string }
export interface LigneEmargement { agentId: string; prenom: string; nom: string; regime: string; heures: string; jours: EtatJour[]; planifie: boolean }
export interface FeuilleService { serviceId: string; service: string; agents: LigneEmargement[] }
export interface Emargement {
  debut: string; fin: string; numeroSemaine: number;
  jours: { date: string; jour: string; libelle: string }[];
  services: FeuilleService[];
}

const NOMS_JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const cle = (d: Date) => d.toISOString().slice(0, 10);

/** Ramène n'importe quelle date AAAA-MM-JJ au lundi de sa semaine. */
export function lundiDeLaSemaine(dateCle: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateCle)) throw new Error("Date invalide : utilisez AAAA-MM-JJ.");
  const d = new Date(`${dateCle}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || cle(d) !== dateCle) throw new Error("Date invalide : utilisez AAAA-MM-JJ.");
  const decalage = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - decalage);
  return cle(d);
}

function libelleHeures(regime: string, postes: PosteEmargement[]): string {
  if (regime === "general") return "SG 8h–16h";
  if (regime === "garde") return "GARDE 8h–8h";
  if (regime === "mobil") {
    const gardes = postes.filter((p) => p.type === "nuit");
    if (gardes.length) return gardes.some((p) => p.fin && p.fin.getTime() - p.debut.getTime() >= 24 * 3_600_000)
      ? "MOBIL GARDE 16h–8h / 8h–8h selon la date"
      : "MOBIL GARDE 16h–8h";
    return "MOBIL JOUR 8h–16h";
  }
  if (postes.some((p) => p.type === "nuit")) return "NUIT 20h–8h";
  if (postes.some((p) => p.type === "jour")) return "JOUR 8h–20h";
  return "URGENCES";
}

export function construireEmargement(entree: {
  dateDansLaSemaine: string;
  agents: AgentEmargement[];
  services: { id: string; nom: string }[];
  postes: PosteEmargement[];
}): Emargement {
  const lundi = lundiDeLaSemaine(entree.dateDansLaSemaine);
  const base = new Date(`${lundi}T00:00:00.000Z`);
  const dates = NOMS_JOURS.map((_, i) => { const d = new Date(base); d.setUTCDate(base.getUTCDate() + i); return cle(d); });
  const jours = dates.map((date, i) => ({ date, jour: NOMS_JOURS[i]!, libelle: `${date.slice(8, 10)}/${date.slice(5, 7)}` }));
  // Rang du lundi dans son mois : le lundi 12/10 est le 2e lundi d'octobre → « Semaine 2 » (comme sur la feuille papier).
  const numeroSemaine = Math.ceil(Number(lundi.slice(8, 10)) / 7);
  const parAgent = new Map<string, PosteEmargement[]>();
  for (const p of entree.postes) {
    if (!dates.includes(cle(p.debut))) continue;
    const liste = parAgent.get(p.agentId) ?? []; liste.push(p); parAgent.set(p.agentId, liste);
  }
  const feuilles: FeuilleService[] = [];
  for (const s of entree.services) {
    const agents = entree.agents.filter((a) => a.actif && a.serviceId === s.id).map((a): LigneEmargement => {
      const postes = parAgent.get(a.id) ?? [];
      const jourPoste = new Set(postes.map((p) => cle(p.debut)));
      const planifie = postes.length > 0;
      const etat = (date: string): EtatJour => {
        if (!planifie) return "non_planifie";
        if (jourPoste.has(date)) return "poste";
        return a.regime === "general" ? "ferme" : "repos";
      };
      return { agentId: a.id, prenom: a.prenom, nom: a.nom, regime: a.regime, heures: libelleHeures(a.regime, postes), jours: dates.map(etat), planifie };
    });
    if (agents.length) feuilles.push({ serviceId: s.id, service: s.nom, agents });
  }
  feuilles.sort((x, y) => x.service.localeCompare(y.service, "fr"));
  return { debut: dates[0]!, fin: dates[6]!, numeroSemaine, jours, services: feuilles };
}
