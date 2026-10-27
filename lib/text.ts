// Petits outils sur le texte, partagés par la page et le fichier Word.

const ARABIC_LETTER = /[؀-ۿ]/;

// Une ligne est en arabe si sa première lettre est arabe.
export function isArabic(line: string): boolean {
  const firstLetter = line.match(/[A-Za-zÀ-ÿ؀-ۿ]/)?.[0] ?? "";
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

export type Segment = { text: string; kind: "normal" | "doubt" | "fixed" };

// Découpe une ligne en morceaux : texte normal, mots à vérifier, mots corrigés.
export function splitMarks(line: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of line.matchAll(MARK)) {
    if (match.index > last) segments.push({ text: line.slice(last, match.index), kind: "normal" });
    segments.push(
      match[1] !== undefined ? { text: match[1], kind: "doubt" } : { text: match[2], kind: "fixed" },
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last), kind: "normal" });
  return segments;
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
  return text.replace(/[⟦⟧⟨⟩]/g, "");
}

// Texte sans les marques des mots corrigés, mais avec les mots à vérifier (pour la relecture).
export function removeFixedMarks(text: string): string {
  return text.replace(/[⟨⟩]/g, "");
}

// Met en rouge (entoure de ⟦ ⟧) chaque apparition exacte de `word` qui n'est pas déjà marquée.
export function markWord(text: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alone = new RegExp(`(?<![\\p{L}\\p{M}⟦⟨])${escaped}(?![\\p{L}\\p{M}⟧⟩])`, "gu");
  return text.replace(alone, `⟦${word}⟧`);
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
