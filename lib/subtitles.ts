// « Nettoyer des sous-titres » : tout ce qui se fait sans IA (code classique).
// - lecture des fichiers SRT, VTT, TXT et des transcriptions YouTube copiées avec horaires ;
// - suppression des horaires, numéros, balises, en-têtes et doublons ;
// - recollage des lignes en texte continu, découpage en paragraphes et en morceaux ;
// - contrôle des mots : la mise en forme par l'IA ne doit rien changer d'autre que les hésitations.

// ---------- Lecture ----------

export type Cue = {
  start: number | null; // début en secondes (null si le texte n'a pas d'horaires)
  end: number | null;
  text: string;
  breakBefore: boolean; // ligne vide avant ce texte, dans un fichier sans horaires
};

const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?`;
const TIMING = new RegExp(String.raw`^\s*(${TIME})\s*-->\s*(${TIME})`);
// Transcription YouTube copiée : « 1:23 » ou « 00:01:23 » seul, ou en début de ligne.
const STAMP_ALONE = /^\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*$/;
const STAMP_PREFIX = /^\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s+(\S.*)$/;

// « 01:02:03,500 », « 2:03.5 », « 1:23 » → secondes.
export function parseTime(value: string): number {
  const [clock, fraction = "0"] = value.replace(",", ".").split(".");
  const seconds = clock
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
  return seconds + Number(`0.${fraction}`);
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&lrm;": "",
  "&rlm;": "",
};

// Bruits notés entre crochets par les sous-titres automatiques (ce ne sont pas des paroles).
const SOUND_NOTES =
  /\[(?:musique|music|applaudissements|applause|rires|laughter|laughs|silence|موسيقى|تصفيق|ضحك)\]/gi;

// Nettoie une ligne de sous-titre : balises, horaires internes, codes, bruits, marques invisibles.
export function cleanLine(line: string): string {
  return line
    .replace(/<\d{1,2}:\d{2}:\d{2}[.,]\d{3}>/g, " ") // horaires mot par mot (YouTube)
    .replace(/<\/?[a-zA-Z][^>]*>/g, "") // <i>, <b>, <c.colorE5E5E5>, <v Orateur>…
    .replace(/\{\\[^}]*\}/g, "") // {\an8} et autres codes de position
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(SOUND_NOTES, " ")
    .replace(/^\s*(?:>>|-)\s*/, "") // changement d'orateur
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Lit un fichier de sous-titres (SRT, VTT, transcription YouTube copiée, ou texte simple).
export function parseSubtitles(raw: string): Cue[] {
  const lines = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: Cue[] = [];
  let current: Cue | null = null;
  let skipping = false; // en-tête WEBVTT, blocs NOTE, STYLE, REGION
  let blankBefore = false;

  const nextNonEmpty = (from: number) => {
    for (let j = from; j < lines.length; j++) if (lines[j].trim()) return lines[j];
    return "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") {
      skipping = false;
      blankBefore = true;
      continue;
    }
    if (skipping) continue;
    if (/^WEBVTT\b/.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line)) {
      skipping = true;
      continue;
    }

    const timing = line.match(TIMING);
    if (timing) {
      current = { start: parseTime(timing[1]), end: parseTime(timing[2]), text: "", breakBefore: false };
      cues.push(current);
    } else if (/^\d+$/.test(line) && TIMING.test(nextNonEmpty(i + 1))) {
      // numéro de bloc SRT : ignoré
    } else if (STAMP_ALONE.test(line)) {
      current = { start: parseTime(line.match(STAMP_ALONE)![1]), end: null, text: "", breakBefore: false };
      cues.push(current);
    } else if (STAMP_PREFIX.test(line)) {
      const [, time, text] = line.match(STAMP_PREFIX)!;
      current = { start: parseTime(time), end: null, text: cleanLine(text), breakBefore: false };
      cues.push(current);
    } else {
      const text = cleanLine(line);
      if (text) {
        // Texte sans horaires : une ligne vide marque un nouveau paragraphe.
        if (!current || (current.start === null && blankBefore)) {
          current = { start: null, end: null, text, breakBefore: blankBefore && cues.length > 0 };
          cues.push(current);
        } else {
          current.text = current.text ? `${current.text} ${text}` : text;
        }
      }
    }
    blankBefore = false;
  }
  return cues.filter((cue) => cue.text !== "");
}

// ---------- Mots ----------

export type TimedWord = {
  text: string;
  time: number | null; // début du sous-titre d'où vient le mot
  cueStart: boolean; // premier mot d'un sous-titre
  gapBefore: number; // silence (secondes) avant ce sous-titre
  breakBefore: boolean; // paragraphe forcé (ligne vide d'un texte sans horaires)
};

// Forme d'un mot pour comparer : minuscules, sans harakat ni ponctuation.
export function wordKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// Recolle les sous-titres en une suite de mots. Les sous-titres automatiques de YouTube
// répètent la ligne précédente (en entier ou sa fin) au début du suivant : ce chevauchement
// est retiré. Renvoie aussi le nombre de mots retirés ainsi.
export function joinCues(cues: Cue[]): { words: TimedWord[]; duplicates: number } {
  const words: TimedWord[] = [];
  let duplicates = 0;
  let previous: Cue | null = null;
  for (const cue of cues) {
    const tokens = cue.text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const overlap = overlapLength(words, tokens);
    duplicates += overlap;
    const fresh = tokens.slice(overlap);
    const reference = previous?.end ?? previous?.start ?? null;
    const gap = cue.start !== null && reference !== null ? Math.max(0, cue.start - reference) : 0;
    fresh.forEach((text, index) =>
      words.push({
        text,
        time: cue.start,
        cueStart: index === 0,
        gapBefore: index === 0 ? gap : 0,
        breakBefore: index === 0 && cue.breakBefore,
      }),
    );
    if (cue.start !== null) previous = cue;
  }
  return { words, duplicates };
}

// Nombre de mots du début de `tokens` qui répètent la fin des mots déjà gardés.
// Au moins 2 mots (ou le sous-titre entier), pour ne pas retirer une vraie répétition d'un mot.
function overlapLength(words: TimedWord[], tokens: string[]): number {
  const max = Math.min(words.length, tokens.length, 60);
  for (let k = max; k >= 1; k--) {
    if (k < 2 && k !== tokens.length) break;
    let same = true;
    for (let i = 0; i < k && same; i++) {
      same = wordKey(words[words.length - k + i].text) === wordKey(tokens[i]);
    }
    if (same) return k;
  }
  return 0;
}

const SENTENCE_END = /[.!?؟…]["»”')\]]*$/;

// ---------- Paragraphes et morceaux ----------

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string; time: number | null };

const isArabicWord = (text: string) => /[\u0600-\u06FF]/.test(text);

// Paragraphes sans IA : coupés à une ligne vide, à un long silence, à un changement de langue
// (arabe / français) ou à une fin de phrase.
export function buildParagraphs(words: TimedWord[]): Block[] {
  const blocks: Block[] = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    blocks.push({
      kind: "paragraph",
      text: current.map((word) => word.text).join(" "),
      time: current[0].time,
    });
    current = [];
  };
  for (const word of words) {
    const last = current[current.length - 1];
    const n = current.length;
    if (
      n > 0 &&
      (word.breakBefore ||
        (word.cueStart && word.gapBefore >= 20) ||
        (word.cueStart && word.gapBefore >= 3 && n >= 30) ||
        (word.cueStart && n >= 4 && isArabicWord(word.text) !== isArabicWord(last.text)) ||
        (SENTENCE_END.test(last.text) && n >= 60) ||
        (word.cueStart && n >= 150) ||
        n >= 250)
    ) {
      flush();
    }
    current.push(word);
  }
  flush();
  return blocks;
}

// Découpe les mots en morceaux d'environ `size` mots pour l'IA, sans couper une phrase :
// la coupure se fait à une fin de phrase, sinon au plus long silence, autour de `size`.
// Chaque mot est dans exactement un morceau (aucun mot perdu).
export function splitChunks(words: TimedWord[], size = 1500): TimedWord[][] {
  const chunks: TimedWord[][] = [];
  let start = 0;
  while (words.length - start > size * 1.3) {
    const from = start + Math.floor(size * 0.8);
    const to = Math.min(words.length - 1, start + Math.floor(size * 1.2));
    const target = start + size;
    let cut = -1;
    // 1. Fin de phrase la plus proche de la taille visée.
    for (let i = from; i <= to; i++) {
      if (SENTENCE_END.test(words[i - 1].text) && (cut === -1 || Math.abs(i - target) < Math.abs(cut - target))) {
        cut = i;
      }
    }
    // 2. Sinon, le plus long silence entre deux sous-titres.
    if (cut === -1) {
      let best = -1;
      for (let i = from; i <= to; i++) {
        if (words[i].cueStart && words[i].gapBefore > best) {
          best = words[i].gapBefore;
          cut = i;
        }
      }
    }
    if (cut === -1) cut = target;
    chunks.push(words.slice(start, cut));
    start = cut;
  }
  if (start < words.length) chunks.push(words.slice(start));
  return chunks;
}

// ---------- Contrôle des mots (règle absolue : l'IA ne change pas les mots) ----------

const FILLERS = new Set([
  "euh", "heu", "euhh", "euuh", "hum", "hmm", "hm", "mmh", "mmm", "mm", "bah", "ben", "beh",
  "uh", "um", "uhm", "erm", "ممم", "مم", "امم", "اممم", "ايه", "إيه", "اه", "آه", "أه", "ااا", "اا",
]);

// Hésitation ou bruit de bouche (« euh », « hmm », « ممم », « إيه »…), y compris allongés.
export function isFiller(key: string): boolean {
  return (
    FILLERS.has(key) ||
    /^(?:e+u+h*|h+e+u+h*|h+m+|m{2,}h*|u+h+|u+m+)$/.test(key) ||
    /^(?:م{2,}|ا+م{2,}|[اأآ]+ه+|[اإ]ي+ه)$/.test(key)
  );
}

// Le mot n° k fait-il partie d'une répétition collée (« le le », « في في », « je pense je pense ») ?
function isRepeated(keys: string[], k: number): boolean {
  for (let n = 1; n <= 4; n++) {
    for (let s = k - n + 1; s <= k; s++) {
      if (s < 0) continue;
      const same = (a: number, b: number) =>
        a >= 0 && b + n <= keys.length && keys.slice(a, a + n).join(" ") === keys.slice(b, b + n).join(" ");
      if (same(s, s + n) || same(s - n, s)) return true;
    }
  }
  return false;
}

export type WordCheck = {
  before: number; // mots avant (texte nettoyé sans IA)
  after: number; // mots après (sans les intertitres)
  fillers: number; // hésitations retirées
  repetitions: number; // répétitions collées retirées
  removed: number; // autres mots disparus
  added: number; // mots qui n'étaient pas dans le texte d'origine
  map: number[]; // pour chaque mot gardé : son numéro dans le texte d'origine (-1 si ajouté)
  ok: boolean;
};

// Compare le texte d'origine et le texte mis en forme, mot par mot.
// Seules les hésitations et les répétitions collées peuvent disparaître ; rien ne doit être ajouté.
export function checkWords(original: string[], edited: string[]): WordCheck {
  const input = original.map(wordKey).filter(Boolean);
  const output = edited.map(wordKey).filter(Boolean);
  let fillers = 0;
  let repetitions = 0;
  let removed = 0;
  let added = 0;
  const map: number[] = [];
  const drop = (k: number) => {
    if (isFiller(input[k])) fillers++;
    else if (isRepeated(input, k)) repetitions++;
    else removed++;
  };
  let i = 0;
  for (let j = 0; j < output.length; j++) {
    if (input[i] === output[j]) {
      map.push(i++);
      continue;
    }
    let found = -1;
    for (let d = 1; d <= 8 && i + d < input.length; d++) {
      if (input[i + d] === output[j]) {
        found = i + d;
        break;
      }
    }
    if (found === -1) {
      added++;
      map.push(-1);
      continue;
    }
    for (let k = i; k < found; k++) drop(k);
    map.push(found);
    i = found + 1;
  }
  for (let k = i; k < input.length; k++) drop(k);
  return {
    before: input.length,
    after: output.length,
    fillers,
    repetitions,
    removed,
    added,
    map,
    ok: added <= Math.max(2, input.length * 0.005) && removed <= Math.max(2, input.length * 0.01),
  };
}

// Lit la réponse de l'IA (paragraphes séparés par une ligne vide, intertitres « ## ») et la vérifie.
// Si un mot a été changé, ajouté ou trop retiré, le morceau est refusé (`ok` faux) :
// on garde alors les paragraphes faits sans IA.
export function readFormatted(chunk: TimedWord[], answer: string): { blocks: Block[]; check: WordCheck } {
  const raw: ({ kind: "heading"; text: string } | { kind: "paragraph"; words: string[] })[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) raw.push({ kind: "paragraph", words: paragraph });
    paragraph = [];
  };
  for (const line of answer.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") {
      endParagraph();
    } else if (/^\s*##\s/.test(line)) {
      endParagraph();
      raw.push({ kind: "heading", text: line.replace(/^\s*##\s+/, "").trim() });
    } else {
      paragraph.push(...line.split(/\s+/).filter(Boolean));
    }
  }
  endParagraph();
  const editedWords = raw.flatMap((block) => (block.kind === "paragraph" ? block.words : []));
  const check = checkWords(
    chunk.map((word) => word.text),
    editedWords,
  );

  // Horaire de chaque paragraphe : celui de son premier mot retrouvé dans le texte d'origine.
  const originalIndex: number[] = []; // numéro (parmi les mots non vides) → indice dans `chunk`
  chunk.forEach((word, index) => {
    if (wordKey(word.text)) originalIndex.push(index);
  });
  const blocks: Block[] = [];
  let position = 0; // numéro du mot (non vide) dans la réponse
  for (const block of raw) {
    if (block.kind === "heading") {
      if (block.text) blocks.push(block);
      continue;
    }
    let time: number | null = null;
    for (const word of block.words) {
      if (!wordKey(word)) continue;
      const found = check.map[position++];
      if (time === null && found !== undefined && found >= 0) time = chunk[originalIndex[found]]?.time ?? null;
    }
    if (block.words.length) blocks.push({ kind: "paragraph", text: block.words.join(" "), time });
  }
  return { blocks, check };
}

// ---------- Texte final ----------

export type Stamps = "aucun" | "paragraphe" | "5min";

// Repère de temps lisible : « 4:05 » ou « 1:02:03 ».
export function clock(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

// Écrit les blocs en texte : une ligne par paragraphe, « ## » pour un intertitre,
// « [4:05] » au début d'un paragraphe pour un repère de temps.
// `next` : prochain multiple de 5 minutes à signaler (pour l'option « toutes les 5 minutes »).
export function blocksToText(
  blocks: Block[],
  stamps: Stamps,
  next = 0,
): { text: string; next: number } {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      lines.push(`## ${block.text}`);
      continue;
    }
    let label = "";
    if (block.time !== null) {
      if (stamps === "paragraphe") label = `[${clock(block.time)}] `;
      if (stamps === "5min" && block.time >= next) {
        label = `[${clock(block.time)}] `;
        next = (Math.floor(block.time / 300) + 1) * 300;
      }
    }
    lines.push(label + block.text);
  }
  return { text: lines.join("\n"), next };
}
