import { inflateRawSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { construireEmargement, lundiDeLaSemaine } from "./emargement.ts";
import { construireXlsx, feuilleEmargementXlsx, nomOnglet } from "./xlsx.ts";

const services = [{ id: "s2", nom: "Cardiologie médicale" }, { id: "s1", nom: "CTCV" }, { id: "s3", nom: "Vide" }];
const agents = [
  { id: "a1", prenom: "Famara", nom: "DIEME", serviceId: "s1", regime: "garde", actif: true },
  { id: "a2", prenom: "Birane", nom: "NDAW", serviceId: "s1", regime: "general", actif: true },
  { id: "a3", prenom: "Thierno", nom: "DIALLO", serviceId: "s2", regime: "general", actif: true },
  { id: "a4", prenom: "Ancien", nom: "AGENT", serviceId: "s1", regime: "garde", actif: false },
];
const d = (iso: string) => new Date(`${iso}T08:00:00.000Z`);

test("le lundi de la semaine est trouvé depuis n'importe quel jour", () => {
  assert.equal(lundiDeLaSemaine("2026-10-18"), "2026-10-12"); // dimanche
  assert.equal(lundiDeLaSemaine("2026-10-12"), "2026-10-12");
  assert.throws(() => lundiDeLaSemaine("2026-02-31"));
  assert.throws(() => lundiDeLaSemaine("pas-une-date"));
});

test("semaine du 12 au 18/10/2026 : Semaine 2, services triés, R pour la garde, gris pour le service général", () => {
  const postes = [
    { agentId: "a1", debut: d("2026-10-14"), regime: "garde", type: "garde" },
    { agentId: "a1", debut: d("2026-10-17"), regime: "garde", type: "garde" },
    { agentId: "a2", debut: d("2026-10-12"), regime: "general", type: "service" },
    { agentId: "a2", debut: d("2026-10-13"), regime: "general", type: "service" },
    { agentId: "a1", debut: d("2026-10-20"), regime: "garde", type: "garde" }, // hors semaine
  ];
  const e = construireEmargement({ dateDansLaSemaine: "2026-10-15", agents, services, postes });
  assert.equal(e.debut, "2026-10-12"); assert.equal(e.fin, "2026-10-18"); assert.equal(e.numeroSemaine, 2);
  assert.deepEqual(e.services.map((s) => s.service), ["Cardiologie médicale", "CTCV"]); // service sans agent omis
  const ctcv = e.services[1]!;
  assert.deepEqual(ctcv.agents.map((a) => a.nom), ["DIEME", "NDAW"]); // agent inactif exclu
  assert.deepEqual(ctcv.agents[0]!.jours, ["repos", "repos", "poste", "repos", "repos", "poste", "repos"]);
  assert.deepEqual(ctcv.agents[1]!.jours, ["poste", "poste", "ferme", "ferme", "ferme", "ferme", "ferme"]);
  assert.equal(ctcv.agents[0]!.heures, "GARDE 8h–8h"); assert.equal(ctcv.agents[1]!.heures, "SG 8h–16h");
  // Cardiologie : aucun planning généré → signalé, jamais présenté comme un repos.
  assert.equal(e.services[0]!.agents[0]!.planifie, false);
  assert.ok(e.services[0]!.agents[0]!.jours.every((j) => j === "non_planifie"));
});

test("libellé des heures pour les urgences : jour ou nuit selon les postes", () => {
  const ag = [{ id: "u1", prenom: "A", nom: "B", serviceId: "s1", regime: "urgences", actif: true }];
  const nuit = construireEmargement({ dateDansLaSemaine: "2026-10-12", agents: ag, services, postes: [{ agentId: "u1", debut: d("2026-10-12"), regime: "urgences", type: "nuit" }] });
  assert.equal(nuit.services[0]!.agents[0]!.heures, "NUIT 20h–8h");
});

test("xlsx : conteneur ZIP valide, onglets au nom sûr", () => {
  const noms = new Set<string>();
  assert.equal(nomOnglet("CDIM/SG", noms), "CDIM-SG");
  assert.equal(nomOnglet("CDIM-SG", noms), "CDIM-SG-2");
  const e = construireEmargement({ dateDansLaSemaine: "2026-10-12", agents, services, postes: [] });
  const buf = construireXlsx(e.services.map((s) => feuilleEmargementXlsx(e, s, "Mme X")));
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  assert.throws(() => construireXlsx([]));
});

// Lit le XML d'un onglet dans le classeur (conteneur ZIP produit par construireXlsx, entrées « deflate »).
function lireFichierZip(buf: Buffer, chemin: string): string {
  let pos = 0;
  while (pos + 30 <= buf.length && buf.readUInt32LE(pos) === 0x04034b50) {
    const methode = buf.readUInt16LE(pos + 8), taille = buf.readUInt32LE(pos + 18);
    const nomLen = buf.readUInt16LE(pos + 26), extraLen = buf.readUInt16LE(pos + 28);
    const nom = buf.subarray(pos + 30, pos + 30 + nomLen).toString("utf8");
    const debut = pos + 30 + nomLen + extraLen;
    if (nom === chemin) {
      const brut = buf.subarray(debut, debut + taille);
      return (methode === 8 ? inflateRawSync(brut) : brut).toString("utf8");
    }
    pos = debut + taille;
  }
  throw new Error(`Entrée absente du classeur : ${chemin}`);
}

test("xlsx : pas d'en-tête officiel, titre en ligne 1, en-têtes de colonnes en lignes 4-5, fusions cohérentes", () => {
  const e = construireEmargement({ dateDansLaSemaine: "2026-10-12", agents, services, postes: [{ agentId: "a1", debut: d("2026-10-14"), regime: "garde", type: "garde" }] });
  const f = e.services.find((s) => s.service === "CTCV")!;
  const feuille = feuilleEmargementXlsx(e, f, "Mme X");
  const xml = lireFichierZip(construireXlsx([feuille]), "xl/worksheets/sheet1.xml");
  for (const interdit of ["RÉPUBLIQUE", "MINISTÈRE", "CENTRE HOSPITALIER", "Un Peuple"]) assert.ok(!xml.includes(interdit), `${interdit} ne doit plus figurer`);
  assert.ok(xml.includes("FEUILLE D&apos;ÉMARGEMENT") || xml.includes("FEUILLE D'ÉMARGEMENT"));
  assert.match(xml, /<c r="A1"[^>]*t="inlineStr"><is><t[^>]*>FEUILLE D/);
  assert.match(xml, /<c r="A4"[^>]*t="inlineStr"><is><t[^>]*>PRÉNOMS/);
  assert.match(xml, /<c r="D5"[^>]*t="inlineStr"><is><t[^>]*>Arrivée/);
  assert.deepEqual(feuille.fusions!.slice(0, 5), ["A1:Q1", "A2:Q2", "A4:A5", "B4:B5", "C4:C5"]);
  assert.ok(feuille.fusions!.includes("D4:E4") && feuille.fusions!.includes("P4:Q4"));
  // Chaque fusion « R » d'une ligne d'agent tombe sur une ligne de données (≥ 6), jamais dans l'en-tête.
  for (const m of feuille.fusions!.filter((x) => /^[A-Q]\d+:[A-Q]\d+$/.test(x) && !x.startsWith("A1") && !x.startsWith("A2"))) {
    const ligne = Number(m.match(/\d+/)![0]);
    assert.ok(ligne === 4 || ligne === 5 || ligne >= 6, m);
  }
  assert.equal(feuille.lignes.length >= 5 + f.agents.length, true);
});
