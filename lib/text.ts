// Petits outils sur le texte, partagés par la page et le fichier Word.

const ARABIC_LETTER = /[؀-ۿ]/;

// Une ligne est en arabe si sa première lettre est arabe
// (sans compter l'état et la référence d'un passage coranique, écrits en lettres latines).
export function isArabic(line: string): boolean {
  const visible = line.replace(/⟪(?:on|off)\|[^|⟪⟫]*\|/g, "");
  const firstLetter = visible.match(/[A-Za-zÀ-ÿ؀-ۿ]/)?.[0] ?? "";
  return ARABIC_LETTER.test(firstLetter);
}

// Enlève les harakat (voyelles et signes de vocalisation) d'un texte arabe.
// La chadda (\u0651) est conservée : elle marque une lettre doublée et peut changer le sens du mot.
export function removeHarakat(text: string): string {
  return text.replace(/[\u064B-\u0650\u0652-\u065F\u0670\u06D6-\u06ED]/g, "");
}

// Affiche un minutage : 0:00, 2:00… ou 1:02:00 au-delà d'une heure.
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(Math.floor(seconds % 60)).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

// Découpe un texte en lignes non vides.
export function toLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

// Marques dans le texte :
// ⟦mot⟧ = mot à vérifier (en rouge) ; ⟨mot⟩ = mot corrigé ou confirmé par l'utilisateur
// (souligné en vert à l'écran, normal dans le PDF et le Word, et toujours modifiable).
const MARK = /⟦([^⟦⟧⟨⟩]*)⟧|⟨([^⟦⟧⟨⟩]*)⟩/g;
const DOUBT = /⟦[^⟦⟧⟨⟩]*⟧/g;

// Passage coranique remplacé par le texte officiel (voir lib/quran.ts) :
// ⟪on|référence|texte officiel|texte de l'IA⟫ ; « off » quand l'utilisateur a annulé le remplacement.
const QURAN = /⟪(on|off)\|([^|⟪⟫]*)\|([^|⟪⟫]*)\|([^|⟪⟫]*)⟫/g;
const ANY_MARK = /⟦([^⟦⟧⟨⟩]*)⟧|⟨([^⟦⟧⟨⟩]*)⟩|⟪(on|off)\|([^|⟪⟫]*)\|([^|⟪⟫]*)\|([^|⟪⟫]*)⟫/g;

export type Segment =
  | { text: string; kind: "normal"; start: number } // start : position dans la ligne
  | { text: string; kind: "doubt" | "fixed" }
  | { text: string; kind: "quran"; on: boolean; reference: string };

// Découpe une ligne en morceaux : texte normal, mots à vérifier, mots corrigés, passages coraniques.
export function splitMarks(line: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of line.matchAll(ANY_MARK)) {
    if (match.index > last) {
      segments.push({ text: line.slice(last, match.index), kind: "normal", start: last });
    }
    if (match[1] !== undefined) segments.push({ text: match[1], kind: "doubt" });
    else if (match[2] !== undefined) segments.push({ text: match[2], kind: "fixed" });
    else {
      const on = match[3] === "on";
      segments.push({ text: on ? match[5] : match[6], kind: "quran", on, reference: match[4] });
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last), kind: "normal", start: last });
  return segments;
}

// Découpe un morceau de texte en mots et en séparateurs (espaces, ponctuation),
// avec la position de chaque morceau.
export function splitWords(text: string): { text: string; start: number; word: boolean }[] {
  const pieces: { text: string; start: number; word: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(/[\p{L}\p{M}]+/gu)) {
    if (match.index > last) pieces.push({ text: text.slice(last, match.index), start: last, word: false });
    pieces.push({ text: match[0], start: match.index, word: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), start: last, word: false });
  return pieces;
}

// Remplace le texte entre `start` et `end` par `word`, marqué comme corrigé.
export function replaceRange(text: string, start: number, end: number, word: string): string {
  return `${text.slice(0, start)}⟨${word}⟩${text.slice(end)}`;
}

// Les parenthèses coraniques ﴿ ﴾ entourent les versets, pas l'isti'adha (formule, pas un verset).
export function quranBrackets(text: string, reference: string): string {
  return reference.startsWith("Isti'adha") ? text : `﴿${text}﴾`;
}

// Active ou annule le remplacement du n-ième passage coranique d'un texte.
export function toggleQuran(text: string, n: number): string {
  let count = 0;
  return text.replace(QURAN, (whole, state, reference, official, original) =>
    count++ === n ? `⟪${state === "on" ? "off" : "on"}|${reference}|${official}|${original}⟫` : whole,
  );
}

// Remplace chaque passage coranique par le texte affiché (officiel, ou celui de l'IA si annulé).
function showQuran(text: string): string {
  return text.replace(QURAN, (_, state, _reference, official, original) =>
    state === "on" ? official : original,
  );
}

// Le n-ième mot marqué (à vérifier ou corrigé) d'un texte, en partant de 0.
export function markAt(text: string, n: number): string {
  const match = [...text.matchAll(MARK)][n];
  return match ? (match[1] ?? match[2]) : "";
}

// Remplace le n-ième mot marqué par `word`, désormais marqué comme corrigé.
export function fixMark(text: string, n: number, word: string): string {
  let count = 0;
  return text.replace(MARK, (whole) => (count++ === n ? `⟨${word}⟩` : whole));
}

export function countDoubts(text: string): number {
  return [...text.matchAll(DOUBT)].length;
}

// Texte sans aucune marque (pour la traduction).
export function removeMarks(text: string): string {
  return showQuran(text).replace(/[⟦⟧⟨⟩]/g, "");
}

// Texte sans les marques des mots corrigés, mais avec les mots à vérifier (pour la relecture).
// Les passages coraniques remplacés sont retirés : le texte officiel n'est jamais relu par l'IA.
export function removeFixedMarks(text: string): string {
  return text.replace(QURAN, (whole, state) => (state === "on" ? " … " : showQuran(whole))).replace(/[⟨⟩]/g, "");
}

// Met en rouge (entoure de ⟦ ⟧) chaque apparition exacte de `word` qui n'est pas déjà marquée.
export function markWord(text: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alone = new RegExp(`(?<![\\p{L}\\p{M}⟦⟨])${escaped}(?![\\p{L}\\p{M}⟧⟩])`, "gu");
  // Jamais à l'intérieur d'un passage coranique.
  return text
    .split(/(⟪[^⟪⟫]*⟫)/)
    .map((piece) => (piece.startsWith("⟪") ? piece : piece.replace(alone, `⟦${word}⟧`)))
    .join("");
}

// Découpe un long texte collé en morceaux d'environ `size` caractères, en coupant entre
// les paragraphes (ou, pour un paragraphe trop long, après une fin de phrase).
export function splitText(text: string, size = 2500): string[] {
  const pieces: string[] = [];
  let current = "";
  const add = (block: string) => {
    if (current && current.length + block.length + 1 > size) {
      pieces.push(current);
      current = "";
    }
    current = current ? `${current}\n${block}` : block;
  };
  for (const paragraph of text.split("\n")) {
    if (paragraph.length <= size) {
      add(paragraph);
      continue;
    }
    for (const sentence of paragraph.match(/[^.!?؟۔]+[.!?؟۔]*\s*/g) ?? [paragraph]) {
      for (let start = 0; start < sentence.length; start += size) add(sentence.slice(start, start + size));
    }
  }
  if (current.trim()) pieces.push(current);
  return pieces.filter((piece) => piece.trim() !== "");
}

// Genre d'une ligne de texte :
// « ## … » titre ou intertitre ; « @@ sadr ‖ ʿajuz » vers de poésie (PDF) ; « ^^ … » note de bas de
// page (PDF) ; « — Page 3 — » repère de page (PDF) ; « [4:05] … » paragraphe avec repère de temps
// (sous-titres) ; sinon paragraphe. `skip` : longueur du préfixe à ne pas afficher.
export type LineKind = "heading" | "verse" | "note" | "page" | "text";

export function lineStyle(line: string): {
  kind: LineKind;
  heading: boolean;
  stamp: string | null;
  skip: number;
} {
  if (line.startsWith("## ")) return { kind: "heading", heading: true, stamp: null, skip: 3 };
  if (line.startsWith("@@ ")) return { kind: "verse", heading: false, stamp: null, skip: 3 };
  if (line.startsWith("^^ ")) return { kind: "note", heading: false, stamp: null, skip: 3 };
  if (/^— Page \d+ —$/.test(line.trim())) return { kind: "page", heading: false, stamp: null, skip: 0 };
  const stamp = line.match(/^\[(\d+:\d{2}(?::\d{2})?)\] /);
  return { kind: "text", heading: false, stamp: stamp?.[1] ?? null, skip: stamp?.[0].length ?? 0 };
}

// Vers « sadr ‖ ʿajuz » : les deux hémistiches et la position du second dans `body`.
export const VERSE_SEPARATOR = " ‖ ";
export function splitVerse(body: string): { sadr: string; ajuz: string; ajuzStart: number } {
  const at = body.indexOf(VERSE_SEPARATOR);
  if (at === -1) return { sadr: body, ajuz: "", ajuzStart: body.length };
  return {
    sadr: body.slice(0, at),
    ajuz: body.slice(at + VERSE_SEPARATOR.length),
    ajuzStart: at + VERSE_SEPARATOR.length,
  };
}

// Texte pour la traduction : sans préfixes de mise en page (vers écrits « sadr — ʿajuz »).
export function plainLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => lineStyle(line).kind !== "page")
    .map((line) => {
      const { kind, skip } = lineStyle(line);
      const body = line.slice(skip);
      if (kind !== "verse") return line.startsWith("## ") || line.startsWith("^^ ") ? body : line;
      const { sadr, ajuz } = splitVerse(body);
      return `${sadr} — ${ajuz}`;
    })
    .join("\n");
}

// Texte à modifier librement : un paragraphe par bloc, versets écrits « ﴿…﴾ (référence) »,
// sans les autres marques.
export function toEditable(text: string): string {
  return text
    .replace(QURAN, (_, state, reference, official, original) =>
      state === "on" ? `${quranBrackets(official, reference)} (${reference})` : original,
    )
    .replace(/[⟦⟧⟨⟩]/g, "")
    .split("\n")
    .join("\n\n");
}

// Retour au texte de l'application après modification libre. Les versets laissés tels quels
// restent marqués (texte officiel, référence, annulation possible) ; un verset modifié devient
// du texte ordinaire.
export function fromEditable(edited: string, previous: string): string {
  let text = edited
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  for (const match of previous.matchAll(QURAN)) {
    if (match[1] !== "on") continue;
    const written = `${quranBrackets(match[3], match[2])} (${match[2]})`;
    text = text.split(written).join(match[0]);
  }
  return text;
}
