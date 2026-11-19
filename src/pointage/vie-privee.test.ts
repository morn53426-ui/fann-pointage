// Aucun suivi de localisation en dehors du pointage : la position n'est lue qu'une fois, au moment du pointage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "node_modules" ? [] : fichiers(p)) : [p];
  });
}
test("aucun watchPosition ni suivi continu dans src/ et web/", () => {
  // fileURLToPath gère les chemins Windows (C:\...) et POSIX, contrairement à URL.pathname.
  const racine = fileURLToPath(new URL("../../", import.meta.url));
  for (const dossier of ["src", "web"]) {
    for (const f of fichiers(join(racine, dossier)).filter((x) => /\.(ts|tsx|js|jsx|html)$/.test(x) && !x.endsWith("vie-privee.test.ts"))) {
      assert.doesNotMatch(readFileSync(f, "utf8"), /watchPosition/, f);
    }
  }
});
