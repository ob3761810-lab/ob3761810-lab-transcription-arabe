// Structure d'un PDF (livre) : liste de blocs typés par page, sans IA.
// - lecture et vérification de la structure renvoyée par l'IA (titres, paragraphes, vers, notes) ;
// - vocalisation bloc par bloc, avec vérification automatique : même nombre de blocs, même ordre,
//   mêmes mots (harakat mises à part). Un bloc modifié reste sans harakat ;
// - écriture en texte, une ligne par bloc, pour l'affichage et les exports :
//     « ## titre », « @@ sadr ‖ ʿajuz » (vers), « ^^ note », « — Page 3 — », paragraphe tel quel.

export type DocBlock =
  | { type: "titre"; text: string }
  | { type: "paragraphe"; text: string }
  | { type: "vers"; sadr: string; ajuz: string }
  | { type: "note"; text: string };

export type DocPage = { page: number; blocks: DocBlock[] };

// Un bloc tient sur une seule ligne : les retours à la ligne du PDF deviennent des espaces.
// Les caractères réservés à l'écriture des blocs sont retirés.
function oneLine(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[‖⟪⟫]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

// Lit la structure renvoyée par l'IA : { pages: [{ page, blocks: [{ type, text | sadr, ajuz }] }] }.
// `firstPage` : numéro, dans le PDF d'origine, de la première page envoyée.
export function parseStructure(data: unknown, firstPage: number): DocPage[] {
  const pages = (data as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) throw new Error("Structure illisible");
  return pages.map((page, index) => {
    const blocks: DocBlock[] = [];
    for (const raw of Array.isArray(page?.blocks) ? page.blocks : []) {
      const type = raw?.type;
      if (type === "vers") {
        const sadr = oneLine(raw.sadr);
        const ajuz = oneLine(raw.ajuz);
        if (sadr || ajuz) blocks.push({ type, sadr, ajuz });
      } else if (type === "titre" || type === "paragraphe" || type === "note") {
        const text = oneLine(raw.text);
        if (text) blocks.push({ type, text });
      }
    }
    return { page: firstPage + index, blocks };
  });
}

// Les textes à vocaliser, dans l'ordre : un par bloc, deux pour un vers (sadr puis ʿajuz).
export function blockTexts(pages: DocPage[]): string[] {
  return pages.flatMap((page) =>
    page.blocks.flatMap((block) => (block.type === "vers" ? [block.sadr, block.ajuz] : [block.text])),
  );
}

// Forme d'un mot pour comparer : sans harakat, sans ponctuation, sans marques ⟦ ⟧,
// avec les formes de l'alif, de la ta marbuta et du ya unifiées.
function key(word: string): string {
  return word
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function sameWords(before: string, after: string): boolean {
  const a = before.split(/\s+/).map(key).filter(Boolean);
  const b = after.split(/\s+/).map(key).filter(Boolean);
  return a.length === b.length && a.every((word, i) => word === b[i]);
}

// Remet les textes vocalisés dans les blocs, après vérification.
// - réponse illisible ou nombre de textes différent : `ok` faux, rien n'est appliqué ;
// - un texte dont les mots ont changé : ce bloc garde le texte d'origine (sans harakat).
export function applyVocalized(
  pages: DocPage[],
  answer: unknown,
): { pages: DocPage[]; ok: boolean; failed: number } {
  const original = blockTexts(pages);
  if (!Array.isArray(answer) || answer.length !== original.length) {
    return { pages, ok: false, failed: original.length };
  }
  let failed = 0;
  const texts = answer.map((item, i) => {
    const text = oneLine(item);
    if (text && sameWords(original[i], text)) return text;
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
  return { pages: vocalized, ok: true, failed };
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
