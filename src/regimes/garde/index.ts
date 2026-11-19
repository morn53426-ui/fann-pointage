// RÉGIME B : GARDE CLASSIQUE (08 h -> 08 h le lendemain, puis 48 h de repos). Indépendant des autres régimes.
import { evaluerPresence, PARAMS_PRESENCE_DEFAUT } from "../../shared/presence.ts";
import type { ParamsPresence } from "../../shared/presence.ts";
import { dakarParts } from "../../shared/time.ts";
import { ErreurRegime, MS_HEURE, posteId } from "../../shared/types.ts";
import type { Conflit, Periode, Poste } from "../../shared/types.ts";

export const DUREE_GARDE_H = 24;
export const REPOS_H = 48;
export const CYCLE_H = DUREE_GARDE_H + REPOS_H; // 72 h : garde lundi 08 h, prochaine jeudi 08 h

function exigerGarde(p: Poste): void {
  if (p.regime !== "garde" || p.type !== "garde") throw new ErreurRegime("regime_invalide", `Poste ${p.posteId} hors garde classique`);
}

/** Crée une garde standard (début à 08 h, Africa/Dakar). Pas de lien avec le calendrier des jours fériés. */
export function creerGarde(debut: Date): Poste {
  const p = dakarParts(debut);
  if (p.hour !== 8 || p.minute !== 0 || p.second !== 0) throw new ErreurRegime("horaire_invalide", "Une garde standard commence à 08 h 00");
  const fin = new Date(debut.getTime() + DUREE_GARDE_H * MS_HEURE);
  return { posteId: posteId("garde", "garde", debut), regime: "garde", type: "garde", debut, fin };
}

export function genererCycleGardes(premiereDebut: Date, nombre: number): Poste[] {
  return Array.from({ length: nombre }, (_, i) => creerGarde(new Date(premiereDebut.getTime() + i * CYCLE_H * MS_HEURE)));
}

/** Repos de 48 h à partir de la fin (réelle si connue, sinon prévue). */
export function periodeRepos(garde: Poste, finReelle?: Date): Periode {
  exigerGarde(garde);
  const debut = finReelle ?? garde.fin;
  return { debut, fin: new Date(debut.getTime() + REPOS_H * MS_HEURE) };
}

export function estEnRepos(instant: Date, gardes: readonly Poste[]): boolean {
  return gardes.some((g) => { const r = periodeRepos(g); return instant >= r.debut && instant < r.fin; });
}

/** Vérifie les gardes d'UN agent : chevauchements et repos de 48 h. */
export function verifierGardes(gardes: readonly Poste[], finsReelles: ReadonlyMap<string, Date> = new Map()): Conflit[] {
  gardes.forEach(exigerGarde);
  const tri = [...gardes].sort((a, b) => a.debut.getTime() - b.debut.getTime());
  const out: Conflit[] = [];
  for (let i = 0; i + 1 < tri.length; i++) {
    const a = tri[i], b = tri[i + 1];
    if (b.debut < a.fin) {
      out.push({ code: "chevauchement", gravite: "erreur", message: "Deux gardes se chevauchent", posteIds: [a.posteId, b.posteId] });
      continue;
    }
    const repos = periodeRepos(a, finsReelles.get(a.posteId));
    if (b.debut < repos.fin) {
      out.push({ code: "repos_insuffisant", gravite: "erreur", message: "Repos de 48 h non respecté", posteIds: [a.posteId, b.posteId] });
    }
  }
  return out;
}

export const evaluerPresenceGarde = (
  poste: Poste,
  pointages: { arrivee?: Date | null; depart?: Date | null },
  maintenant: Date,
  params: ParamsPresence = PARAMS_PRESENCE_DEFAUT,
) => { exigerGarde(poste); return evaluerPresence(poste, pointages, maintenant, params); };
