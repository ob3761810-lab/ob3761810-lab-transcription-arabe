// Tests de la détection des versets du Coran (lib/quran.ts) et de leur affichage (lib/text.ts).
// Lancer avec : npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findPassages, replaceQuranPassages } from "../lib/quran.ts";
import {
  removeFixedMarks,
  removeMarks,
  splitMarks,
  toggleQuran,
  markWord,
} from "../lib/text.ts";

// Texte officiel d'un verset, lu directement dans le fichier Tanzil.
const tanzil = new Map(
  readFileSync("data/quran-simple.txt", "utf8")
    .split("\n")
    .filter((line) => /^\d+\|\d+\|/.test(line))
    .map((line) => {
      const [surah, ayah, text] = line.split("|");
      return [`${surah}:${ayah}`, text.trim()];
    }),
);
const verse = (surah, ayah) => tanzil.get(`${surah}:${ayah}`);

// Le seul passage trouvé dans `text` (échoue s'il y en a 0 ou plusieurs).
function onlyPassage(text) {
  const passages = findPassages(text);
  assert.equal(
    passages.length,
    1,
    `attendu 1 passage, trouvé ${passages.length}`,
  );
  return passages[0];
}

test("le fichier Tanzil est complet (6236 versets)", () => {
  assert.equal(tanzil.size, 6236);
});

test("verset complet : remplacé par le texte officiel avec sa référence", () => {
  const ai =
    "قال الله تعالى: يا أيها الذين آمنوا كتب عليكم الصيام كما كتب على الذين من قبلكم لعلكم تتقون. وهذا في رمضان.";
  const passage = onlyPassage(ai);
  assert.equal(passage.reference, "Al-Baqara 183");
  assert.equal(passage.official, verse(2, 183));
  const result = replaceQuranPassages(ai);
  // Le texte autour n'est pas modifié.
  assert.ok(result.startsWith("قال الله تعالى: ⟪on|Al-Baqara 183|"));
  assert.ok(result.endsWith("⟫. وهذا في رمضان."));
});

test("verset partiel : marqué « extrait »", () => {
  const ai =
    "واعلموا أن الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نوم وهذا من آية الكرسي";
  const passage = onlyPassage(ai);
  assert.equal(passage.reference, "Al-Baqara 255 (extrait)");
  assert.ok(verse(2, 255).startsWith(passage.official));
});

test("plusieurs versets d'affilée : une seule référence de début à fin", () => {
  const ai = "الرحمن علم القرآن خلق الإنسان علمه البيان الشمس والقمر بحسبان";
  const passage = onlyPassage(ai);
  assert.equal(passage.reference, "Ar-Rahman 1-5");
  const expected = [1, 2, 3, 4, 5].map((ayah) => verse(55, ayah)).join(" ");
  // La basmala de tête du verset 1 n'a pas été dite : elle n'est pas ajoutée.
  assert.equal(passage.official, expected.split(" ").slice(4).join(" "));
});

test("sourate entière précédée de la basmala", () => {
  const ai =
    "بسم الله الرحمن الرحيم قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد";
  const passage = onlyPassage(ai);
  assert.equal(passage.reference, "Al-Ikhlas 1-4");
  assert.equal(
    passage.official,
    [1, 2, 3, 4].map((ayah) => verse(112, ayah)).join(" "),
  );
});

test("verset avec 1 erreur de transcription (une lettre fausse) : corrigé", () => {
  const ai =
    "الله لا إله إلا هو الحي القيون لا تأخذه سنة ولا نوم له ما في السماوات وما في الأرض";
  const passage = onlyPassage(ai);
  assert.equal(passage.reference, "Al-Baqara 255 (extrait)");
  // Le mot faux « القيون » est remplacé par le texte officiel (« الْقَيُّومُ »).
  assert.ok(verse(2, 255).startsWith(passage.official));
  assert.ok(!passage.official.includes("القيون"));
});

test("verset avec 2 erreurs (une lettre fausse et un mot oublié) : corrigé", () => {
  // « مِن » oublié, et « تتقون » mal entendu en « تتقوم ».
  const ai =
    "يا أيها الذين آمنوا كتب عليكم الصيام كما كتب على الذين قبلكم لعلكم تتقوم";
  const passage = onlyPassage(ai);
  assert.equal(passage.reference, "Al-Baqara 183");
  assert.equal(passage.official, verse(2, 183));
});

test("phrases ordinaires qui ressemblent à des versets : PAS remplacées", () => {
  const ordinary = [
    // Formule présente dans de nombreux versets, avec des terminaisons différentes.
    "إن الله على كل شيء قدير وهذا معروف عند الجميع",
    // Début de verset, puis une phrase qui n'est pas dans le Coran.
    "يا أيها الناس اتقوا الله في أعمالكم وأحسنوا إلى جيرانكم",
    // Verset court très courant dans les discours (présent à plusieurs endroits).
    "الحمد لله رب العالمين والصلاة والسلام على رسول الله",
    // Verset court répété 31 fois dans Ar-Rahman, cité seul.
    "قال تعالى: فبأي آلاء ربكما تكذبان",
  ];
  for (const text of ordinary) {
    assert.deepEqual(findPassages(text), [], text);
    assert.equal(replaceQuranPassages(text), text);
  }
});

test("texte sans aucun verset : inchangé", () => {
  const text =
    "اليوم نتكلم عن منهج السلف في طلب العلم.\nAujourd'hui nous parlons de la méthode des salaf.";
  assert.deepEqual(findPassages(text), []);
  assert.equal(replaceQuranPassages(text), text);
});

test("basmala seule et isti'adha : texte officiel, sans numéro de verset", () => {
  const result = replaceQuranPassages(
    "أعوذ بالله من الشيطان الرجيم. بسم الله الرحمن الرحيم. نبدأ الدرس",
  );
  assert.ok(
    result.includes(
      "⟪on|Isti'adha (formule, pas un verset)|أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ|",
    ),
  );
  assert.ok(result.includes(`⟪on|Basmala|${verse(1, 1)}|`));
  assert.ok(result.endsWith(". نبدأ الدرس"));
});

test("annuler puis rétablir un remplacement ; exports et relecture", () => {
  const replaced = replaceQuranPassages(
    "قال تعالى قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد",
  );
  const [, quran] = splitMarks(replaced);
  assert.equal(quran.kind, "quran");
  assert.equal(quran.on, true);
  assert.equal(quran.reference, "Al-Ikhlas 1-4");
  // Annulé : c'est le texte de l'IA qui est affiché.
  const undone = toggleQuran(replaced, 0);
  assert.equal(
    splitMarks(undone)[1].text,
    "قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد",
  );
  assert.equal(toggleQuran(undone, 0), replaced);
  // Traduction : le texte officiel, sans marques.
  assert.ok(removeMarks(replaced).includes(verse(112, 2)));
  // Relecture par l'IA : le verset officiel n'est pas envoyé.
  assert.ok(!removeFixedMarks(replaced).includes(verse(112, 2)));
  // La relecture ne met jamais un mot du verset en rouge.
  assert.ok(!markWord(replaced, "اللَّهُ").includes("⟦"));
});

test("rapidité : un long texte est analysé en moins d'une seconde", () => {
  const block =
    "اليوم نتكلم عن منهج السلف في طلب العلم. قال تعالى: الرحمن علم القرآن خلق الإنسان علمه البيان. " +
    "ثم قال الشيخ إن العلم نور والجهل ظلام والطالب يجتهد في طلب العلم ليلا ونهارا. ";
  const long = block.repeat(400); // environ 14 000 mots
  findPassages("تحميل"); // le fichier est chargé une fois (comme au premier appel du serveur)
  const start = performance.now();
  const passages = findPassages(long);
  const seconds = (performance.now() - start) / 1000;
  console.log(
    `  ${long.split(" ").length} mots analysés en ${seconds.toFixed(3)} s, ${passages.length} passages`,
  );
  assert.equal(passages.length, 400);
  assert.ok(seconds < 1, `trop lent : ${seconds} s`);
});

test("correction d'un mot ordinaire (non signalé) : il devient « corrigé »", async () => {
  const { splitWords, replaceRange } = await import("../lib/text.ts");
  const text = "قَالَ الشَّيْخُ: الْعِلْمُ نُورٌ";
  const word = splitWords(text).filter((piece) => piece.word)[2];
  assert.equal(word.text, "الْعِلْمُ");
  const corrected = replaceRange(
    text,
    word.start,
    word.start + word.text.length,
    "الْعِلْمَ",
  );
  assert.equal(corrected, "قَالَ الشَّيْخُ: ⟨الْعِلْمَ⟩ نُورٌ");
  assert.equal(splitMarks(corrected)[1].kind, "fixed");
});
