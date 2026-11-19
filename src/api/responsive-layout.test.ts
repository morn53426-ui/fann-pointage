import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../../web/", import.meta.url));
const app = readFileSync(new URL("../../web/app.js", import.meta.url), "utf8");
const css = readFileSync(`${web}/styles.css`, "utf8");
const sw = readFileSync(`${web}/sw.js`, "utf8");

test("responsive : le contenu principal s'adapte sans largeur fixe sur les écrans étroits", () => {
  assert.match(css, /main:not\(:has\(> \.connexion-layout\)\)[\s\S]*?max-width:1440px/);
  assert.match(css, /max-width:680px/);
  assert.match(css, /max-width:420px/);
  assert.match(css, /overflow-x:clip/);
  assert.match(css, /minmax\(min\(100%, 220px\), 1fr\)/);
});

test("responsive : tableaux et menus gardent un défilement tactile local", () => {
  assert.match(css, /\.tableau[\s\S]*?overscroll-behavior-inline:contain/);
  assert.match(css, /\.menu[\s\S]*?scroll-snap-type:x proximity/);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
});

test("PWA : le cache client est versionné pour déployer les nouveaux styles", () => {
  assert.match(sw, /const CACHE = "fann-pointage-v47"/);
  assert.match(sw, /"\/styles\.css"/);
});


test("interface professionnelle : les pages authentifiées partagent un système visuel cohérent", () => {
  assert.match(css, /Couche UI professionnelle v32d-r1/);
  assert.match(css, /body\.mode-postgres[\s\S]*?--surface:#fff/);
  assert.match(css, /#contenu > h1/);
  assert.match(css, /\.mode-postgres \.tableau-responsive/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});


test("responsive v32d-r2 : les formulaires du registre s'empilent sur les écrans étroits", () => {
  assert.match(css, /\.catalogue-formulaires[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media screen and \(max-width:800px\)[\s\S]*?\.catalogue-formulaires \{ grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.form-creation-badge \.form-badge-grille[\s\S]*?grid-template-columns:minmax\(0,1fr\)/);
});

test("responsive v32d-r2 : le registre devient une liste de fiches sans débordement horizontal", () => {
  assert.match(css, /\.tableau-catalogue tbody \{[\s\S]*?display:grid/);
  assert.match(css, /content:attr\(data-label\)/);
  assert.match(css, /\.catalogue-actions \{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});


test("responsive v32d-r3 : les actions du registre gardent un espacement sur ordinateur", () => {
  assert.match(css, /\.mode-postgres \.catalogue-actions \{[\s\S]*?display:flex;[\s\S]*?gap:8px/);
  assert.match(css, /@media screen and \(max-width:800px\)[\s\S]*?\.mode-postgres \.catalogue-actions \{[\s\S]*?display:grid/);
  assert.match(css, /has\(> #catalogue-agent-regime\)[\s\S]*?grid-column:1 \/ -1/);
});

test("responsive v32d-r3 : les libellés de régimes tiennent dans les sélecteurs sans changer les valeurs API", () => {
  assert.match(app, /value: "general", title: "Service général : 08 h–16 h, du lundi au vendredi\.",?\s*\},?\s*\"Général · 08–16 h \(lun\.–ven\.\)\"/);
  assert.match(app, /value: "garde"/);
  assert.match(app, /value: "urgences"/);
  assert.match(app, /value: "mobil"/);
});
