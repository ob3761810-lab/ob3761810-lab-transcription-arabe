"use client";

// Toute l'application : choisir un fichier, obtenir le texte avec les harakat,
// le traduire, puis le télécharger en PDF.

import { useEffect, useMemo, useRef, useState } from "react";
import { splitIntoWavChunks } from "@/lib/audio";

type Status =
  | { step: "idle" }
  | { step: "preparing" }
  | { step: "transcribing"; part: number; total: number; waiting: boolean }
  | { step: "done" }
  | { step: "error"; message: string; canResume: boolean };

const TRANSLATIONS = [
  { code: "fr", label: "Français" },
  { code: "en", label: "Anglais" },
  { code: "ar", label: "Arabe" },
] as const;

const RETRY_SECONDS = 30;
const MAX_RETRIES = 4;

const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// Une ligne est en arabe si sa première lettre est arabe.
function isArabic(line: string): boolean {
  const firstLetter = line.match(/[A-Za-zÀ-ÿ؀-ۿ]/)?.[0] ?? "";
  return /[؀-ۿ]/.test(firstLetter);
}

function Lines({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line, index) =>
          isArabic(line) ? (
            <p key={index} dir="rtl" className="font-arabic text-2xl leading-[2.2]">
              {line}
            </p>
          ) : (
            <p key={index} dir="ltr" className="text-lg leading-loose">
              {line}
            </p>
          ),
        )}
    </div>
  );
}

export default function Transcriber({ ready }: { ready: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ step: "idle" });
  const [transcript, setTranscript] = useState("");
  const [translation, setTranslation] = useState<{ label: string; text: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState("");
  // Extraits du fichier et numéro du prochain extrait à transcrire (pour « Reprendre »).
  const chunks = useRef<Blob[]>([]);
  const nextPart = useRef(0);

  const busy = status.step === "preparing" || status.step === "transcribing";

  // Adresse locale du fichier choisi, pour l'écouter ou le regarder dans la page.
  // Le fichier reste sur l'appareil : rien n'est envoyé.
  const mediaUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, [mediaUrl]);
  const isVideo = file?.type.startsWith("video/") ?? false;

  if (!ready) {
    return (
      <p className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
        L&apos;application n&apos;est pas encore activée : la clé Google Gemini n&apos;a pas été
        ajoutée.
      </p>
    );
  }

  // Transcrit un extrait. Si Google est saturé (limite gratuite ou surcharge),
  // on attend un peu puis on réessaie. En cas d'échec, l'erreur indique la cause.
  async function transcribePart(chunk: Blob, part: number, total: number): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch("/api/transcribe", { method: "POST", body: chunk });
      if (response.ok) return (await response.json()).text;
      const retryable = response.status === 429 || response.status === 503;
      if (!retryable || attempt === MAX_RETRIES) {
        throw new Error(response.status === 429 ? "limite" : "autre");
      }
      setStatus({ step: "transcribing", part, total, waiting: true });
      await wait(RETRY_SECONDS);
      setStatus({ step: "transcribing", part, total, waiting: false });
    }
  }

  // Transcrit les extraits à partir de `nextPart`, à la suite du texte déjà obtenu.
  async function transcribeRemainingParts(startText: string) {
    let text = startText;
    const total = chunks.current.length;
    try {
      for (let i = nextPart.current; i < total; i++) {
        setStatus({ step: "transcribing", part: i + 1, total, waiting: false });
        const partText = await transcribePart(chunks.current[i], i + 1, total);
        text = text && partText ? `${text}\n${partText}` : text || partText;
        setTranscript(text);
        nextPart.current = i + 1;
      }
      setStatus({ step: "done" });
    } catch (error) {
      console.error(error);
      const done = `${nextPart.current} partie(s) sur ${total} transcrite(s).`;
      setStatus({
        step: "error",
        canResume: true,
        message:
          error instanceof Error && error.message === "limite"
            ? `La limite gratuite de Google est atteinte pour le moment. ${done} Cliquez sur « Reprendre » plus tard (dans quelques minutes, ou demain si la limite du jour est atteinte).`
            : `La transcription s'est arrêtée en cours de route. ${done} Cliquez sur « Reprendre » pour continuer.`,
      });
    }
  }

  async function handleTranscribe(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setTranscript("");
    setTranslation(null);
    setTranslationError("");

    try {
      setStatus({ step: "preparing" });
      chunks.current = await splitIntoWavChunks(file);
      nextPart.current = 0;
    } catch (error) {
      console.error(error);
      setStatus({
        step: "error",
        canResume: false,
        message:
          "Ce fichier n'a pas pu être lu. Vérifiez qu'il s'agit bien d'un fichier audio ou vidéo. S'il est très long, essayez avec un fichier plus court.",
      });
      return;
    }

    await transcribeRemainingParts("");
  }

  async function handleTranslate(code: string, label: string) {
    setTranslating(true);
    setTranslationError("");
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: transcript, language: code }),
      });
      const data = await response.json();
      if (!response.ok) {
        setTranslationError(data.error);
        return;
      }
      setTranslation({ label, text: data.text });
    } catch (error) {
      console.error(error);
      setTranslationError("La traduction n'a pas pu être réalisée. Réessayez dans un instant.");
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="mt-8">
      <form onSubmit={handleTranscribe} className="no-print space-y-4">
        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center hover:border-emerald-400">
          <span dir="auto" className="block font-medium text-zinc-800">
            {file ? file.name : "Choisir un fichier audio ou vidéo"}
          </span>
          <span className="mt-1 block text-sm text-zinc-500">
            MP3, WAV, M4A, MP4, MOV… depuis votre ordinateur ou votre téléphone
          </span>
          <input
            type="file"
            accept="audio/*,video/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setStatus({ step: "idle" });
            }}
          />
        </label>

        <button
          type="submit"
          disabled={!file || busy}
          className="w-full rounded-xl bg-emerald-700 px-6 py-3 font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          Transcrire
        </button>
      </form>

      {mediaUrl && (
        <div className="no-print sticky top-0 z-10 -mx-2 mt-6 bg-white px-2 py-2">
          {isVideo ? (
            <video src={mediaUrl} controls className="max-h-64 w-full rounded-xl bg-black" />
          ) : (
            <audio src={mediaUrl} controls className="w-full" />
          )}
        </div>
      )}

      <div className="no-print">
        {status.step === "preparing" && (
          <p className="mt-6 text-zinc-700">Préparation du fichier…</p>
        )}
        {status.step === "transcribing" && (
          <p className="mt-6 text-zinc-700">
            {status.waiting
              ? `Limite gratuite de Google atteinte : nouvel essai dans ${RETRY_SECONDS} secondes…`
              : `Transcription en cours… partie ${status.part} sur ${status.total}`}
          </p>
        )}
        {status.step === "error" && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            <p>{status.message}</p>
            {status.canResume && (
              <button
                type="button"
                onClick={() => transcribeRemainingParts(transcript)}
                className="mt-3 rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800"
              >
                Reprendre
              </button>
            )}
          </div>
        )}
      </div>

      {transcript && (
        <div id="document" className="mt-8">
          <h2 className="text-xl font-semibold text-zinc-900">Transcription</h2>
          {file && (
            <p className="mt-1 text-sm text-zinc-500">
              <bdi>{file.name}</bdi>
            </p>
          )}
          <p className="mt-1 text-sm text-amber-700">
            Texte non relu : il peut contenir des erreurs de transcription ou de harakat.
          </p>
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-6 text-zinc-900">
            <Lines text={transcript} />
          </div>

          {translation && (
            <section className="mt-8">
              <h2 className="text-xl font-semibold text-zinc-900">
                Traduction ({translation.label})
              </h2>
              <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-6 text-zinc-900">
                <Lines text={translation.text} />
              </div>
            </section>
          )}
        </div>
      )}

      {status.step === "done" && transcript && (
        <div className="no-print mt-8 space-y-4">
          <div>
            <p className="font-medium text-zinc-900">Traduire en :</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TRANSLATIONS.map(({ code, label }) => (
                <button
                  key={code}
                  type="button"
                  disabled={translating}
                  onClick={() => handleTranslate(code, label)}
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-zinc-800 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
            {translating && <p className="mt-2 text-zinc-700">Traduction en cours…</p>}
            {translationError && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
                {translationError}
              </p>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full rounded-xl bg-zinc-900 px-6 py-3 font-medium text-white hover:bg-zinc-700"
            >
              Télécharger en PDF
            </button>
            <p className="mt-2 text-sm text-zinc-500">
              Dans la fenêtre qui s&apos;ouvre, choisissez « Enregistrer au format PDF » comme
              imprimante.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
