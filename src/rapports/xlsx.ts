// Écriture minimale d'un classeur .xlsx (Office Open XML) sans dépendance externe : feuilles, fusions, largeurs, styles fixes.
// Le conteneur ZIP est écrit à la main (méthode « deflate », CRC-32 de node:zlib).
import { crc32, deflateRawSync } from "node:zlib";

/** Styles disponibles (index dans cellXfs). */
export const STYLE = { normal: 0, titre: 1, entete: 2, texte: 3, nom: 4, grise: 5, centre: 6, gras: 7, note: 8 } as const;
export interface CelluleXlsx { v?: string | number; s?: number }
export interface FeuilleXlsx { nom: string; largeurs: number[]; lignes: CelluleXlsx[][]; fusions?: string[]; paysage?: boolean; /** Hauteur en points, clé = numéro de ligne (1 = première). */ hauteurs?: Record<number, number> }

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

export function colonne(index: number): string { // 0 → A, 26 → AA
  let n = index + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Nom d'onglet Excel valide : 31 caractères max, sans []:*?/\, unique. */
export function nomOnglet(brut: string, deja: Set<string>): string {
  const base = (brut.replace(/[\[\]:*?/\\]/g, "-").trim() || "Feuille").slice(0, 28);
  let nom = base, i = 2;
  while (deja.has(nom.toLowerCase())) nom = `${base.slice(0, 28 - String(i).length - 1)}-${i++}`;
  deja.add(nom.toLowerCase());
  return nom;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="14"/><name val="Arial"/></font>
<font><b/><sz val="10"/><name val="Arial"/></font>
<font><i/><sz val="9"/><name val="Arial"/></font>
</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function xmlFeuille(f: FeuilleXlsx): string {
  const lignes = f.lignes.map((ligne, r) => {
    const cellules = ligne.map((c, i) => {
      const ref = `${colonne(i)}${r + 1}`;
      const s = c.s ? ` s="${c.s}"` : "";
      if (c.v === undefined || c.v === "") return `<c r="${ref}"${s}/>`;
      if (typeof c.v === "number") return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
    }).join("");
    const ht = f.hauteurs?.[r + 1] ? ` ht="${f.hauteurs[r + 1]}" customHeight="1"` : "";
    return `<row r="${r + 1}"${ht}>${cellules}</row>`;
  }).join("");
  const cols = f.largeurs.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const fusions = f.fusions?.length ? `<mergeCells count="${f.fusions.length}">${f.fusions.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${lignes}</sheetData>${fusions}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${f.paysage === false ? "portrait" : "landscape"}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

function zip(fichiers: { chemin: string; contenu: Buffer }[]): Buffer {
  const parties: Buffer[] = [], central: Buffer[] = [];
  let decalage = 0;
  for (const f of fichiers) {
    const nom = Buffer.from(f.chemin, "utf8"), comp = deflateRawSync(f.contenu), crc = crc32(f.contenu);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(8, 8);
    loc.writeUInt16LE(0, 10); loc.writeUInt16LE(0x21, 12); // 1980-01-01
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(f.contenu.length, 22); loc.writeUInt16LE(nom.length, 26);
    parties.push(loc, nom, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(f.contenu.length, 24);
    c.writeUInt16LE(nom.length, 28); c.writeUInt32LE(decalage, 42);
    central.push(c, nom);
    decalage += loc.length + nom.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(fichiers.length, 8); fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(centralBuf.length, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...parties, centralBuf, fin]);
}

export function construireXlsx(feuilles: FeuilleXlsx[]): Buffer {
  if (!feuilles.length) throw new Error("Aucune feuille à exporter.");
  const noms = new Set<string>();
  const onglets = feuilles.map((f) => ({ ...f, nom: nomOnglet(f.nom, noms) }));
  const t = (s: string) => Buffer.from(s, "utf8");
  const fichiers = [
    { chemin: "[Content_Types].xml", contenu: t(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${onglets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`) },
    { chemin: "_rels/.rels", contenu: t(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { chemin: "xl/workbook.xml", contenu: t(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${onglets.map((o, i) => `<sheet name="${esc(o.nom)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`) },
    { chemin: "xl/_rels/workbook.xml.rels", contenu: t(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${onglets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${onglets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { chemin: "xl/styles.xml", contenu: t(STYLES_XML) },
    ...onglets.map((o, i) => ({ chemin: `xl/worksheets/sheet${i + 1}.xml`, contenu: t(xmlFeuille(o)) })),
  ];
  return zip(fichiers);
}

/** Feuille « émargement » d'un service, au format du registre papier. */
export function feuilleEmargementXlsx(e: import("./emargement.ts").Emargement, f: import("./emargement.ts").FeuilleService, responsableCssi: string): FeuilleXlsx {
  const nbCol = 3 + 14;
  const vide = (n: number, s?: number): CelluleXlsx[] => Array.from({ length: n }, () => ({ s }));
  const ligneTexte = (v: string, s: number): CelluleXlsx[] => [{ v, s }, ...vide(nbCol - 1, s)];
  const dateFr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const lignes: CelluleXlsx[][] = [
    ligneTexte("FEUILLE D'ÉMARGEMENT DES BRANCARDIERS", STYLE.titre),
    ligneTexte(`Service : ${f.service.toUpperCase()} (Semaine ${e.numeroSemaine} : du ${dateFr(e.debut)} au ${dateFr(e.fin)})`, STYLE.titre),
    [],
    [{ v: "PRÉNOMS", s: STYLE.entete }, { v: "NOMS", s: STYLE.entete }, { v: "HEURES", s: STYLE.entete },
      ...e.jours.flatMap((j) => [{ v: `${j.jour.toUpperCase()} ${j.libelle}`, s: STYLE.entete }, { s: STYLE.entete }])],
    [{ s: STYLE.entete }, { s: STYLE.entete }, { s: STYLE.entete }, ...e.jours.flatMap(() => [{ v: "Arrivée", s: STYLE.entete }, { v: "Descente", s: STYLE.entete }])],
  ];
  const fusions = [`A1:${colonne(nbCol - 1)}1`, `A2:${colonne(nbCol - 1)}2`, "A4:A5", "B4:B5", "C4:C5"];
  e.jours.forEach((_, i) => fusions.push(`${colonne(3 + 2 * i)}4:${colonne(4 + 2 * i)}4`));
  const hauteurs: Record<number, number> = {};
  for (const a of f.agents) {
    const r = lignes.length + 1;
    hauteurs[r] = 32; // assez haut pour une signature manuscrite
    const cases: CelluleXlsx[] = [];
    a.jours.forEach((etat, i) => {
      if (etat === "poste") cases.push({ s: STYLE.texte }, { s: STYLE.texte });
      else {
        cases.push({ v: etat === "repos" ? "R" : "", s: STYLE.grise }, { s: STYLE.grise });
        if (etat === "repos") fusions.push(`${colonne(3 + 2 * i)}${r}:${colonne(4 + 2 * i)}${r}`);
      }
    });
    lignes.push([{ v: a.prenom, s: STYLE.texte }, { v: a.nom, s: STYLE.nom }, { v: a.heures, s: STYLE.centre }, ...cases]);
  }
  lignes.push([], [{ v: "Le Responsable du service", s: STYLE.gras }, ...vide(8), { v: "La CSSI", s: STYLE.gras }], [...vide(9), { v: responsableCssi, s: STYLE.normal }]);
  if (f.agents.some((a) => !a.planifie)) lignes.push([], [{ v: "Cases grisées sans « R » : planning non généré pour cet agent sur cette semaine.", s: STYLE.note }]);
  return { nom: f.service, largeurs: [22, 16, 14, ...Array(14).fill(10)], lignes, fusions, hauteurs };
}
