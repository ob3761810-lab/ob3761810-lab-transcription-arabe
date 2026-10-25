// Mode démonstration : utilisé tant que le stockage et la transcription ne sont pas configurés.
// Le fichier de l'utilisateur n'est envoyé nulle part ; on affiche ce texte d'exemple à la place.

import type { Transcription } from "@/lib/transcription";

export const DEMO_TRANSCRIPTION: Transcription = {
  languageCode: "ara",
  text: [
    "بسم الله، والحمد لله، والصلاة والسلام على رسول الله.",
    "أما بعد، فموضوع درسنا اليوم هو الصبر وفضله.",
    "Aujourd'hui, nous parlons de الصبر, c'est-à-dire la patience.",
    "الصبر ثلاثة أنواع: صبر على الطاعة، وصبر عن المعصية، وصبر على أقدار الله.",
    "Retenez bien ces trois catégories, nous y reviendrons en fin de cours.",
  ].join("\n"),
  words: [],
  durationSeconds: null,
};
