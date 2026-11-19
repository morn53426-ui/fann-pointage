// Non-régression v24 : couleurs du formulaire de mot de passe, libellé du mot de passe provisoire, affiches QR permanentes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../web/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../../web/app.js", import.meta.url), "utf8");

test("le dégradé vert du formulaire ne s'applique pas aux boutons secondaires (texte vert sur fond vert)", () => {
  assert.match(css, /\.connexion-formulaire \.actions button:not\(\.secondaire\)\s*\{/);
  assert.doesNotMatch(css, /\.connexion-formulaire \.actions button\s*\{\s*width:100%/);
  assert.match(css, /\.connexion-formulaire \.actions button\.secondaire\s*\{[^}]*background:#fff;[^}]*color:var\(--vert\)/);
});
test("l'en-tête porte la zone de sécurité de l'écran (barre d'état iPhone)", () => {
  assert.match(css, /\.entete\s*\{[^}]*padding:calc\(10px \+ env\(safe-area-inset-top/);
  assert.doesNotMatch(css, /body\s*\{[^}]*padding:env\(safe-area-inset-top\)/);
});
test("le mot de passe provisoire n'est plus présenté comme le numéro de téléphone", () => {
  assert.doesNotMatch(app, /Mot de passe provisoire \(votre numéro de téléphone\)/);
  assert.match(app, /Mot de passe provisoire \(celui remis par l’administration\)/);
});
test("affiches QR permanentes : demandées au serveur avec permanent=1, une affiche par zone, impression via la page dédiée", () => {
  assert.match(app, /permanent: "1"/);
  assert.match(app, /function afficheQrPermanent/);
  assert.match(app, /ouvrirPageImpression\("Affiches QR de pointage"/);
  assert.match(css, /\.affiche-qr\s*\{/);
});
