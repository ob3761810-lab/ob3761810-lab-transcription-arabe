"use client";

// Toute l'application : choisir un fichier, obtenir le texte avec les harakat,
// le traduire, puis le télécharger en PDF.

import { useEffect, useMemo, useRef, useState } from "react";
import { CHUNK_SECONDS, splitIntoWavChunks } from "@/lib/audio";
import { isPdf, PageTooLargeError, splitPdf } from "@/lib/pdf";
import type { Issue, Version } from "@/lib/gemini";
import {
  countDoubts,
  fixMark,
  formatTime,
  isArabic,
  markAt,
  markWord,
  removeFixedMarks,
  removeHarakat,
  removeMarks,
  splitMarks,
  toLines,
} from "@/lib/text";

type Status =
  | { step: "idle" }
  | { step: "preparing" }
  | { step: "transcribing"; part: number; total: number; waiting: Wait }
  | { step: "done" }
  | { step: "error"; message: string; canResume: boolean };

// Pourquoi la page attend avant un nouvel essai (rien = elle n'attend pas).
type Wait = "limite" | "surcharge" | null;

const TRANSLATIONS = [
  { code: "fr", label: "Français" },
  { code: "en", label: "Anglais" },
  { code: "ar", label: "Arabe" },
] as const;

const RETRY_SECONDS = 30;
const MAX_RETRIES = 4;

const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// Phrase en français contenant des mots arabes : chaque passage arabe est isolé
// pour s'afficher dans le bon ordre.
function MixedText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/([\u0600-\u06FF][\u0600-\u06FF\s]*[\u0600-\u06FF]|[\u0600-\u06FF])/)
        .map((piece, index) =>
          index % 2 === 1 ? (
            <bdi key={index} dir="rtl" className="font-arabic">
              {piece}
            </bdi>
          ) : (
            piece
          ),
        )}
    </>
  );
}

// Affiche un texte ligne par ligne. Les mots marqués (à vérifier ou corrigés) sont dessinés
// par `renderMark`, qui reçoit leur numéro dans le texte (0, 1, 2…), le mot et son type.
function Lines({
  text,
  renderMark = (_, word, kind) =>
    kind === "doubt" ? <span className="text-red-600">{word}</span> : word,
}: {
  text: string;
  renderMark?: (n: number, word: string, kind: "doubt" | "fixed") => React.ReactNode;
}) {
  let markNumber = 0;
  return (
    <div className="space-y-2">
      {toLines(text).map((line, index) => {
        const content = splitMarks(line).map((segment, i) =>
          segment.kind === "normal" ? (
            segment.text
          ) : (
            <span key={i}>{renderMark(markNumber++, segment.text, segment.kind)}</span>
          ),
        );
        return isArabic(line) ? (
          <p key={index} dir="rtl" className="font-arabic text-2xl leading-[2.2]">
            {content}
          </p>
        ) : (
          <p key={index} dir="ltr" className="text-lg leading-loose">
            {content}
          </p>
        );
      })}
    </div>
  );
}

export default function Transcriber({ ready }: { ready: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ step: "idle" });
  // Texte de chaque partie de 2 minutes (la partie n commence à n × 2 minutes).
  const [parts, setParts] = useState<string[]>([]);
  // Pour chaque partie : vrai si elle a été transcrite par le modèle de secours (plus léger).
  const [liteParts, setLiteParts] = useState<boolean[]>([]);
  const [translation, setTranslation] = useState<{ label: string; text: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState("");
  // Choix d'affichage : avec ou sans harakat (le PDF suit ce choix).
  const [withHarakat, setWithHarakat] = useState(true);
  // Version choisie par l'utilisateur. La copie dans `versionRef` permet à une transcription
  // déjà en cours d'utiliser la nouvelle version dès le prochain envoi.
  const [version, setVersion] = useState<Version>("normale");
  const versionRef = useRef<Version>("normale");
  function chooseVersion(choice: Version) {
    setVersion(choice);
    versionRef.current = choice;
  }
  const shown = (text: string) => (withHarakat ? text : removeHarakat(text));
  const [wordError, setWordError] = useState("");
  // Relecture : corrections proposées pour chaque mot repéré, et état de la relecture.
  const [suggestions, setSuggestions] = useState<Record<string, Issue>>({});
  // `found` : nombre de mots signalés par la relecture.
  const [check, setCheck] = useState<{
    step: "idle" | "checking" | "done" | "error";
    message?: string;
    found?: number;
  }>({ step: "idle" });
  // Mot douteux en cours de correction : partie, numéro du mot dans la partie, texte saisi.
  const [editing, setEditing] = useState<{ part: number; n: number; value: string } | null>(null);
  // Extraits du fichier et numéro du prochain extrait à transcrire (pour « Reprendre »).
  const chunks = useRef<Blob[]>([]);
  // Pour un PDF : pages contenues dans chaque extrait (null pour un audio ou une vidéo).
  const pageRanges = useRef<{ first: number; last: number }[] | null>(null);
  // Titre de chaque partie : minutage (« 2:00 ») ou pages (« Pages 4 à 6 »).
  const [sectionLabels, setSectionLabels] = useState<string[]>([]);
  const nextPart = useRef(0);
  // Lecteur audio ou vidéo, pour y aller au minutage cliqué.
  const player = useRef<HTMLMediaElement | null>(null);

  const transcript = parts.filter((text) => text.trim() !== "").join("\n");
  const doubtCount = countDoubts(transcript);

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
  const pdfMode = file ? isPdf(file) : false;
  const showPlayer = mediaUrl !== null && !pdfMode;

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
  async function transcribePart(
    chunk: Blob,
    part: number,
    total: number,
  ): Promise<{ text: string; lite: boolean }> {
    for (let attempt = 0; ; attempt++) {
      const used = versionRef.current;
      const pages = pageRanges.current?.[part - 1];
      const pageQuery = pages ? `&first=${pages.first}&last=${pages.last}` : "";
      const response = await fetch(`/api/transcribe?version=${used}${pageQuery}`, {
        method: "POST",
        body: chunk,
      });
      if (response.ok) return response.json();
      const retryable = response.status === 429 || response.status === 503;
      if (!retryable || attempt === MAX_RETRIES) {
        throw new Error(response.status === 429 ? "limite" : "autre");
      }
      const reason = response.status === 429 ? "limite" : "surcharge";
      setStatus({ step: "transcribing", part, total, waiting: reason });
      // On attend avant de réessayer, sauf si l'utilisateur change de version entre-temps.
      for (let second = 0; second < RETRY_SECONDS && versionRef.current === used; second++) {
        await wait(1);
      }
      setStatus({ step: "transcribing", part, total, waiting: null });
    }
  }

  // Transcrit les extraits à partir de `nextPart`, à la suite des parties déjà obtenues.
  async function transcribeRemainingParts() {
    const total = chunks.current.length;
    // Copie locale des parties, pour lancer la relecture sur le texte complet à la fin.
    const collected = parts.slice(0, nextPart.current);
    try {
      for (let i = nextPart.current; i < total; i++) {
        setStatus({ step: "transcribing", part: i + 1, total, waiting: null });
        const { text: partText, lite } = await transcribePart(chunks.current[i], i + 1, total);
        collected[i] = partText;
        setParts((previous) => [...previous.slice(0, i), partText]);
        setLiteParts((previous) => [...previous.slice(0, i), lite]);
        nextPart.current = i + 1;
      }
      setStatus({ step: "done" });
      await proofread(collected);
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
    setParts([]);
    setLiteParts([]);
    setEditing(null);
    setSuggestions({});
    setCheck({ step: "idle" });
    setTranslation(null);
    setTranslationError("");

    try {
      setStatus({ step: "preparing" });
      if (pdfMode) {
        const pdfChunks = await splitPdf(file);
        chunks.current = pdfChunks.map((chunk) => chunk.blob);
        pageRanges.current = pdfChunks.map(({ firstPage, lastPage }) => ({
          first: firstPage,
          last: lastPage,
        }));
        setSectionLabels(
          pdfChunks.map(({ firstPage, lastPage }) =>
            firstPage === lastPage ? `Page ${firstPage}` : `Pages ${firstPage} à ${lastPage}`,
          ),
        );
      } else {
        chunks.current = await splitIntoWavChunks(file);
        pageRanges.current = null;
        setSectionLabels(chunks.current.map((_, index) => formatTime(index * CHUNK_SECONDS)));
      }
      nextPart.current = 0;
    } catch (error) {
      console.error(error);
      setStatus({
        step: "error",
        canResume: false,
        message:
          error instanceof PageTooLargeError
            ? `Ce PDF contient une ${error.message} trop lourde pour être envoyée (scan en très haute qualité). Essayez avec un PDF plus léger.`
            : pdfMode
              ? "Ce PDF n'a pas pu être lu. Vérifiez qu'il n'est pas protégé par un mot de passe."
              : "Ce fichier n'a pas pu être lu. Vérifiez qu'il s'agit bien d'un fichier audio ou vidéo. S'il est très long, essayez avec un fichier plus court.",
      });
      return;
    }

    await transcribeRemainingParts();
  }

  // Place le lecteur au début de la partie cliquée et lance la lecture.
  function playFrom(seconds: number) {
    if (!player.current) return;
    player.current.currentTime = seconds;
    player.current.play().catch(() => {});
  }

  // Relecture du texte complet : les mots probablement faux passent en rouge,
  // avec une correction proposée.
  async function proofread(texts: string[]) {
    setCheck({ step: "checking" });
    try {
      // Les mots déjà signalés pendant la transcription sont envoyés avec leurs marques ⟦ ⟧,
      // pour recevoir eux aussi des propositions de correction.
      const plain = removeFixedMarks(texts.filter((text) => text.trim() !== "").join("\n"));
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: plain, version: versionRef.current }),
      });
      const data = await response.json();
      if (!response.ok) {
        setCheck({ step: "error", message: data.error });
        return;
      }
      const issues: Issue[] = data.issues;
      setSuggestions((previous) => ({
        ...previous,
        ...Object.fromEntries(issues.map((issue) => [issue.word, issue])),
      }));
      setParts((previous) =>
        previous.map((text) =>
          issues.reduce((marked, issue) => markWord(marked, issue.word), text),
        ),
      );
      setCheck({ step: "done", found: issues.length });
    } catch (error) {
      console.error(error);
      setCheck({
        step: "error",
        message: "La relecture n'a pas pu être réalisée. Réessayez dans un instant.",
      });
    }
  }

  // Remplace le mot en cours de correction. Il devient « corrigé » : souligné en vert,
  // et toujours modifiable (avec le mot d'origine proposé dans la liste).
  function confirmWord(word: string) {
    if (!editing || word.trim() === "") return;
    const { part, n } = editing;
    const current = markAt(parts[part], n);
    const chosen = word.trim();
    setSuggestions((previous) => {
      const known = previous[current];
      const choices = [...new Set([...(known?.suggestions ?? []), current])];
      return {
        ...previous,
        [chosen]: {
          word: chosen,
          suggestions: choices.filter((choice) => choice !== chosen),
          reason: known?.reason ?? "",
        },
      };
    });
    setParts((previous) =>
      previous.map((text, index) => (index === part ? fixMark(text, n, chosen) : text)),
    );
    setEditing(null);
  }

  // Mot marqué : en rouge (à vérifier) ou souligné en vert (corrigé), cliquable ;
  // ou fenêtre de correction s'il est en cours de correction.
  function renderMark(part: number) {
    return function MarkedWord(n: number, word: string, kind: "doubt" | "fixed") {
      const current = markAt(parts[part], n);
      const known = suggestions[current];
      if (editing?.part === part && editing.n === n) {
        return (
          <span className="no-print my-1 inline-flex max-w-full flex-col gap-2 rounded-lg border border-zinc-300 bg-white p-3 align-middle font-sans text-base shadow-sm">
            {known?.reason && (
              <span dir="ltr" className="text-left text-sm text-zinc-600">
                <MixedText text={known.reason} />
              </span>
            )}
            {known && known.suggestions.length > 0 && (
              <span dir="ltr" className="flex flex-wrap items-center gap-2 text-left text-sm">
                <span className="text-zinc-600">Mots proposés :</span>
                {known.suggestions.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => confirmWord(choice)}
                    className="font-arabic rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-1 text-xl text-emerald-900 hover:bg-emerald-100"
                  >
                    {choice}
                  </button>
                ))}
              </span>
            )}
            <span dir="ltr" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-600">
                {known && known.suggestions.length > 0 ? "Ou écrivez :" : "Votre correction :"}
              </span>
              <input
                dir="rtl"
                autoFocus
                value={editing.value}
                onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirmWord(editing.value);
                  if (event.key === "Escape") setEditing(null);
                }}
                className="font-arabic w-44 rounded border border-zinc-400 px-2 py-0.5 text-xl"
              />
              <button
                type="button"
                onClick={() => confirmWord(editing.value)}
                className="rounded bg-emerald-700 px-3 py-1 text-white"
              >
                Corriger
              </button>
              {kind === "doubt" && (
                <button
                  type="button"
                  onClick={() => confirmWord(current)}
                  className="rounded border border-zinc-300 bg-white px-3 py-1 text-zinc-700"
                >
                  C&apos;est juste
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-2 py-1 text-zinc-500"
              >
                Annuler
              </button>
            </span>
          </span>
        );
      }
      return (
        <button
          type="button"
          title={
            kind === "doubt"
              ? "Mot à vérifier : cliquez pour le corriger"
              : "Mot corrigé : cliquez pour le modifier"
          }
          onClick={() => setEditing({ part, n, value: current })}
          className={
            kind === "doubt"
              ? "text-red-600 underline decoration-dotted underline-offset-4 hover:bg-red-50"
              : "underline decoration-emerald-500 decoration-dotted underline-offset-4 hover:bg-emerald-50 print:no-underline"
          }
        >
          {word}
        </button>
      );
    };
  }

  // Télécharge le même contenu que le PDF au format Word (.docx), modifiable.
  async function handleWordDownload() {
    if (!file) return;
    setWordError("");
    try {
      // La bibliothèque Word n'est chargée qu'au moment du clic, pour garder la page légère.
      const { buildWordFile } = await import("@/lib/word");
      const blob = await buildWordFile({
        fileName: file.name,
        sections: parts
          .map((text, index) => ({
            time: pdfMode && text.includes("— Page") ? "" : (sectionLabels[index] ?? ""),
            text: shown(text),
          }))
          .filter((section) => section.text.trim() !== ""),
        translation: translation && { label: translation.label, text: shown(translation.text) },
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${file.name.replace(/\.[^.]+$/, "")} - transcription.docx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error(error);
      setWordError("Le fichier Word n'a pas pu être créé. Réessayez dans un instant.");
    }
  }

  async function handleTranslate(code: string, label: string) {
    setTranslating(true);
    setTranslationError("");
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: removeMarks(transcript),
          language: code,
          version: versionRef.current,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setTranslationError(data.error);
        return;
      }
      setTranslation({ label, text: removeMarks(data.text) });
    } catch (error) {
      console.error(error);
      setTranslationError("La traduction n'a pas pu être réalisée. Réessayez dans un instant.");
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="mt-8">
      <form onSubmit={handleTranscribe} className="no-print mx-auto max-w-3xl space-y-4">
        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center hover:border-emerald-400">
          <span dir="auto" className="block font-medium text-zinc-800">
            {file ? file.name : "Choisir un fichier audio, vidéo ou PDF"}
          </span>
          <span className="mt-1 block text-sm text-zinc-500">
            MP3, WAV, M4A, MP4, MOV… pour transcrire ; PDF pour ajouter les harakat à un texte
          </span>
          <input
            type="file"
            accept="audio/*,video/*,application/pdf,.pdf"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setStatus({ step: "idle" });
            }}
          />
        </label>

        <fieldset className="rounded-xl border border-zinc-200 px-4 py-3">
          <legend className="px-1 text-sm font-medium text-zinc-700">Version</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["normale", "Normale", "Meilleure qualité des harakat."],
                [
                  "legere",
                  "Légère",
                  "Plus rapide, limite gratuite séparée, harakat moins précises.",
                ],
              ] as const
            ).map(([value, label, help]) => (
              <label
                key={value}
                className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 ${
                  version === value ? "border-emerald-600 bg-emerald-50" : "border-zinc-200"
                }`}
              >
                <input
                  type="radio"
                  name="version"
                  checked={version === value}
                  onChange={() => chooseVersion(value)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium text-zinc-900">{label}</span>
                  <span className="block text-sm text-zinc-600">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={!file || busy}
          className="w-full rounded-xl bg-emerald-700 px-6 py-3 font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {pdfMode ? "Ajouter les harakat" : "Transcrire"}
        </button>
      </form>

      {/* Sur ordinateur : texte à gauche, lecteur à droite (toujours visible).
          Sur téléphone : lecteur au-dessus du texte. */}
      <div
        className={
          showPlayer
            ? "mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-8 print:block"
            : "mx-auto max-w-3xl"
        }
      >
        {showPlayer && (
          <div className="no-print sticky top-0 z-10 -mx-2 bg-white px-2 py-2 lg:order-2 lg:top-4 lg:mx-0 lg:px-0">
            {isVideo ? (
              <video
                ref={(element) => {
                  player.current = element;
                }}
                src={mediaUrl}
                controls
                className="max-h-64 w-full rounded-xl bg-black lg:max-h-[75vh]"
              />
            ) : (
              <audio
                ref={(element) => {
                  player.current = element;
                }}
                src={mediaUrl}
                controls
                className="w-full"
              />
            )}
          </div>
        )}

        <div className="min-w-0 lg:order-1">
          <div className="no-print">
            {status.step === "preparing" && (
              <p className="mt-6 text-zinc-700">Préparation du fichier…</p>
            )}
            {status.step === "transcribing" && (
              <p className="mt-6 text-zinc-700">
                {status.waiting === "limite" &&
                  `Limite gratuite de Google atteinte : nouvel essai dans ${RETRY_SECONDS} secondes…`}
                {status.waiting === "surcharge" &&
                  `Google est momentanément surchargé : nouvel essai dans ${RETRY_SECONDS} secondes…`}
                {status.waiting === null &&
                  (pdfMode
                    ? `Lecture du PDF… ${sectionLabels[status.part - 1] ?? ""} (partie ${status.part} sur ${status.total})`
                    : `Transcription en cours… partie ${status.part} sur ${status.total}`)}
                {status.waiting !== null && version === "normale" && (
                  <button
                    type="button"
                    onClick={() => chooseVersion("legere")}
                    className="ml-2 rounded-lg border border-zinc-300 bg-white px-3 py-1 text-sm text-zinc-800 hover:border-emerald-500"
                  >
                    Passer en version légère
                  </button>
                )}
              </p>
            )}
            {status.step === "error" && (
              <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
                <p>{status.message}</p>
                {status.canResume && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => transcribeRemainingParts()}
                      className="rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800"
                    >
                      Reprendre
                    </button>
                    {version === "normale" && (
                      <button
                        type="button"
                        onClick={() => {
                          chooseVersion("legere");
                          transcribeRemainingParts();
                        }}
                        className="rounded-lg border border-red-300 bg-white px-4 py-2 font-medium text-red-800 hover:bg-red-50"
                      >
                        Reprendre en version légère
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {transcript && (
            <div id="document" className="mt-8">
              <h2 className="text-xl font-semibold text-zinc-900">
                {pdfMode ? "Texte avec harakat" : "Transcription"}
              </h2>
              {file && (
                <p className="mt-1 text-sm text-zinc-500">
                  <bdi>{file.name}</bdi>
                </p>
              )}
              <p className="mt-1 text-sm text-amber-700">
                Texte non relu : il peut contenir des erreurs de transcription ou de harakat.
              </p>
              {check.step === "checking" && (
                <p className="no-print mt-3 text-sm text-zinc-700">
                  Relecture de l&apos;orthographe et des harakat en cours…
                </p>
              )}
              {check.step === "done" && check.found === 0 && doubtCount === 0 && (
                <p className="no-print mt-3 text-sm text-emerald-700">
                  Relecture terminée : aucun mot signalé (une relecture humaine reste conseillée).
                </p>
              )}
              {check.step === "error" && (
                <div className="no-print mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                  {check.message}{" "}
                  <button
                    type="button"
                    onClick={() => proofread(parts)}
                    className="ml-1 font-medium underline"
                  >
                    Relancer la relecture
                  </button>
                </div>
              )}
              {doubtCount > 0 && (
                <p className="hidden text-sm text-red-600 print:block">
                  En rouge : mots dont l&apos;orthographe ou les harakat sont à vérifier.
                </p>
              )}
              {doubtCount > 0 && (
                <p className="no-print mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                  {doubtCount === 1
                    ? "1 mot à vérifier est en rouge"
                    : `${doubtCount} mots à vérifier sont en rouge`}{" "}
                  : cliquez dessus pour choisir un mot proposé ou écrire votre correction. Ils
                  restent en rouge dans le PDF et le Word tant qu&apos;ils ne sont pas vérifiés. Les
                  mots corrigés sont soulignés en vert : cliquez dessus pour les modifier à nouveau.
                </p>
              )}
              <div className="no-print mt-4 inline-flex rounded-lg border border-zinc-300 p-1">
                {[true, false].map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    onClick={() => setWithHarakat(value)}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                      withHarakat === value
                        ? "bg-emerald-700 text-white"
                        : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    {value ? "Avec harakat" : "Sans harakat"}
                  </button>
                ))}
              </div>
              <div className="mt-4 space-y-6 rounded-xl border border-zinc-200 bg-white p-6 text-zinc-900">
                {parts.map((text, index) =>
                  text.trim() === "" ? null : (
                    <div key={index}>
                      {pdfMode ? (
                        // Inutile si Google a déjà indiqué chaque page (« — Page 4 — ») dans le texte.
                        !text.includes("— Page") && (
                          <span className="mb-2 inline-block rounded-md bg-zinc-100 px-2 py-0.5 text-sm text-zinc-700">
                            {sectionLabels[index]}
                          </span>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => playFrom(index * CHUNK_SECONDS)}
                          title="Écouter à partir de ce moment"
                          className="mb-2 rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-sm text-emerald-800 hover:bg-emerald-100"
                        >
                          ▶ {sectionLabels[index]}
                        </button>
                      )}
                      {liteParts[index] && (
                        <span className="no-print ml-2 text-xs text-amber-700">
                          Fait en version légère : vérifiez bien les harakat.
                        </span>
                      )}
                      <Lines text={shown(text)} renderMark={renderMark(index)} />
                    </div>
                  ),
                )}
              </div>

              {translation && (
                <section className="mt-8">
                  <h2 className="text-xl font-semibold text-zinc-900">
                    Traduction ({translation.label})
                  </h2>
                  <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-6 text-zinc-900">
                    <Lines text={shown(translation.text)} />
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
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="rounded-xl bg-zinc-900 px-6 py-3 font-medium text-white hover:bg-zinc-700"
                  >
                    Télécharger en PDF
                  </button>
                  <button
                    type="button"
                    onClick={handleWordDownload}
                    className="rounded-xl bg-blue-700 px-6 py-3 font-medium text-white hover:bg-blue-800"
                  >
                    Télécharger en Word
                  </button>
                </div>
                <p className="mt-2 text-sm text-zinc-500">
                  PDF : dans la fenêtre qui s&apos;ouvre, choisissez « Enregistrer au format PDF »
                  comme imprimante. Word : le fichier se télécharge directement et peut être
                  modifié.
                </p>
                {wordError && (
                  <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
                    {wordError}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
