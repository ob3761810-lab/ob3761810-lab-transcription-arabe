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
  | { text: string; kind: "normal" | "doubt" | "fixed" }
  | { text: string; kind: "quran"; on: boolean; reference: string };

// Découpe une ligne en morceaux : texte normal, mots à vérifier, mots corrigés, passages coraniques.
export function splitMarks(line: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of line.matchAll(ANY_MARK)) {
    if (match.index > last) segments.push({ text: line.slice(last, match.index), kind: "normal" });
    if (match[1] !== undefined) segments.push({ text: match[1], kind: "doubt" });
    else if (match[2] !== undefined) segments.push({ text: match[2], kind: "fixed" });
    else {
      const on = match[3] === "on";
      segments.push({ text: on ? match[5] : match[6], kind: "quran", on, reference: match[4] });
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last), kind: "normal" });
  return segments;
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
