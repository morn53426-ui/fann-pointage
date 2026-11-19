// Dates civiles (année-mois-jour) à Dakar, sans heure. Sert aux calendriers (jours fériés, jours travaillés).
import { dakarParts } from "./time.ts";

export interface CivilDate { year: number; month: number; day: number }

const pad = (n: number) => String(n).padStart(2, "0");
export const cle = (d: CivilDate): string => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

export function parseCle(s: string): CivilDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Date invalide : ${s}`);
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  // L'année 0000 et les dates normalisées silencieusement par Date.UTC sont interdites.
  if (year < 1 || month < 1 || month > 12 || day < 1) throw new Error(`Date civile invalide : ${s}`);
  const bissextile = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const joursParMois = [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > joursParMois[month - 1]) throw new Error(`Date civile invalide : ${s}`);
  return { year, month, day };
}

export function addDays(d: CivilDate, n: number): CivilDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 1 = lundi ... 7 = dimanche */
export function isoWeekday(d: CivilDate): number {
  const w = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return w === 0 ? 7 : w;
}

export const civilDeInstant = (i: Date): CivilDate => {
  const p = dakarParts(i);
  return { year: p.year, month: p.month, day: p.day };
};

export function jours(from: CivilDate, to: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  for (let d = from; cle(d) <= cle(to); d = addDays(d, 1)) out.push(d);
  return out;
}
