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

// Remet les harakat sur des textes, mot par mot (méthode de l'alignement, comme deux listes mises
// côte à côte). Les mots d'origine et les mots vocalisés sont mis en correspondance dans l'ordre,
// sans tenir compte de la façon dont l'IA a coupé ou réuni les textes :
// - mot retrouvé (mêmes lettres, harakat, hamza et ta marbuta mises à part) : il prend ses harakat ;
// - mot légèrement changé par l'IA (2 lettres au plus) : les lettres d'origine sont gardées, en rouge ;
// - mot que l'IA a réuni, coupé ou réécrit : le mot d'origine est gardé tel quel ;
// - texte dont moins de la moitié des mots sont retrouvés : gardé entièrement tel quel (`failed`).
// Le nombre et l'ordre des textes d'origine ne changent jamais.
export function alignVocalized(
  originals: string[],
  answers: string[],
): { texts: string[]; failed: number; flagged: number } {
  type Word = { item: number; token: number; key: string };
  const tokens = originals.map((text) => text.split(/\s+/).filter(Boolean));
  const a: Word[] = [];
  tokens.forEach((list, item) =>
    list.forEach((token, index) => {
      const k = key(token);
      if (k) a.push({ item, token: index, key: k });
    }),
  );
  const b = answers
    .flatMap((text) => text.split(/\s+/))
    .filter((token) => key(token))
    .map((token) => ({ token, key: key(token) }));

  // Plus longue suite de mots communs (dans l'ordre), calculée de la fin vers le début.
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i].key === b[j].key
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  // Ce que devient chaque mot d'origine : mot vocalisé, mot d'origine en rouge, ou inchangé.
  const result = tokens.map((list) => [...list]);
  const found = originals.map(() => 0);
  const counted = originals.map(() => 0);
  a.forEach((word) => counted[word.item]++);
  let flagged = 0;
  // Trou entre deux mots retrouvés : si l'IA a remplacé autant de mots par des mots très proches,
  // les mots d'origine sont gardés en rouge ; sinon ils restent tels quels.
  const closeGap = (fromA: number, toA: number, fromB: number, toB: number) => {
    if (toA - fromA !== toB - fromB) return;
    for (let k = 0; k < toA - fromA; k++) {
      if (distance(a[fromA + k].key, b[fromB + k].key) > 2) return;
    }
    for (let k = fromA; k < toA; k++) {
      const word = a[k];
      result[word.item][word.token] = `⟦${tokens[word.item][word.token].replace(/[⟦⟧]/g, "")}⟧`;
      flagged++;
    }
  };
  let i = 0;
  let j = 0;
  let gapA = 0;
  let gapB = 0;
  while (i < n && j < m) {
    if (a[i].key === b[j].key) {
      closeGap(gapA, i, gapB, j);
      result[a[i].item][a[i].token] = b[j].token;
      found[a[i].item]++;
      i++;
      j++;
      gapA = i;
      gapB = j;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  closeGap(gapA, n, gapB, m);

  let failed = 0;
  const texts = originals.map((original, item) => {
    if (counted[item] > 0 && found[item] < counted[item] / 2) {
      failed++;
      return original;
    }
    return result[item].join(" ");
  });
  return { texts, failed, flagged };
}

// Un seul texte et sa version vocalisée (voir `alignVocalized`) ; null si le texte est réécrit.
export function checkVocalized(before: string, after: string): { text: string; flagged: number } | null {
  const { texts, failed, flagged } = alignVocalized([before], [after]);
  return failed ? null : { text: texts[0], flagged };
}

// Remet les textes vocalisés dans les blocs, mot par mot (voir `alignVocalized`). Le nombre, l'ordre
// et le type des blocs ne changent jamais, même si l'IA a réuni ou coupé des textes.
// `ok` faux seulement si la réponse est illisible (rien n'est appliqué).
export function applyVocalized(
  pages: DocPage[],
  answer: unknown,
): { pages: DocPage[]; ok: boolean; failed: number; flagged: number } {
  const original = blockTexts(pages);
  if (!Array.isArray(answer)) return { pages, ok: false, failed: original.length, flagged: 0 };
  const { texts, failed, flagged } = alignVocalized(
    original,
    answer.map((item) => oneLine(item)),
  );
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
