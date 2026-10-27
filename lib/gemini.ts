// Seul fichier qui parle à l'intelligence artificielle (Google Gemini, offre gratuite).
// Utilisé uniquement côté serveur : la clé GEMINI_API_KEY n'est jamais envoyée au navigateur.

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
// Modèle de secours, plus léger, utilisé quand le principal est surchargé ou que sa limite est atteinte.
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";

// Erreur levée quand la limite gratuite de Google est atteinte (trop de demandes d'un coup).
export class RateLimitError extends Error {}

// Erreur levée quand Google est momentanément surchargé ou indisponible.
export class BusyError extends Error {}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

async function callModel(model: string, parts: GeminiPart[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY manquante dans les variables d'environnement");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0 },
      }),
    },
  );

  if (response.status === 429) {
    throw new RateLimitError(await response.text());
  }
  if (response.status >= 500) {
    throw new BusyError(`Gemini a répondu ${response.status} : ${await response.text()}`);
  }
  if (!response.ok) {
    throw new Error(`Gemini a répondu ${response.status} : ${await response.text()}`);
  }

  const data = await response.json();
  const answer: { text?: string }[] = data.candidates?.[0]?.content?.parts ?? [];
  return answer
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

// Essaie le modèle principal, puis le modèle de secours s'il est saturé.
// `lite` indique que la réponse vient du modèle de secours.
async function askGemini(parts: GeminiPart[]): Promise<{ text: string; lite: boolean }> {
  try {
    return { text: await callModel(MODEL, parts), lite: false };
  } catch (error) {
    if (!(error instanceof RateLimitError || error instanceof BusyError)) throw error;
    console.error(`Modèle ${MODEL} saturé, passage à ${FALLBACK_MODEL} :`, error);
    return { text: await callModel(FALLBACK_MODEL, parts), lite: true };
  }
}

const TRANSCRIPTION_RULES = `Transcribe this audio recording exactly as spoken.
Rules:
- Write every word in the language it is spoken in (Arabic, French or English, possibly mixed). Never translate.
- Add full harakat (tashkil) to every Arabic word. Do not add anything to French or English words.
- Start a new line at the end of each sentence.
- Output only the transcription: no title, no comment, no explanation.
- Never add a verse number, a hadith reference or a scholar's name that is not spoken in the audio.
- If there is no speech, output nothing.`;

// `audio` : un extrait au format WAV (quelques minutes au maximum).
export async function transcribeWithHarakat(
  audio: ArrayBuffer,
): Promise<{ text: string; lite: boolean }> {
  return askGemini([
    { inline_data: { mime_type: "audio/wav", data: Buffer.from(audio).toString("base64") } },
    { text: TRANSCRIPTION_RULES },
  ]);
}

export const LANGUAGES = {
  fr: "French",
  en: "English",
  ar: "Arabic with full harakat",
} as const;

export type Language = keyof typeof LANGUAGES;

export async function translate(text: string, language: Language): Promise<string> {
  const { text: translation } = await askGemini([
    {
      text: `Translate the following text into ${LANGUAGES[language]}.
Rules:
- Keep one line of translation for each line of the original.
- Output only the translation: no title, no comment, no explanation.
- Never add a verse number, a hadith reference or a scholar's name that is not in the text.

${text}`,
    },
  ]);
  return translation;
}
