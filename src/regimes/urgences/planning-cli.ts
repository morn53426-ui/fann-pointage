// Usage : npm run planning:urgences -- --debut 2026-10-19 --fin 2026-11-15 --jour "Awa Diop@2026-10-17,Moussa Ndiaye@2026-10-18" --nuit "Fatou Sow" [--premier-jour 2026-10-19] [--feries 2026-11-01,2026-12-25] [--apres-passage jour|nuit] [--sortie planning-urgences.csv]
// « Nom@AAAA-MM-JJ » fixe le premier jour de travail de l'agent (samedi et dimanche autorisés) ; sans « @ », --premier-jour (ou --debut) est utilisé.
import { writeFileSync } from "node:fs";
import { construireTableauRotation, couvertureParJour, tableauRotationCsv } from "./tableau.ts";
import type { AgentRotation } from "./tableau.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const liste = (k: string) => (args.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const debut = args.get("debut"), fin = args.get("fin");
if (!debut || !fin) { console.error("Indiquez --debut et --fin (AAAA-MM-JJ)."); process.exit(1); }
const agent = (texte: string, equipe: "jour" | "nuit"): AgentRotation => {
  const [nom, premier] = texte.split("@").map((x) => x.trim());
  return { nom, equipe, premierJour: premier || args.get("premier-jour") || debut };
};
const agents: AgentRotation[] = [...liste("jour").map((t) => agent(t, "jour")), ...liste("nuit").map((t) => agent(t, "nuit"))];
if (!agents.length) { console.error("Indiquez au moins un agent avec --jour \"Nom1,Nom2\" ou --nuit \"Nom3\"."); process.exit(1); }
const variante = args.get("apres-passage") === "nuit" ? "nuit" : "jour";
const lignes = construireTableauRotation(agents, debut, fin, new Set(liste("feries")), variante);
const sortie = args.get("sortie") ?? "planning-urgences.csv";
writeFileSync(sortie, tableauRotationCsv(lignes));
console.log(`${lignes.length} poste(s) écrit(s) dans ${sortie}.`);
const trous = couvertureParJour(lignes, debut, fin);
for (const [equipe, cle] of [["jour", "jour"], ["nuit", "nuit"]] as const) {
  const sans = trous.filter((t) => t[cle] === 0).map((t) => t.date);
  console.log(sans.length ? `Équipe de ${equipe} : aucun poste ne commence les ${sans.length} jour(s) suivant(s) : ${sans.join(" ; ")}` : `Équipe de ${equipe} : au moins un poste chaque jour.`);
}
