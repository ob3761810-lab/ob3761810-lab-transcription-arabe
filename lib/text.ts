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

// Mots dont Google n'est pas sûr (orthographe ou harakat) : il les entoure de ⟦ ⟧.
const DOUBT = /⟦([^⟦⟧]*)⟧/g;

export type Segment = { text: string; doubtful: boolean };

// Découpe une ligne en morceaux : texte normal et mots douteux.
export function splitDoubts(line: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of line.matchAll(DOUBT)) {
    if (match.index > last) segments.push({ text: line.slice(last, match.index), doubtful: false });
    segments.push({ text: match[1], doubtful: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last), doubtful: false });
  return segments;
}

// Le n-ième mot douteux d'un texte (en partant de 0).
export function doubtAt(text: string, n: number): string {
  return [...text.matchAll(DOUBT)][n]?.[1] ?? "";
}

// Remplace le n-ième mot douteux par `word` : il n'est plus signalé.
export function resolveDoubt(text: string, n: number, word: string): string {
  let count = 0;
  return text.replace(DOUBT, (whole) => (count++ === n ? word : whole));
}

export function countDoubts(text: string): number {
  return [...text.matchAll(DOUBT)].length;
}

export function removeDoubtMarks(text: string): string {
  return text.replace(/[⟦⟧]/g, "");
}

// Met en rouge (entoure de ⟦ ⟧) chaque apparition exacte de `word` qui n'est pas déjà signalée.
export function markWord(text: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alone = new RegExp(`(?<![\\p{L}\\p{M}⟦])${escaped}(?![\\p{L}\\p{M}⟧])`, "gu");
  return text.replace(alone, `⟦${word}⟧`);
}
