// Structure d'un PDF (livre) : liste de blocs typés par page, sans IA.
// - lecture et vérification de la structure renvoyée par l'IA (titres, paragraphes, vers, notes) ;
// - vocalisation bloc par bloc, avec vérification automatique : même nombre de blocs, même ordre,
//   mêmes mots (harakat mises à part). Un mot corrigé par l'IA (lecture du scan) passe en rouge ;
//   un bloc fusionné, coupé ou réécrit reste sans harakat ;
// - écriture en texte, une ligne par bloc, pour l'affichage et les exports :
//     « ## titre », « @@ sadr ‖ ʿajuz » (vers), « ^^ note », « — Page 3 — », paragraphe tel quel.

export type DocBlock =
  | { type: "titre"; text: string }
  | { type: "paragraphe"; text: string }
  | { type: "vers"; sadr: string; ajuz: string }
  | { type: "note"; text: string };

export type DocPage = { page: number; blocks: DocBlock[] };

// Un bloc tient sur une seule ligne : les retours à la ligne du PDF deviennent des espaces.
// Les caractères réservés à l'écriture des blocs sont retirés, ainsi que le tatweel (ـ), qui ne
// sert qu'à étirer les mots à l'impression (« الأشـــــاء »).
function oneLine(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[‖⟪⟫]/g, " ")
        .replace(/\u0640/g, "")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

// Lit la structure renvoyée par l'IA : { pages: [{ page, blocks: [{ type, text | sadr, ajuz }] }] }.
// `firstPage` : numéro, dans le PDF d'origine, de la première page envoyée.
// Aucun texte n'est jamais perdu : un bloc mal rempli par l'IA (type inconnu, texte rangé dans le
// mauvais champ) est gardé comme paragraphe ; deux moitiés de vers séparées sont réunies.
export function parseStructure(data: unknown, firstPage: number): DocPage[] {
  const pages = (data as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) throw new Error("Structure illisible");
  return pages.map((page, index) => {
    const blocks: DocBlock[] = [];
    for (const raw of Array.isArray(page?.blocks) ? page.blocks : []) {
      const type = raw?.type;
      const text = oneLine(raw?.text);
      const sadr = oneLine(raw?.sadr);
      const ajuz = oneLine(raw?.ajuz);
      if (type === "vers" && HEMISTICH_GAP.test(text)) {
        // Vers écrit « sadr *** ʿajuz » (deux vers si l'IA en a réuni deux : 3 marques).
        for (const verse of versesFromLine(text)) {
          if (!isRepeat(blocks, verse)) blocks.push({ type: "vers", ...verse });
        }
        continue;
      }
      if (type === "vers") {
        const verse = rebuildVerse(sadr, ajuz, text);
        if (verse && isRepeat(blocks, verse)) continue;
        const previous = blocks[blocks.length - 1];
        if (verse && previous?.type === "vers" && !previous.ajuz && !verse.sadr) {
          // Seconde moitié rendue à part : elle complète le vers précédent.
          previous.ajuz = verse.ajuz;
          continue;
        }
        if (verse && previous?.type === "vers" && !previous.ajuz && !verse.ajuz && !text) {
          previous.ajuz = verse.sadr;
          continue;
        }
        if (verse) {
          blocks.push({ type: "vers", ...verse });
          continue;
        }
      }
      // Tout autre bloc : son texte, où qu'il soit rangé.
      const content = [text, sadr, ajuz].filter(Boolean).join(" ");
      if (!content) continue;
      const kind = type === "titre" || type === "note" ? type : "paragraphe";
      blocks.push({ type: kind, text: content });
    }
    return { page: firstPage + index, blocks };
  });
}

// Marque « *** » écrite par l'IA à la place du grand blanc entre les deux hémistiches.
const HEMISTICH_GAP = /\s*\*{2,}\s*/;

// Une ligne « sadr *** ʿajuz » → un vers ; « a *** b *** c *** d » → deux vers ; une moitié seule
// reste un vers incomplet.
function versesFromLine(line: string): { sadr: string; ajuz: string }[] {
  const halves = line
    .split(new RegExp(HEMISTICH_GAP.source, "g"))
    .map((half) => half.trim())
    .filter(Boolean);
  const verses: { sadr: string; ajuz: string }[] = [];
  for (let i = 0; i < halves.length; i += 2) {
    verses.push({ sadr: halves[i], ajuz: halves[i + 1] ?? "" });
  }
  return verses;
}

// Forme simplifiée des mots, pour repérer un vers répété.
const verseWords = (verse: { sadr: string; ajuz: string }) =>
  `${verse.sadr} ${verse.ajuz}`.split(/\s+/).map(key).filter(Boolean);

// Vers déjà présent : ses mots se retrouvent tels quels dans les deux vers qui le précèdent
// (l'IA a parfois redonné le même vers, ou deux vers à la fois, une seconde fois).
function isRepeat(blocks: DocBlock[], verse: { sadr: string; ajuz: string }): boolean {
  const words = verseWords(verse).join(" ");
  if (!words) return true;
  const before = blocks
    .slice(-2)
    .filter((block) => block.type === "vers")
    .map((block) => verseWords(block as { sadr: string; ajuz: string }).join(" "))
    .join(" ");
  return before !== "" && ` ${before} `.includes(` ${words} `);
}

// Un vers à partir de ce que l'IA a rempli : sadr et ʿajuz ; ou le vers entier (« text ») avec
// une seule moitié, dont on déduit l'autre ; ou le vers entier seul, coupé au milieu entre deux mots.
// Jamais de doublon (avant : moitié + vers entier, affichés deux fois). Un « vers » trop long pour
// être un vers (commentaire mal rangé) renvoie null : il sera gardé comme paragraphe.
const MAX_VERSE_WORDS = 16;

export function rebuildVerse(
  sadr: string,
  ajuz: string,
  text: string,
): { sadr: string; ajuz: string } | null {
  if (sadr && ajuz) return { sadr, ajuz };
  // Trop long pour un vers, ou commentaire (« أي … », mot du poème entre parenthèses) mal rangé.
  if (text && (text.split(" ").length > MAX_VERSE_WORDS || /^أي\s|[()]/.test(text))) return null;
  if (text && sadr && text.startsWith(sadr) && text.length > sadr.length) {
    return { sadr, ajuz: text.slice(sadr.length).trim() };
  }
  if (text && ajuz && text.endsWith(ajuz) && text.length > ajuz.length) {
    return { sadr: text.slice(0, -ajuz.length).trim(), ajuz };
  }
  if (text && text !== sadr && text !== ajuz) return splitInHalf(text);
  if (sadr || ajuz || text) return { sadr: sadr || (ajuz ? "" : text), ajuz };
  return null;
}

// Coupe un vers écrit d'un seul tenant en deux moitiés de longueur proche, entre deux mots.
function splitInHalf(line: string): { sadr: string; ajuz: string } {
  const words = line.split(" ");
  if (words.length < 2) return { sadr: line, ajuz: "" };
  let best = 1;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ").length;
    const bestLeft = words.slice(0, best).join(" ").length;
    if (Math.abs(left - line.length / 2) < Math.abs(bestLeft - line.length / 2)) best = i;
  }
  return { sadr: words.slice(0, best).join(" "), ajuz: words.slice(best).join(" ") };
}

// Les textes à vocaliser, dans l'ordre : un par bloc, deux pour un vers (sadr puis ʿajuz).
export function blockTexts(pages: DocPage[]): string[] {
  return pages.flatMap((page) =>
    page.blocks.flatMap((block) => (block.type === "vers" ? [block.sadr, block.ajuz] : [block.text])),
  );
}

// Forme d'un mot pour comparer : sans harakat, sans ponctuation, sans marques ⟦ ⟧, avec les formes
// de l'alif, de la ta marbuta, du ya et de la hamza unifiées (les sous-titres automatiques écrivent
// « اشهد ان », « مساله » : ce n'est pas un autre mot que « أَشْهَدُ أَنْ », « مَسْأَلَة »).
function key(word: string): string {
  return word
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function sameWords(before: string, after: string): boolean {
  const a = before.split(/\s+/).map(key).filter(Boolean);
  const b = after.split(/\s+/).map(key).filter(Boolean);
  return a.length === b.length && a.every((word, i) => word === b[i]);
}

// Distance d'édition entre deux mots (lettres à changer, ajouter ou enlever).
function distance(a: string, b: string): number {
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

// Compare un texte et sa version vocalisée, mot par mot.
// - mêmes mots : la version vocalisée est gardée telle quelle ;
// - quelques mots légèrement changés par l'IA (lettre mal lue sur le scan, ou orthographe de l'auteur
//   « corrigée » : 2 lettres au plus, 1 mot sur 4 au plus) : le bloc garde ses harakat, mais ces mots
//   reprennent les lettres d'origine, entourés de ⟦ ⟧ (en rouge, à vérifier par l'utilisateur) ;
// - sinon (mots ajoutés, retirés, réécrits) : null, le texte d'origine est gardé.
export function checkVocalized(before: string, after: string): { text: string; flagged: number } | null {
  const a = before.split(/\s+/).filter((word) => key(word));
  const tokens = after.split(/\s+/).filter(Boolean);
  const b = tokens.map((word, index) => ({ word, index })).filter(({ word }) => key(word));
  if (a.length !== b.length) return null;
  const changed: { index: number; original: string }[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = key(a[i]);
    const y = key(b[i].word);
    if (x === y) continue;
    if (distance(x, y) > 2) return null;
    changed.push({ index: b[i].index, original: a[i] });
  }
  if (changed.length > Math.max(1, Math.floor(a.length / 4))) return null;
  for (const { index, original } of changed) {
    tokens[index] = `⟦${original.replace(/[⟦⟧]/g, "")}⟧`;
  }
  return { text: tokens.join(" "), flagged: changed.length };
}

// Remet les textes vocalisés dans les blocs, après vérification (voir `checkVocalized`).
// - réponse illisible ou nombre de textes différent : `ok` faux, rien n'est appliqué ;
// - un texte réécrit : ce bloc garde le texte d'origine (sans harakat) ;
// - un mot légèrement corrigé : harakat gardées, mot en rouge (`flagged`).
export function applyVocalized(
  pages: DocPage[],
  answer: unknown,
): { pages: DocPage[]; ok: boolean; failed: number; flagged: number } {
  const original = blockTexts(pages);
  if (!Array.isArray(answer) || answer.length !== original.length) {
    return { pages, ok: false, failed: original.length, flagged: 0 };
  }
  let failed = 0;
  let flagged = 0;
  const texts = answer.map((item, i) => {
    const checked = checkVocalized(original[i], oneLine(item));
    if (checked) {
      flagged += checked.flagged;
      return checked.text;
    }
    failed++;
    return original[i];
  });
  let next = 0;
  const vocalized = pages.map((page) => ({
    page: page.page,
    blocks: page.blocks.map((block): DocBlock => {
      if (block.type === "vers") return { type: "vers", sadr: texts[next++], ajuz: texts[next++] };
      return { ...block, text: texts[next++] };
    }),
  }));
  return { pages: vocalized, ok: true, failed, flagged };
}

// Écrit les pages en texte, une ligne par bloc.
export function pagesToText(pages: DocPage[]): string {
  return pages
    .flatMap((page) => [
      `— Page ${page.page} —`,
      ...page.blocks.map((block) => {
        if (block.type === "titre") return `## ${block.text}`;
        if (block.type === "vers") return `@@ ${block.sadr} ‖ ${block.ajuz}`;
        if (block.type === "note") return `^^ ${block.text}`;
        return block.text;
      }),
    ])
    .join("\n");
}

// Compte les blocs d'un texte écrit par `pagesToText` (pour vérifier la structure).
export function countBlocks(text: string): Record<DocBlock["type"], number> {
  const count = { titre: 0, paragraphe: 0, vers: 0, note: 0 };
  for (const line of text.split("\n")) {
    if (!line.trim() || /^— Page \d+ —$/.test(line.trim())) continue;
    if (line.startsWith("## ")) count.titre++;
    else if (line.startsWith("@@ ")) count.vers++;
    else if (line.startsWith("^^ ")) count.note++;
    else count.paragraphe++;
  }
  return count;
}
