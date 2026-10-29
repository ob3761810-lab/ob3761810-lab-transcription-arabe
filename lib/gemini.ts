// Seul fichier qui parle à l'intelligence artificielle (Google Gemini, offre gratuite).
// Utilisé uniquement côté serveur : la clé GEMINI_API_KEY n'est jamais envoyée au navigateur.

// Version normale (meilleure qualité) et version légère (plus rapide, limite gratuite séparée).
// C'est l'utilisateur qui choisit la version : aucune bascule automatique de l'une à l'autre.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const LITE_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";

export type Version = "normale" | "legere";

export function toVersion(value: unknown): Version {
  return value === "legere" ? "legere" : "normale";
}

// Erreur levée quand la limite gratuite de Google est atteinte (trop de demandes d'un coup).
export class RateLimitError extends Error {}

// Erreur levée quand Google est momentanément surchargé ou indisponible.
export class BusyError extends Error {}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

// `json` : demande à Google une réponse au format JSON (pour la relecture).
// `system` : consignes générales (prompt système), plus strictes que le texte de la demande.
async function callModel(
  model: string,
  parts: GeminiPart[],
  json = false,
  system?: string,
): Promise<string> {
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
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
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

// Interroge la version choisie par l'utilisateur.
async function askGemini(
  parts: GeminiPart[],
  version: Version,
  json = false,
  system?: string,
): Promise<string> {
  return callModel(version === "legere" ? LITE_MODEL : MODEL, parts, json, system);
}

const TRANSCRIPTION_RULES = `Transcribe this audio recording exactly as spoken.
Rules:
- Write every word in the language it is spoken in (Arabic, French or English, possibly mixed). Never translate.
- Add full harakat (tashkil) to every Arabic word. Do not add anything to French or English words.
- Start a new line at the end of each sentence.
- If you are not sure about the spelling or the harakat of an Arabic word (unclear audio, uncertain ending), wrap that single word in ⟦ and ⟧, for example ⟦كَلِمَةٌ⟧. Do this only for genuinely uncertain words, never for whole sentences.
- Output only the transcription: no title, no comment, no explanation.
- Never add a verse number, a hadith reference or a scholar's name that is not spoken in the audio.
- If there is no speech, output nothing.`;

// `audio` : un extrait au format WAV (quelques minutes au maximum).
export async function transcribeWithHarakat(audio: ArrayBuffer, version: Version): Promise<string> {
  return askGemini(
    [
      { inline_data: { mime_type: "audio/wav", data: Buffer.from(audio).toString("base64") } },
      { text: TRANSCRIPTION_RULES },
    ],
    version,
  );
}

// Lecture d'un PDF (texte ou scan) : texte de chaque page avec les harakat sur l'arabe.
// `pdf` contient les pages `firstPage` à `lastPage` du document d'origine.
export async function vocalizePdf(
  pdf: ArrayBuffer,
  version: Version,
  firstPage: number,
  lastPage: number,
): Promise<string> {
  const rules = `This PDF contains pages ${firstPage} to ${lastPage} of a document.
Copy the text of every page, in reading order.
Rules:
- Before the text of each page, write a line containing only: — Page N — (N = ${firstPage} for the first page of this PDF, then ${firstPage + 1}, and so on).
- Keep the words exactly as written. Never translate, never summarize, never skip a passage.
- Add full harakat (tashkil) to every Arabic word, according to the grammar of the sentence. Keep a harakah already written in the PDF unless it is clearly wrong.
- Do not add anything to French or English words.
- Start a new line at the end of each sentence or line of verse.
- If you are not sure about the spelling or the harakat of an Arabic word, wrap that single word in ⟦ and ⟧. Do this only for genuinely uncertain words.
- Ignore page headers, footers and page numbers printed on the page.
- Output only the text: no title, no comment, no explanation.
- Never add a verse number, a hadith reference or a scholar's name that is not written in the PDF.`;
  return askGemini(
    [
      { inline_data: { mime_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } },
      { text: rules },
    ],
    version,
  );
}

// Texte collé par l'utilisateur : on ajoute les harakat sans rien changer d'autre.
// Les harakat déjà écrites par l'auteur sont gardées ; on complète seulement les manquantes.
export async function vocalizeText(text: string, version: Version): Promise<string> {
  const rules = `Add harakat (tashkil) to the following text.
Rules:
- Keep every word exactly as written, in the same order. Never translate, never summarize, never correct the wording.
- Keep every harakah already written in the text exactly as it is, and add only the missing harakat, so that every Arabic word is fully vocalized according to the grammar of the sentence.
- Keep the same line breaks as the original text.
- Do not add anything to French or English words.
- If you are not sure about the harakat of an Arabic word, wrap that single word in ⟦ and ⟧. Do this only for genuinely uncertain words.
- Output only the vocalized text: no title, no comment, no explanation.
- Never add a verse number, a hadith reference or a scholar's name that is not in the text.

Text:
`;
  return askGemini([{ text: rules + text }], version);
}

export const LANGUAGES = {
  fr: "French",
  en: "English",
  ar: "Arabic with full harakat",
} as const;

export type Language = keyof typeof LANGUAGES;

export async function translate(
  text: string,
  language: Language,
  version: Version,
): Promise<string> {
  return askGemini(
    [
    {
      text: `Translate the following text into ${LANGUAGES[language]}.
Rules:
- Keep one line of translation for each line of the original.
- Output only the translation: no title, no comment, no explanation.
- Never add a verse number, a hadith reference or a scholar's name that is not in the text.

${text}`,
      },
    ],
    version,
  );
}

// Un mot probablement faux repéré par la relecture, avec 1 à 4 corrections proposées.
export type Issue = { word: string; suggestions: string[]; reason: string };

const CHECK_RULES = `You are proofreading a transcription of a religious lesson. Arabic words carry full harakat.
Find Arabic words that are probably wrong: spelling mistakes (for example ta marbuta ة written as ha ه,
wrong hamza), harakat that contradict the grammar (i'rab), and agreement mistakes (for example a singular
pronoun referring to a plural). Use the context of the sentence.
Words written between ⟦ and ⟧ were already flagged as uncertain: always include each of them in the list.
Answer with a JSON array, at most 60 items, each item being:
{"word": the word copied exactly as it appears in the text, with its harakat, without ⟦ ⟧,
 "suggestions": an array of 1 to 4 possible corrected words with full harakat, the most likely first,
 "reason": a very short explanation in French}
List only words that are really probably wrong, plus the flagged ones. If everything is correct, answer [].
Never add a verse number, a hadith reference or a scholar's name.

Text:
`;

// Relit le texte et renvoie les mots probablement faux, avec une correction proposée.
export async function checkText(text: string, version: Version): Promise<Issue[]> {
  const answer = await askGemini([{ text: CHECK_RULES + text }], version, true);
  const cleaned = answer.replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is Issue =>
        typeof item?.word === "string" &&
        item.word.trim() !== "" &&
        Array.isArray(item.suggestions) &&
        typeof item.reason === "string",
    )
    .map((item) => ({
      word: item.word.replace(/[⟦⟧]/g, "").trim(),
      suggestions: [
        ...new Set(
          item.suggestions
            .filter((word): word is string => typeof word === "string" && word.trim() !== "")
            .map((word) => word.trim()),
        ),
      ].slice(0, 4),
      reason: item.reason,
    }));
}

const SUGGEST_RULES = `A word in this transcription of a religious lesson may be wrong (misheard, misspelled or with wrong harakat).
Propose what the speaker most probably said, using the sentence around it.
Answer with a JSON object:
{"suggestions": an array of 1 to 4 possible words with full harakat (Arabic) or correct spelling (French, English), the most likely first; include the word itself with corrected harakat if it is probably right,
 "reason": a very short explanation in French}
Never add a verse number, a hadith reference or a scholar's name.
`;

// Propose des corrections pour un mot choisi par l'utilisateur, d'après la phrase autour.
export async function suggestWord(word: string, context: string, version: Version): Promise<Issue> {
  const prompt = `${SUGGEST_RULES}\nSentence: ${context}\nWord: ${word}`;
  const answer = await askGemini([{ text: prompt }], version, true);
  const parsed: unknown = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  const data = (parsed ?? {}) as { suggestions?: unknown; reason?: unknown };
  const suggestions = Array.isArray(data.suggestions)
    ? data.suggestions
        .filter((choice): choice is string => typeof choice === "string" && choice.trim() !== "")
        .map((choice) => choice.trim())
    : [];
  return {
    word,
    suggestions: [...new Set(suggestions)].slice(0, 4),
    reason: typeof data.reason === "string" ? data.reason : "",
  };
}

// Mise en forme de sous-titres nettoyés. Le code vérifie ensuite que les mots n'ont pas changé
// (lib/subtitles.ts) : si l'IA a reformulé, sa réponse est refusée.
const FORMAT_RULES = `You format the transcript of a lecture or a course (subtitles), in Arabic, French or English, possibly mixed.
The words belong to the speaker. Your job is only to make the text readable, never to change what was said.

You may ONLY do these four things:
1. Delete hesitation sounds and filler noises: euh, heu, hum, hmm, bah, ben (only when it is a filler), uh, um, ممم, إيه, آه, امم.
   Delete involuntary immediate repetitions of the same word or words: "le le" becomes "le", "في في" becomes "في".
2. Add punctuation and capital letters at the start of sentences. Use Arabic punctuation (، ؛ ؟) in Arabic sentences.
3. Split the text into logical paragraphs, separated by one empty line.
4. Only when the topic clearly changes, insert a short heading on its own line starting with "## ", in the language of the following paragraph, made of words taken from that paragraph. Headings must be rare.

ABSOLUTE RULES (never break them):
- Keep every other word exactly as written, in the same order, in the same language and the same spelling.
- Never rephrase, summarize, shorten, translate, complete, explain or correct the content, the grammar, the spelling or the vocabulary, even if the speaker makes a mistake or a sentence is unfinished.
- Never delete a word that carries meaning, even if it looks like a verbal tic: يعني، طيب، إذن، bon, alors, donc, voilà, en fait, quand ils font partie de la phrase. When in doubt, keep the word.
- The text may start or end in the middle of a sentence: leave it as it is.
- Do not add or remove harakat. Do not add verse numbers, hadith references, scholar names, notes or comments.
- Output only the formatted text.`;

export async function formatSubtitles(text: string, version: Version): Promise<string> {
  return askGemini([{ text: `Transcript to format:\n${text}` }], version, false, FORMAT_RULES);
}
