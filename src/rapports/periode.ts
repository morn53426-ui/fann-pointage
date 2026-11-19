import { addDays, isoWeekday, parseCle } from "../shared/civil.ts";
import { dakarDateTime, dakarParts } from "../shared/time.ts";

export type TypeRapport = "jour" | "semaine" | "mois";
export interface PeriodeRapport { type: TypeRapport; debut: Date; fin: Date; libelle: string }

/** Période locale (Africa/Dakar) : jour civil, semaine du lundi au dimanche, ou mois civil. Fin exclue. */
export function periodePour(type: TypeRapport, dateCle: string): PeriodeRapport {
  const d = parseCle(dateCle);
  const at = (c: { year: number; month: number; day: number }) => dakarDateTime(c.year, c.month, c.day);
  if (type === "jour") return { type, debut: at(d), fin: at(addDays(d, 1)), libelle: dateCle };
  if (type === "semaine") {
    const lundi = addDays(d, -(isoWeekday(d) - 1));
    return { type, debut: at(lundi), fin: at(addDays(lundi, 7)), libelle: `semaine du ${dakarIso(at(lundi))}` };
  }
  const premier = { year: d.year, month: d.month, day: 1 };
  const suivant = d.month === 12 ? { year: d.year + 1, month: 1, day: 1 } : { year: d.year, month: d.month + 1, day: 1 };
  return { type, debut: at(premier), fin: at(suivant), libelle: `${d.year}-${String(d.month).padStart(2, "0")}` };
}

const p2 = (n: number) => String(n).padStart(2, "0");
export const dakarIso = (d: Date): string => { const p = dakarParts(d); return `${p.year}-${p2(p.month)}-${p2(p.day)}`; };
export const dakarLocal = (d: Date | null): string => {
  if (!d) return "";
  const p = dakarParts(d);
  return `${p.year}-${p2(p.month)}-${p2(p.day)} ${p2(p.hour)}:${p2(p.minute)}`;
};
