// Repère les passages du Coran dans un texte produit par l'IA et les remplace par le texte
// officiel de Tanzil (data/quran-simple.txt, licence CC BY 3.0, texte non modifié).
// Aucune intelligence artificielle ici : uniquement des comparaisons de mots.
// La référence (sourate et verset) vient toujours du fichier Tanzil, jamais de l'IA.
//
// Chaque passage remplacé est écrit dans le texte sous la forme :
//   ⟪on|référence|texte officiel|texte de l'IA⟫
// « on » devient « off » quand l'utilisateur annule le remplacement (voir lib/text.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Réglages de la détection.
export const SETTINGS = {
  // Nombre minimum de mots pour accepter un passage.
  minWords: 4,
  // Un morceau de verset (sans aucun verset complet) doit faire au moins ce nombre de mots,
  // et un passage qui existe à plusieurs endroits du Coran aussi.
  minPartialWords: 6,
  // Part maximale de mots erronés (mot faux, en trop ou manquant) : 0,2 = 1 mot sur 5.
  maxErrorRatio: 0.2,
  // Part minimale de mots exactement identiques (après normalisation).
  minExactRatio: 0.6,
  // En dessous de ce nombre de mots, le passage doit correspondre exactement (aucune lettre
  // différente, aucun mot en trop ou en moins) : on ne touche jamais aux lettres d'une formule courte.
  exactBelow: 8,
};

// Noms des sourates, dans l'ordre.
const SURAH_NAMES = [
  "Al-Fatiha", "Al-Baqara", "Al Imran", "An-Nisa", "Al-Ma'ida", "Al-An'am", "Al-A'raf",
  "Al-Anfal", "At-Tawba", "Yunus", "Hud", "Yusuf", "Ar-Ra'd", "Ibrahim", "Al-Hijr", "An-Nahl",
  "Al-Isra", "Al-Kahf", "Maryam", "Ta-Ha", "Al-Anbiya", "Al-Hajj", "Al-Mu'minun", "An-Nur",
  "Al-Furqan", "Ash-Shu'ara", "An-Naml", "Al-Qasas", "Al-Ankabut", "Ar-Rum", "Luqman",
  "As-Sajda", "Al-Ahzab", "Saba", "Fatir", "Ya-Sin", "As-Saffat", "Sad", "Az-Zumar", "Ghafir",
  "Fussilat", "Ash-Shura", "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiya", "Al-Ahqaf", "Muhammad",
  "Al-Fath", "Al-Hujurat", "Qaf", "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman",
  "Al-Waqi'a", "Al-Hadid", "Al-Mujadila", "Al-Hashr", "Al-Mumtahana", "As-Saff", "Al-Jumu'a",
  "Al-Munafiqun", "At-Taghabun", "At-Talaq", "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haqqa",
  "Al-Ma'arij", "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyama", "Al-Insan",
  "Al-Mursalat", "An-Naba", "An-Nazi'at", "Abasa", "At-Takwir", "Al-Infitar", "Al-Mutaffifin",
  "Al-Inshiqaq", "Al-Buruj", "At-Tariq", "Al-A'la", "Al-Ghashiya", "Al-Fajr", "Al-Balad",
  "Ash-Shams", "Al-Layl", "Ad-Duha", "Ash-Sharh", "At-Tin", "Al-Alaq", "Al-Qadr", "Al-Bayyina",
  "Az-Zalzala", "Al-Adiyat", "Al-Qari'a", "At-Takathur", "Al-Asr", "Al-Humaza", "Al-Fil",
  "Quraysh", "Al-Ma'un", "Al-Kawthar", "Al-Kafirun", "An-Nasr", "Al-Masad", "Al-Ikhlas",
  "Al-Falaq", "An-Nas",
];

// Isti'adha : formule dite avant la récitation, ce n'est pas un verset (pas de référence).
const ISTIADHA_TEXT = "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ";
const ISTIADHA_LABEL = "Isti'adha (formule, pas un verset)";

// ---------- Normalisation ----------

// Harakat, petits signes coraniques (pauses, ۞, ۩) et tatweel.
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

// Ramène un mot arabe à une forme simple pour comparer : sans harakat,
// avec أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ → و, ئ → ي.
export function normalize(word: string): string {
  return word
    .replace(MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

// Un « mot » arabe : lettres, harakat et signes coraniques collés.
const ARABIC_WORD = /[ء-غـ-ٰٟ-ۓۖ-ۭ]+/g;

// ---------- Corpus ----------

type Word = {
  norm: string; // forme normalisée
  display: string; // forme officielle (avec harakat et signes de pause)
  verse: number; // numéro du verset dans le tableau `verses`
  basmala: boolean; // fait partie de la basmala placée en tête du verset 1 d'une sourate
};

type Verse = { surah: number; ayah: number; words: number; basmalaWords: number };

type Corpus = {
  words: Word[];
  verses: Verse[];
  trigrams: Map<string, number[]>;
};

let corpus: Corpus | null = null;

const BASMALA_NORM = ["بسم", "الله", "الرحمن", "الرحيم"];

// Charge le fichier Tanzil une seule fois, puis le garde en mémoire.
function loadCorpus(): Corpus {
  if (corpus) return corpus;
  const file = readFileSync(join(process.cwd(), "data", "quran-simple.txt"), "utf8");
  const words: Word[] = [];
  const verses: Verse[] = [];

  for (const line of file.split("\n")) {
    const [surah, ayah, text] = line.split("|");
    if (!text) continue; // lignes vides et bloc de licence
    const index = verses.length;
    const raw = text.trim().split(/\s+/);
    // Les signes isolés (pauses ۚ ۖ, ۞, ۩) sont rattachés au mot voisin.
    const tokens: { norm: string; display: string }[] = [];
    let prefix = "";
    for (const piece of raw) {
      const norm = normalize(piece);
      if (norm === "") {
        if (tokens.length > 0) tokens[tokens.length - 1].display += ` ${piece}`;
        else prefix += `${piece} `;
        continue;
      }
      tokens.push({ norm, display: prefix + piece });
      prefix = "";
    }
    // Tanzil écrit la basmala en tête du premier verset de chaque sourate (sauf 1 et 9) ;
    // elle n'est pas comptée comme un verset.
    const hasBasmala =
      Number(surah) !== 1 &&
      Number(ayah) === 1 &&
      BASMALA_NORM.every((word, i) => tokens[i]?.norm === word);
    const basmalaWords = hasBasmala ? BASMALA_NORM.length : 0;
    tokens.forEach((token, i) =>
      words.push({ ...token, verse: index, basmala: i < basmalaWords }),
    );
    verses.push({
      surah: Number(surah),
      ayah: Number(ayah),
      words: tokens.length,
      basmalaWords,
    });
  }

  // Index : chaque suite de 3 mots → positions où elle commence.
  const trigrams = new Map<string, number[]>();
  for (let i = 0; i + 2 < words.length; i++) {
    const key = `${words[i].norm} ${words[i + 1].norm} ${words[i + 2].norm}`;
    const list = trigrams.get(key);
    if (list) list.push(i);
    else trigrams.set(key, [i]);
  }

  corpus = { words, verses, trigrams };
  return corpus;
}

// ---------- Comparaison des mots ----------

// Distance d'édition entre deux mots (nombre de lettres à changer, ajouter ou enlever).
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

type Comparison = "exact" | "similar" | "different";

// Deux mots « proches » : une lettre de différence (deux pour les mots longs).
function compare(a: string, b: string): Comparison {
  if (a === b) return "exact";
  const shortest = Math.min(a.length, b.length);
  if (shortest < 3) return "different";
  return distance(a, b) <= (shortest >= 7 ? 2 : 1) ? "similar" : "different";
}

// ---------- Recherche ----------

// `lineStart` : premier mot de sa ligne (rien d'autre que des signes ou des chiffres avant lui).
type Token = { norm: string; start: number; end: number; lineStart: boolean };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(ARABIC_WORD)) {
    const norm = normalize(match[0]);
    if (!norm) continue;
    const start = match.index;
    const before = text.slice(text.lastIndexOf("\n", start - 1) + 1, start);
    tokens.push({ norm, start, end: start + match[0].length, lineStart: !/\p{L}/u.test(before) });
  }
  return tokens;
}

type Alignment = {
  textStart: number; // premier mot du texte (indice dans les tokens)
  textEnd: number; // dernier mot du texte (inclus)
  quranStart: number; // premier mot du Coran (indice dans corpus.words)
  quranEnd: number; // dernier mot du Coran (inclus)
  exact: number;
  errors: number;
};

// Avance (step = 1) ou recule (step = -1) mot par mot à partir d'une position déjà alignée,
// en tolérant un mot faux, en trop ou manquant, à condition que le mot suivant soit exact.
function extend(
  tokens: Token[],
  words: Word[],
  t: number,
  q: number,
  step: 1 | -1,
  textLimit: number,
): { t: number; q: number; exact: number; errors: number } {
  let exact = 0;
  let errors = 0;
  const inText = (i: number) => (step === 1 ? i < tokens.length : i >= textLimit);
  const inQuran = (i: number) => i >= 0 && i < words.length;
  const same = (ti: number, qi: number) =>
    inText(ti) && inQuran(qi) && compare(tokens[ti].norm, words[qi].norm);

  while (inText(t) && inQuran(q)) {
    const result = same(t, q);
    if (result === "exact" || result === "similar") {
      if (result === "exact") exact++;
      t += step;
      q += step;
      continue;
    }
    // Mot faux : le suivant correspond.
    if (same(t + step, q + step) === "exact") {
      errors++;
      t += step;
      q += step;
      continue;
    }
    // Mot en trop dans le texte de l'IA.
    if (same(t + step, q) === "exact") {
      errors++;
      t += step;
      continue;
    }
    // Mot oublié par l'IA.
    if (same(t, q + step) === "exact") {
      errors++;
      q += step;
      continue;
    }
    break;
  }
  return { t, q, exact, errors };
}

// Meilleur alignement qui commence au mot `t` du texte (ou un peu avant, sans dépasser `floor`).
function bestAlignmentAt(tokens: Token[], t: number, floor: number): Alignment | null {
  const { words, trigrams } = loadCorpus();
  if (t + 2 >= tokens.length) return null;
  const key = `${tokens[t].norm} ${tokens[t + 1].norm} ${tokens[t + 2].norm}`;
  let best: Alignment | null = null;
  for (const q of trigrams.get(key) ?? []) {
    const forward = extend(tokens, words, t + 3, q + 3, 1, floor);
    const backward = extend(tokens, words, t - 1, q - 1, -1, floor);
    const candidate: Alignment = {
      textStart: backward.t + 1,
      textEnd: forward.t - 1,
      quranStart: backward.q + 1,
      quranEnd: forward.q - 1,
      exact: 3 + forward.exact + backward.exact,
      errors: forward.errors + backward.errors,
    };
    const length = candidate.quranEnd - candidate.quranStart;
    const bestLength = best ? best.quranEnd - best.quranStart : -1;
    if (length > bestLength || (length === bestLength && best && candidate.errors < best.errors)) {
      best = candidate;
    }
  }
  return best;
}

// Positions du Coran où apparaît exactement la même suite de mots (forme normalisée).
function occurrences(start: number, end: number): number[] {
  const { words, trigrams } = loadCorpus();
  const key = `${words[start].norm} ${words[start + 1].norm} ${words[start + 2].norm}`;
  return (trigrams.get(key) ?? []).filter((other) => {
    for (let i = 0; i <= end - start; i++) {
      if (words[other + i]?.norm !== words[start + i].norm) return false;
    }
    return true;
  });
}

function surahName(surah: number): string {
  return SURAH_NAMES[surah - 1] ?? `Sourate ${surah}`;
}

// Référence lisible : « Al-Baqara 255 », « Al-Baqara 1-5 », « Al-Falaq 5 – An-Nas 2 ».
function reference(start: number, end: number): string {
  const { words, verses } = loadCorpus();
  const first = verses[words[start].verse];
  const last = verses[words[end].verse];
  if (first.surah !== last.surah) {
    return `${surahName(first.surah)} ${first.ayah} – ${surahName(last.surah)} ${last.ayah}`;
  }
  const ayahs = first.ayah === last.ayah ? `${first.ayah}` : `${first.ayah}-${last.ayah}`;
  return `${surahName(first.surah)} ${ayahs}`;
}

// Nombre de versets entièrement couverts (la basmala de tête n'est pas exigée).
function fullVerses(start: number, end: number): number {
  const { words, verses } = loadCorpus();
  let count = 0;
  for (let v = words[start].verse; v <= words[end].verse; v++) {
    const covered = words
      .slice(start, end + 1)
      .filter((word) => word.verse === v && !word.basmala).length;
    if (covered === verses[v].words - verses[v].basmalaWords && covered > 0) count++;
  }
  return count;
}

export type Passage = {
  start: number; // position dans le texte (caractères)
  end: number;
  reference: string;
  official: string;
};

// Vérifie qu'un alignement est assez sûr pour remplacer le texte.
function accept(alignment: Alignment, lineStart: boolean): Passage | null {
  const { words } = loadCorpus();
  const { quranStart: qs, quranEnd: qe } = alignment;
  const n = qe - qs + 1;
  const official = words
    .slice(qs, qe + 1)
    .map((word) => word.display)
    .join(" ");

  // Basmala : remplacée seulement si elle est seule sur sa ligne ou en tête de ligne (titre, début
  // de bloc), et écrite exactement. Citée au milieu d'une phrase (« متبركاً بإسم الله الرحمن الرحيم »),
  // elle reste telle que l'auteur l'a écrite.
  if (n === BASMALA_NORM.length && BASMALA_NORM.every((word, i) => words[qs + i].norm === word)) {
    return lineStart && alignment.errors === 0 && alignment.exact === n
      ? { start: 0, end: 0, reference: "Basmala", official }
      : null;
  }

  if (n < SETTINGS.minWords) return null;
  // Passage court : uniquement s'il est exactement identique (aucune lettre changée).
  if (n < SETTINGS.exactBelow && (alignment.exact !== n || alignment.errors > 0)) return null;
  if (alignment.exact < Math.max(SETTINGS.minWords, Math.ceil(n * SETTINGS.minExactRatio))) {
    return null;
  }
  if (alignment.errors > Math.floor(n * SETTINGS.maxErrorRatio)) return null;
  const complete = fullVerses(qs, qe);
  if (complete === 0 && n < SETTINGS.minPartialWords) return null;

  // Texte présent à plusieurs endroits : accepté seulement pour un ou plusieurs versets complets,
  // assez longs, et écrits partout exactement de la même façon (sinon : formule courante).
  const found = occurrences(qs, qe);
  if (found.length > 1) {
    if (complete === 0 || n < SETTINGS.minPartialWords) return null;
    const display = (from: number) =>
      words
        .slice(from, from + n)
        .map((word) => word.display)
        .join(" ");
    if (found.some((other) => display(other) !== official)) return null;
  }
  // Texte présent à plusieurs endroits : référence du premier, avec le nombre d'autres.
  const others = found.length > 1 ? ` (et ${found.length - 1} autre(s) endroit(s))` : "";
  return {
    start: 0,
    end: 0,
    reference: reference(qs, qe) + (complete === 0 ? " (extrait)" : "") + others,
    official,
  };
}

// L'isti'adha (أعوذ بالله من الشيطان الرجيم) au mot `t` ?
const ISTIADHA_NORM = ["اعوذ", "بالله", "من", "الشيطان", "الرجيم"];
function istiadhaAt(tokens: Token[], t: number): boolean {
  return ISTIADHA_NORM.every(
    (word, i) => tokens[t + i]?.norm === word,
  );
}

// Trouve tous les passages coraniques d'un texte.
export function findPassages(text: string): Passage[] {
  const tokens = tokenize(text);
  const passages: Passage[] = [];
  let floor = 0; // on ne revient jamais sur un passage déjà trouvé
  for (let t = 0; t < tokens.length; ) {
    if (tokens[t].lineStart && istiadhaAt(tokens, t)) {
      const last = t + ISTIADHA_NORM.length - 1;
      passages.push({
        start: tokens[t].start,
        end: tokens[last].end,
        reference: ISTIADHA_LABEL,
        official: ISTIADHA_TEXT,
      });
      t = floor = last + 1;
      continue;
    }
    const alignment = bestAlignmentAt(tokens, t, floor);
    const passage = alignment && accept(alignment, tokens[alignment.textStart].lineStart);
    if (alignment && passage) {
      passages.push({
        ...passage,
        start: tokens[alignment.textStart].start,
        end: tokens[alignment.textEnd].end,
      });
      t = floor = alignment.textEnd + 1;
    } else {
      t++;
    }
  }
  return passages;
}

// Caractères interdits à l'intérieur d'un passage marqué.
const clean = (value: string) => value.replace(/[⟦⟧⟨⟩⟪⟫|\n]/g, " ").replace(/\s+/g, " ").trim();

// Remplace chaque passage coranique par le texte officiel, marqué avec sa référence.
// Le reste du texte n'est pas modifié.
export function replaceQuranPassages(text: string): string {
  let result = "";
  let last = 0;
  for (const passage of findPassages(text)) {
    let { start, end } = passage;
    // On inclut les marques « mot à vérifier » et les parenthèses coraniques ﴿ ﴾ collées au passage.
    while (start > last && "⟦⟨﴿".includes(text[start - 1])) start--;
    while (end < text.length && "⟧⟩﴾".includes(text[end])) end++;
    result += text.slice(last, start);
    result += `⟪on|${passage.reference}|${passage.official}|${clean(text.slice(start, end))}⟫`;
    last = end;
  }
  return result + text.slice(last);
}

// Texte organisé en blocs, une ligne par bloc (PDF, sous-titres) : la détection se fait bloc par
// bloc, sans jamais déborder sur le bloc suivant. Les vers de poésie (« @@ ») et les repères de
// page (« — Page 3 — ») ne sont pas analysés.
export function replaceQuranInBlocks(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.startsWith("@@ ") || /^— Page \d+ —$/.test(line.trim()) ? line : replaceQuranPassages(line)))
    .join("\n");
}
