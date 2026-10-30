// Tests du nettoyage des sous-titres (lib/subtitles.ts).
// Lancer avec : npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blocksToText,
  buildParagraphs,
  checkWords,
  joinCues,
  parseSubtitles,
  readFormatted,
  splitChunks,
  wordKey,
} from "../lib/subtitles.ts";

// Nombre de mots d'un texte (hors ponctuation).
const count = (text) => text.split(/\s+/).filter((word) => wordKey(word)).length;
const clean = (raw) => joinCues(parseSubtitles(raw));
const textOf = (words) => words.map((word) => word.text).join(" ");

// --- Fichiers d'exemple ---

// SRT en arabe, avec balises et une phrase coupée sur deux blocs.
const SRT_ARABE = `1
00:00:01,000 --> 00:00:04,200
<i>بسم الله والحمد لله</i>
والصلاة والسلام على رسول الله

2
00:00:04,500 --> 00:00:08,000
أما بعد فإن موضوع درسنا اليوم
هو منهج السلف في

3
00:00:08,100 --> 00:00:11,000
طلب العلم وآدابه.
`;

// VTT en français, style sous-titres automatiques YouTube : chaque sous-titre répète
// la ligne précédente, avec des horaires mot par mot et des balises <c>.
const VTT_FRANCAIS = `WEBVTT
Kind: captions
Language: fr

NOTE ceci est un commentaire
à ignorer

00:00:00.000 --> 00:00:02.500 align:start position:0%
bonjour<00:00:00.500><c> à</c><00:00:00.800><c> tous</c><00:00:01.200><c> euh</c>

00:00:02.500 --> 00:00:02.510 align:start position:0%
bonjour à tous euh

00:00:02.510 --> 00:00:05.000 align:start position:0%
bonjour à tous euh
aujourd'hui<00:00:03.000><c> nous</c><00:00:03.400><c> allons</c><00:00:03.900><c> parler</c>

00:00:05.000 --> 00:00:05.010 align:start position:0%
aujourd'hui nous allons parler

00:00:05.010 --> 00:00:08.000 align:start position:0%
aujourd'hui nous allons parler
de<00:00:05.500><c> la</c><00:00:05.800><c> la</c><00:00:06.200><c> patience</c> &amp; de la gratitude
`;

// Transcription YouTube copiée (« Afficher la transcription »), texte mélangé arabe et français.
const YOUTUBE_MELANGE = `0:00
السلام عليكم ورحمة الله
0:04
aujourd'hui nous expliquons le hadith
0:09
إنما الأعمال بالنيات
1:02:15 c'est un hadith très connu
`;

// --- Tests ---

test("SRT (arabe) : horaires, numéros et balises supprimés, lignes recollées", () => {
  const { words, duplicates } = clean(SRT_ARABE);
  const text = textOf(words);
  assert.equal(
    text,
    "بسم الله والحمد لله والصلاة والسلام على رسول الله أما بعد فإن موضوع درسنا اليوم هو منهج السلف في طلب العلم وآدابه.",
  );
  assert.equal(duplicates, 0);
  assert.equal(words[0].time, 1);
  assert.equal(words.find((word) => word.text === "أما").time, 4.5);
  // Aucun mot perdu : même nombre de mots que dans les lignes de texte du fichier.
  assert.equal(count(text), 22);
});

test("VTT (français, YouTube automatique) : en-têtes, balises, codes et doublons supprimés", () => {
  const { words, duplicates } = clean(VTT_FRANCAIS);
  const text = textOf(words);
  assert.equal(
    text,
    "bonjour à tous euh aujourd'hui nous allons parler de la la patience & de la gratitude",
  );
  assert.ok(duplicates > 0, "les répétitions de YouTube doivent être retirées");
  assert.ok(!/WEBVTT|NOTE|-->|<|align/.test(text));
});

test("Transcription YouTube copiée (mélange arabe/français) : horaires « 1:23 » et « 1:02:15 » retirés", () => {
  const { words } = clean(YOUTUBE_MELANGE);
  const text = textOf(words);
  assert.equal(
    text,
    "السلام عليكم ورحمة الله aujourd'hui nous expliquons le hadith إنما الأعمال بالنيات c'est un hadith très connu",
  );
  assert.equal(words.find((word) => word.text === "c'est").time, 3735);
});

test("texte simple (TXT) sans horaires : lignes recollées, paragraphes gardés", () => {
  const { words } = clean("Première ligne coupée\nau milieu de la phrase.\n\nDeuxième paragraphe.");
  const blocks = buildParagraphs(words);
  assert.deepEqual(
    blocks.map((block) => block.text),
    ["Première ligne coupée au milieu de la phrase.", "Deuxième paragraphe."],
  );
});

test("paragraphes sans IA : coupés au changement de langue et après un long silence", () => {
  const { words } = clean(YOUTUBE_MELANGE);
  assert.deepEqual(
    buildParagraphs(words).map((block) => block.text),
    [
      "السلام عليكم ورحمة الله",
      "aujourd'hui nous expliquons le hadith",
      "إنما الأعمال بالنيات",
      "c'est un hadith très connu",
    ],
  );
});

test("découpage en morceaux : aucun mot perdu, coupure à une fin de phrase", () => {
  // 600 sous-titres différents (le numéro change), de 9 mots chacun.
  const raw = Array.from(
    { length: 600 },
    (_, i) => `${Math.floor(i / 60)}:${String(i % 60).padStart(2, "0")}\nهذه الجملة رقم ${i} من الدرس فيها كلمات كثيرة.`,
  ).join("\n");
  const { words } = clean(raw);
  const chunks = splitChunks(words, 1500);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.flat().length, words.length, "chaque mot est dans un morceau");
  assert.deepEqual(chunks.flat(), words, "dans le même ordre");
  for (const chunk of chunks.slice(0, -1)) assert.match(chunk[chunk.length - 1].text, /\.$/);
});

test("repères de temps : un par paragraphe, ou toutes les 5 minutes", () => {
  const blocks = [
    { kind: "paragraph", text: "a", time: 0 },
    { kind: "paragraph", text: "b", time: 130 },
    { kind: "heading", text: "Titre" },
    { kind: "paragraph", text: "c", time: 310 },
    { kind: "paragraph", text: "d", time: 400 },
  ];
  assert.equal(blocksToText(blocks, "paragraphe").text, "[0:00] a\n[2:10] b\n## Titre\n[5:10] c\n[6:40] d");
  assert.equal(blocksToText(blocks, "5min").text, "[0:00] a\nb\n## Titre\n[5:10] c\nd");
  assert.equal(blocksToText(blocks, "aucun").text, "a\nb\n## Titre\nc\nd");
});

// --- Contrôle de la mise en forme par l'IA (réponses simulées) ---

const chunkOf = (raw) => clean(raw).words;

test("mise en forme correcte (français) : acceptée, hésitations et répétition retirées", () => {
  const chunk = chunkOf(VTT_FRANCAIS);
  const answer = "Bonjour à tous.\n\n## La patience\n\nAujourd'hui, nous allons parler de la patience & de la gratitude.";
  const { blocks, check } = readFormatted(chunk, answer);
  assert.equal(check.ok, true);
  assert.equal(check.fillers, 1); // « euh »
  assert.equal(check.repetitions, 1); // « la la »
  assert.equal(check.removed, 0);
  assert.equal(check.added, 0);
  assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "heading", "paragraph"]);
  // Le repère de temps suit le premier mot du paragraphe.
  assert.equal(blocks[2].time, 2.51);
});

test("mise en forme correcte (arabe) : « يعني » gardé, « ممم » retiré", () => {
  const chunk = chunkOf("0:00\nقال ممم العلماء يعني أن العلم\n0:05\nقبل القول والعمل");
  const { check } = readFormatted(chunk, "قال العلماء، يعني: أن العلم قبل القول والعمل.");
  assert.equal(check.ok, true);
  assert.equal(check.fillers, 1);
});

test("l'IA reformule : refusée", () => {
  const chunk = chunkOf(VTT_FRANCAIS);
  const { check } = readFormatted(chunk, "Salut tout le monde. Aujourd'hui, on va évoquer la patience et la reconnaissance.");
  assert.equal(check.ok, false);
  assert.ok(check.added > 0 && check.removed > 0);
});

test("l'IA résume (perte importante de mots) : refusée et signalée", () => {
  const chunk = chunkOf(SRT_ARABE);
  const { check } = readFormatted(chunk, "بسم الله والحمد لله، أما بعد فموضوع الدرس منهج السلف.");
  assert.equal(check.ok, false);
  assert.ok(check.removed >= 10, `mots perdus : ${check.removed}`);
});

test("l'IA ajoute une phrase : refusée", () => {
  const chunk = chunkOf(YOUTUBE_MELANGE);
  const { check } = readFormatted(
    chunk,
    "السلام عليكم ورحمة الله. Aujourd'hui nous expliquons le hadith : « إنما الأعمال بالنيات ». C'est un hadith très connu, rapporté par Al-Bukhari.",
  );
  assert.equal(check.ok, false);
  assert.ok(check.added >= 3);
});

test("contrôle du nombre de mots avant/après, sans IA : aucune perte", () => {
  for (const raw of [SRT_ARABE, VTT_FRANCAIS, YOUTUBE_MELANGE]) {
    const { words } = clean(raw);
    const result = blocksToText(buildParagraphs(words), "aucun").text;
    const check = checkWords(textOf(words).split(" "), result.split(/\s+/));
    assert.equal(check.removed + check.added + check.fillers + check.repetitions, 0);
    assert.equal(check.before, check.after);
  }
});

// --- Sous-titres en Word (.docx) ---

import { readFileSync } from "node:fs";
import { readDocx } from "../lib/docx.ts";

const docx = (name) => new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name);

test("Word (.docx) : fichier SRT collé dans Word, lu au mot près puis nettoyé", async () => {
  const raw = await readDocx(docx("sous-titres-srt.docx"));
  assert.ok(raw.includes("00:00:01,000 --> 00:00:04,000"));
  const { words } = clean(raw);
  assert.equal(
    textOf(words),
    "بسم الله والحمد لله أما بعد فإن موضوع درسنا اليوم هو منهج السلف في طلب العلم.",
  );
  assert.equal(words[0].time, 1);
});

test("Word (.docx) : transcription YouTube avec tabulations, retour à la ligne et caractères spéciaux", async () => {
  const raw = await readDocx(docx("transcription-youtube.docx"));
  const { words } = clean(raw);
  assert.equal(
    textOf(words),
    "السلام عليكم ورحمة الله aujourd'hui nous expliquons le hadith & ses إنما الأعمال بالنيات",
  );
  assert.equal(words.find((word) => word.text === "إنما").time, 9);
});

test("Word ancien format (.doc) ou fichier qui n'est pas un Word : refusé proprement", async () => {
  await assert.rejects(readDocx(new File(["pas un document word"], "cours.docx")));
});
