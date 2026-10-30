// Tests de la structure des PDF (lib/document.ts) : blocs typés, vocalisation vérifiée.
// Lancer avec : npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyVocalized,
  blockTexts,
  countBlocks,
  pagesToText,
  parseStructure,
} from "../lib/document.ts";
import { plainLines, splitVerse } from "../lib/text.ts";

// Réponse type de l'IA pour la page de test (tests/fixtures/charh-test.pdf) :
// un titre, 3 paragraphes de prose, 4 vers en deux hémistiches.
const STRUCTURE = JSON.parse(
  readFileSync(new URL("./fixtures/charh-test-structure.json", import.meta.url), "utf8"),
);

test("structure : types gardés, paragraphe d'un seul tenant (retours à la ligne recollés)", () => {
  const pages = parseStructure(STRUCTURE, 12);
  assert.equal(pages[0].page, 12);
  assert.equal(pages[0].blocks.length, 8);
  assert.ok(!pages[0].blocks[1].text.includes("\n"), "un paragraphe = une seule ligne");
  const text = pagesToText(pages);
  assert.deepEqual(countBlocks(text), { titre: 1, paragraphe: 3, vers: 4, note: 0 });
  assert.ok(text.startsWith("— Page 12 —\n## بسم الله الرحمن الرحيم\n"));
  // Vers : sadr et ʿajuz séparés.
  const verse = text.split("\n").find((line) => line.startsWith("@@ "));
  assert.deepEqual(splitVerse(verse.slice(3)), {
    sadr: "يقول راجي رحمة الغفور",
    ajuz: "دوماً سليمان هو الجمزوري",
    ajuzStart: "يقول راجي رحمة الغفور ‖ ".length,
  });
});

// Ajoute des harakat (simulées) sans changer les mots.
const vocalize = (text) => text.replace(/الله/g, "اللَّهِ").replace(/الغفور/g, "الغَفُورِ");

test("vocalisation correcte : même nombre de blocs, même ordre, harakat appliquées", () => {
  const pages = parseStructure(STRUCTURE, 1);
  const texts = blockTexts(pages);
  assert.equal(texts.length, 12); // 1 titre + 3 paragraphes + 4 vers × 2 hémistiches
  const result = applyVocalized(pages, texts.map(vocalize));
  assert.equal(result.ok, true);
  assert.equal(result.failed, 0);
  assert.deepEqual(
    result.pages[0].blocks.map((block) => block.type),
    pages[0].blocks.map((block) => block.type),
  );
  assert.equal(result.pages[0].blocks[2].sadr, "يقول راجي رحمة الغَفُورِ");
});

test("vocalisation qui fusionne deux blocs : refusée (nombre différent), rien n'est appliqué", () => {
  const pages = parseStructure(STRUCTURE, 1);
  const texts = blockTexts(pages).map(vocalize);
  const merged = [texts[0], `${texts[1]} ${texts[2]}`, ...texts.slice(3)];
  const result = applyVocalized(pages, merged);
  assert.equal(result.ok, false);
  assert.deepEqual(result.pages, pages);
});

test("vocalisation qui coupe un bloc : refusée", () => {
  const pages = parseStructure(STRUCTURE, 1);
  const texts = blockTexts(pages);
  const [first, ...rest] = texts[1].split(" . ");
  const result = applyVocalized(pages, [texts[0], first, rest.join(" . "), ...texts.slice(2)]);
  assert.equal(result.ok, false);
});

test("vocalisation qui change une lettre (« بإسم » → « بِسْمِ ») : harakat gardées, mot de l'auteur en rouge", () => {
  const pages = parseStructure(STRUCTURE, 1);
  const texts = blockTexts(pages).map(vocalize);
  texts[1] = texts[1].replace("بإسم", "بِسْمِ");
  const result = applyVocalized(pages, texts);
  assert.equal(result.ok, true);
  assert.equal(result.failed, 0);
  assert.equal(result.flagged, 1);
  const paragraph = result.pages[0].blocks[1].text;
  assert.ok(paragraph.includes("⟦بإسم⟧"), "les lettres de l'auteur sont gardées, en rouge");
  assert.ok(paragraph.includes("اللَّهِ"), "le reste du bloc garde ses harakat");
});

test("vocalisation qui réécrit un bloc : ce bloc reste tel quel (sans harakat)", () => {
  const pages = parseStructure(STRUCTURE, 1);
  const texts = blockTexts(pages).map(vocalize);
  texts[6] = "أَيْ قَالَ الشَّيْخُ إِنَّ اللَّهَ يَغْفِرُ الذُّنُوبَ جَمِيعًا";
  const result = applyVocalized(pages, texts);
  assert.equal(result.failed, 1);
  assert.equal(result.pages[0].blocks[4].text, pages[0].blocks[4].text);
});

test("structure mal remplie par l'IA : aucun texte perdu, moitiés de vers réunies, tatweel retiré", () => {
  // Cas réel (ESSAIE.pdf) : paragraphe rangé comme « vers » avec un champ « text », vers rendu
  // en deux moitiés séparées, mot étiré « الأشـــــاء », type inconnu.
  const pages = parseStructure(
    {
      pages: [
        {
          page: 1,
          blocks: [
            { type: "paragraphe", text: "أي أنظم الأشـــــاء الآتـــــة" },
            { type: "vers", sadr: "يقول راجي رحمة الغفور", ajuz: "" },
            { type: "vers", sadr: "", ajuz: "دوماً سليمان هو الجمزوري" },
            { type: "vers", text: "أي ( يقول ) مؤمل إحسان ربه الغفور" },
            { type: "paragraphe", sadr: "(الحمد لله) أي الثناء الحسن" },
            { type: "inconnu", text: "(مصلياً) أي طالباً من الله" },
          ],
        },
      ],
    },
    1,
  );
  const text = pagesToText(pages);
  assert.ok(text.includes("أي أنظم الأشاء الآتة"), "tatweel retiré");
  assert.ok(text.includes("@@ يقول راجي رحمة الغفور ‖ دوماً سليمان هو الجمزوري"), "vers réuni");
  for (const kept of ["مؤمل إحسان ربه الغفور", "(الحمد لله) أي الثناء الحسن", "(مصلياً) أي طالباً من الله"]) {
    assert.ok(text.includes(kept), `texte gardé : ${kept}`);
  }
  assert.deepEqual(countBlocks(text), { titre: 0, paragraphe: 4, vers: 1, note: 0 });
});

test("traduction : vers écrits « sadr — ʿajuz », sans préfixes de mise en page", () => {
  const text = pagesToText(parseStructure(STRUCTURE, 1));
  const plain = plainLines(text);
  assert.ok(!/@@|##|— Page/.test(plain));
  assert.ok(plain.includes("يقول راجي رحمة الغفور — دوماً سليمان هو الجمزوري"));
});
