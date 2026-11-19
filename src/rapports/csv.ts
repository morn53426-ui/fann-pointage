// Export CSV ouvrable dans Excel (séparateur « ; », BOM UTF-8, CRLF) avec protection contre l'injection de formules.
export interface Colonne { cle: string; titre: string }

function cellule(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" || typeof v === "boolean" ? String(v) : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // neutralise =, +, -, @
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function versCsv(colonnes: readonly Colonne[], lignes: readonly Record<string, unknown>[]): string {
  const entete = colonnes.map((c) => cellule(c.titre)).join(";");
  const corps = lignes.map((l) => colonnes.map((c) => cellule(l[c.cle])).join(";"));
  return "\uFEFF" + [entete, ...corps].join("\r\n") + "\r\n";
}
