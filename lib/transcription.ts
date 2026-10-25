// Seul fichier qui connaît le service de transcription.
// Pour changer de fournisseur (étape 2), il suffit de modifier ce fichier :
// le reste de l'application n'utilise que `transcribe` et le type `Transcription`.
//
// Fournisseur actuel : ElevenLabs Scribe (https://elevenlabs.io).

export type TranscriptionWord = {
  text: string;
  start: number; // en secondes
  end: number; // en secondes
  confidence: number; // de 0 (pas sûr) à 1 (sûr)
};

export type Transcription = {
  languageCode: string; // code de la langue principale détectée, ex. "ara", "fra", "eng"
  text: string;
  words: TranscriptionWord[];
  durationSeconds: number | null;
};

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const ELEVENLABS_MODEL = "scribe_v2";

type ElevenLabsWord = {
  text: string;
  start?: number;
  end?: number;
  type: "word" | "spacing" | "audio_event";
  logprob: number;
};

type ElevenLabsResponse = {
  language_code: string;
  text: string;
  words: ElevenLabsWord[];
  audio_duration_secs?: number;
};

// `fileUrl` : lien temporaire vers le fichier audio ou vidéo déposé par l'utilisateur.
export async function transcribe(fileUrl: string): Promise<Transcription> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY manquante dans les variables d'environnement");
  }

  const form = new FormData();
  form.append("model_id", ELEVENLABS_MODEL);
  form.append("source_url", fileUrl);
  // Pas de language_code : la langue est détectée automatiquement.
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");

  const response = await fetch(ELEVENLABS_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`ElevenLabs a répondu ${response.status} : ${details}`);
  }

  const data = (await response.json()) as ElevenLabsResponse;

  return {
    languageCode: data.language_code,
    text: data.text,
    words: data.words
      .filter((word) => word.type === "word")
      .map((word) => ({
        text: word.text,
        start: word.start ?? 0,
        end: word.end ?? 0,
        confidence: Math.exp(word.logprob),
      })),
    durationSeconds: data.audio_duration_secs ?? null,
  };
}
