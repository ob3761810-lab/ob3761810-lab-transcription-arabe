"use client";

// Formulaire de dépôt : envoie le fichier vers le stockage privé,
// demande la transcription au serveur, puis affiche le texte brut.
// En mode démonstration, rien n'est envoyé : un texte d'exemple est affiché.

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { DEMO_TRANSCRIPTION } from "@/lib/demo";
import type { Transcription } from "@/lib/transcription";

type Status =
  | { step: "idle" }
  | { step: "uploading"; percent: number }
  | { step: "transcribing" }
  | { step: "done"; transcription: Transcription; fileName: string }
  | { step: "error"; message: string };

const LANGUAGE_NAMES: Record<string, string> = {
  ar: "Arabe",
  ara: "Arabe",
  fr: "Français",
  fra: "Français",
  en: "Anglais",
  eng: "Anglais",
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? `Autre langue (${code})`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${rest.toString().padStart(2, "0")} s`;
}

// Garde un nom de fichier simple (lettres, chiffres, tirets) pour le stockage.
function safeFileName(name: string): string {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_");
}

// `demo` vaut true tant que le stockage et la transcription ne sont pas configurés.
export default function UploadForm({ demo }: { demo: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ step: "idle" });

  const busy = status.step === "uploading" || status.step === "transcribing";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;

    if (demo) {
      setStatus({ step: "transcribing" });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setStatus({ step: "done", transcription: DEMO_TRANSCRIPTION, fileName: file.name });
      return;
    }

    try {
      setStatus({ step: "uploading", percent: 0 });
      const blob = await upload(`uploads/${safeFileName(file.name)}`, file, {
        access: "private",
        handleUploadUrl: "/api/upload",
        multipart: file.size > 50 * 1024 * 1024,
        // La progression peut arriver en retard : on ne l'affiche que pendant l'envoi.
        onUploadProgress: ({ percentage }) =>
          setStatus((current) =>
            current.step === "uploading"
              ? { step: "uploading", percent: Math.round(percentage) }
              : current,
          ),
      });

      setStatus({ step: "transcribing" });
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pathname: blob.pathname }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus({ step: "error", message: data.error });
        return;
      }
      setStatus({ step: "done", transcription: data, fileName: file.name });
    } catch (error) {
      console.error(error);
      setStatus({
        step: "error",
        message:
          "Le fichier n'a pas pu être envoyé. Vérifiez qu'il s'agit d'un fichier audio ou vidéo, puis réessayez.",
      });
    }
  }

  return (
    <div className="mt-8">
      {demo && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Mode démonstration</strong> : votre fichier reste sur votre ordinateur, rien
          n&apos;est envoyé. Un texte d&apos;exemple s&apos;affiche à la place de la vraie
          transcription.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center hover:border-emerald-400">
          <span dir="auto" className="block font-medium text-zinc-800">
            {file ? file.name : "Choisir un fichier audio ou vidéo"}
          </span>
          <span className="mt-1 block text-sm text-zinc-500">
            MP3, WAV, M4A, MP4, MOV… depuis votre ordinateur
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

      {status.step === "uploading" && (
        <p className="mt-6 text-zinc-700">Envoi du fichier… {status.percent} %</p>
      )}

      {status.step === "transcribing" && (
        <p className="mt-6 text-zinc-700">
          Transcription en cours… Cela peut prendre quelques minutes pour un long fichier.
        </p>
      )}

      {status.step === "error" && (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {status.message}
        </p>
      )}

      {status.step === "done" && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold text-zinc-900">Transcription brute</h2>
          <p className="mt-1 text-sm text-zinc-500">
            <bdi>{status.fileName}</bdi> · Langue principale détectée :{" "}
            {languageName(status.transcription.languageCode)}
            {status.transcription.durationSeconds !== null &&
              ` · Durée : ${formatDuration(status.transcription.durationSeconds)}`}
          </p>
          {demo ? (
            <p className="mt-2 text-sm font-medium text-amber-700">
              Exemple de démonstration : ce n&apos;est pas la transcription de votre fichier.
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-700">
              Texte non relu : il peut contenir des erreurs.
            </p>
          )}
          {/* Chaque ligne prend le sens de sa propre langue :
              arabe de droite à gauche, français/anglais de gauche à droite. */}
          <div className="transcript mt-4 space-y-2 rounded-xl border border-zinc-200 bg-white p-6 text-lg leading-loose text-zinc-900">
            {status.transcription.text
              .split("\n")
              .filter((line) => line.trim() !== "")
              .map((line, index) => (
                <p key={index} dir="auto">
                  {line}
                </p>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
