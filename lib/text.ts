// Petits outils sur le texte, partagés par la page et le fichier Word.

const ARABIC_LETTER = /[؀-ۿ]/;

// Une ligne est en arabe si sa première lettre est arabe.
export function isArabic(line: string): boolean {
  const firstLetter = line.match(/[A-Za-zÀ-ÿ؀-ۿ]/)?.[0] ?? "";
  return ARABIC_LETTER.test(firstLetter);
}

// Enlève les harakat (voyelles et signes de vocalisation) d'un texte arabe.
export function removeHarakat(text: string): string {
  return text.replace(/[ً-ٰٟۖ-ۭ]/g, "");
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
