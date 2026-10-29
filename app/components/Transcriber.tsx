"use client";

// Toute l'application : choisir un fichier, obtenir le texte avec les harakat,
// le traduire, puis le télécharger en PDF.

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  replaceRange,
  splitMarks,
  splitWords,
  splitText,
  quranBrackets,
  toggleQuran,
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

// Mot en cours de correction : un mot marqué (rouge ou vert, numéro n dans la partie)
// ou un mot ordinaire choisi par l'utilisateur (position dans le texte de la partie).
type Editing = {
  part: number;
  target: { n: number } | { start: number; end: number };
  value: string;
};

const wait = (seconds: number) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// Phrase en français contenant des mots arabes : chaque passage arabe est isolé
// pour s'afficher dans le bon ordre.
function MixedText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(
          /([\u0600-\u06FF][\u0600-\u06FF\s]*[\u0600-\u06FF]|[\u0600-\u06FF])/,
        )
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

// Passage coranique par défaut (traduction, aperçu) : texte officiel suivi de sa référence.
function DefaultQuran({
  text,
  on,
  reference,
}: {
  text: string;
  on: boolean;
  reference: string;
}) {
  if (!on) return text;
  return (
    <>
      {quranBrackets(text, reference)}{" "}
      <bdi dir="ltr" className="font-sans text-sm text-gold-700">
        ({reference})
      </bdi>
    </>
  );
}

// Affiche un texte ligne par ligne. `show` transforme le texte affiché (par exemple sans harakat).
// Les mots marqués (à vérifier ou corrigés) sont dessinés par `renderMark`, qui reçoit leur numéro
// dans le texte (0, 1, 2…), le mot et son type. Les passages coraniques sont dessinés par
// `renderQuran`, avec leur propre numéro. Les autres mots, par `renderWord` s'il est donné,
// avec leur position dans le texte d'origine.
function Lines({
  text,
  show = (value) => value,
  renderMark = (_, word, kind) =>
    kind === "doubt" ? <span className="text-red-600">{word}</span> : word,
  renderQuran = (_, passage) => <DefaultQuran {...passage} />,
  renderWord,
}: {
  text: string;
  show?: (value: string) => string;
  renderMark?: (
    n: number,
    word: string,
    kind: "doubt" | "fixed",
  ) => React.ReactNode;
  renderQuran?: (
    n: number,
    passage: { text: string; on: boolean; reference: string },
  ) => React.ReactNode;
  renderWord?: (start: number, end: number, word: string) => React.ReactNode;
}) {
  let markNumber = 0;
  let quranNumber = 0;
  // Chaque ligne avec sa position dans le texte, pour retrouver le mot cliqué.
  const lines: { line: string; start: number }[] = [];
  for (let start = 0; start <= text.length; ) {
    const end = text.indexOf("\n", start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);
    if (line.trim() !== "") lines.push({ line, start });
    if (end === -1) break;
    start = end + 1;
  }
  return (
    <div className="space-y-2">
      {lines.map(({ line, start: lineStart }, index) => {
        const content = splitMarks(line).map((segment, i) => {
          if (segment.kind === "quran") {
            return (
              <span key={i}>
                {renderQuran(quranNumber++, {
                  ...segment,
                  text: show(segment.text),
                })}
              </span>
            );
          }
          if (segment.kind !== "normal") {
            return (
              <span key={i}>
                {renderMark(markNumber++, show(segment.text), segment.kind)}
              </span>
            );
          }
          if (!renderWord)
            return <Fragment key={i}>{show(segment.text)}</Fragment>;
          return (
            <Fragment key={i}>
              {splitWords(segment.text).map((piece) => {
                const start = lineStart + segment.start + piece.start;
                return piece.word ? (
                  <Fragment key={piece.start}>
                    {renderWord(
                      start,
                      start + piece.text.length,
                      show(piece.text),
                    )}
                  </Fragment>
                ) : (
                  show(piece.text)
                );
              })}
            </Fragment>
          );
        });
        return isArabic(line) ? (
          <p
            key={index}
            dir="rtl"
            className="font-arabic text-2xl leading-[2.2]"
          >
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
  // Source : un fichier (audio, vidéo, PDF) ou un texte arabe collé.
  const [source, setSource] = useState<"fichier" | "texte">("fichier");
  const [pastedText, setPastedText] = useState("");
  const [status, setStatus] = useState<Status>({ step: "idle" });
  // Texte de chaque partie de 2 minutes (la partie n commence à n × 2 minutes).
  const [parts, setParts] = useState<string[]>([]);
  // Pour chaque partie : vrai si elle a été transcrite par le modèle de secours (plus léger).
  const [liteParts, setLiteParts] = useState<boolean[]>([]);
  const [translation, setTranslation] = useState<{
    label: string;
    text: string;
  } | null>(null);
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
  const [editing, setEditing] = useState<Editing | null>(null);
  // Demande de propositions à l'IA pour le mot en cours de correction.
  const [suggesting, setSuggesting] = useState<
    { step: "idle" } | { step: "loading" } | { step: "error"; message: string }
  >({ step: "idle" });
  // Passage coranique dont la fenêtre (référence, annuler) est ouverte.
  const [openQuran, setOpenQuran] = useState<{
    part: number;
    n: number;
  } | null>(null);
  // Extraits du fichier et numéro du prochain extrait à transcrire (pour « Reprendre »).
  const chunks = useRef<Blob[]>([]);
  // Pour un PDF : pages contenues dans chaque extrait (null pour un audio ou une vidéo).
  const pageRanges = useRef<{ first: number; last: number }[] | null>(null);
  // Titre de chaque partie : minutage (« 2:00 ») ou pages (« Pages 4 à 6 »).
  const [sectionLabels, setSectionLabels] = useState<string[]>([]);
  const nextPart = useRef(0);
  // Lecteur audio ou vidéo, pour y aller au minutage cliqué.
  const player = useRef<HTMLMediaElement | null>(null);
  // Position de lecture gardée quand le lecteur change de place (sous la zone de dépôt → à droite).
  const playback = useRef<{ time: number; playing: boolean } | null>(null);
  // Branche le lecteur : s'il vient de changer de place, il reprend au même moment.
  const attachPlayer = useCallback((element: HTMLMediaElement | null) => {
    if (element) {
      player.current = element;
      const saved = playback.current;
      if (saved) {
        element.currentTime = saved.time;
        if (saved.playing) element.play().catch(() => {});
        playback.current = null;
      }
    } else if (player.current) {
      playback.current = {
        time: player.current.currentTime,
        playing: !player.current.paused,
      };
      player.current = null;
    }
  }, []);

  const transcript = parts.filter((text) => text.trim() !== "").join("\n");
  const hasQuran = parts.some((text) => text.includes("⟪on|"));
  const doubtCount = countDoubts(transcript);

  const busy = status.step === "preparing" || status.step === "transcribing";

  // Adresse locale du fichier choisi, pour l'écouter ou le regarder dans la page.
  // Le fichier reste sur l'appareil : rien n'est envoyé.
  const mediaUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    return () => {
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, [mediaUrl]);
  const isVideo = file?.type.startsWith("video/") ?? false;
  const textMode = source === "texte";
  const pdfMode = !textMode && file !== null && isPdf(file);
  // PDF ou texte collé : on ajoute seulement les harakat (pas de transcription audio).
  const vocalizeOnly = pdfMode || textMode;
  const showPlayer = mediaUrl !== null && !vocalizeOnly;
  const canStart = textMode ? pastedText.trim() !== "" : file !== null;
  // Deux colonnes (texte à gauche, lecteur à droite) seulement quand il y a du texte à afficher.
  const sideBySide = showPlayer && parts.some((text) => text.trim() !== "");

  if (!ready) {
    return (
      <p className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
        L&apos;application n&apos;est pas encore activée : la clé Google Gemini
        n&apos;a pas été ajoutée.
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
      const response = await fetch(
        `/api/transcribe?version=${used}${pageQuery}`,
        {
          method: "POST",
          body: chunk,
        },
      );
      if (response.ok) return response.json();
      const retryable = response.status === 429 || response.status === 503;
      if (!retryable || attempt === MAX_RETRIES) {
        throw new Error(response.status === 429 ? "limite" : "autre");
      }
      const reason = response.status === 429 ? "limite" : "surcharge";
      setStatus({ step: "transcribing", part, total, waiting: reason });
      // On attend avant de réessayer, sauf si l'utilisateur change de version entre-temps.
      for (
        let second = 0;
        second < RETRY_SECONDS && versionRef.current === used;
        second++
      ) {
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
        const { text: partText, lite } = await transcribePart(
          chunks.current[i],
          i + 1,
          total,
        );
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
    if (!canStart) return;
    setParts([]);
    setLiteParts([]);
    setEditing(null);
    setOpenQuran(null);
    setSuggestions({});
    setCheck({ step: "idle" });
    setTranslation(null);
    setTranslationError("");

    try {
      setStatus({ step: "preparing" });
      if (textMode) {
        const pieces = splitText(pastedText.trim());
        chunks.current = pieces.map(
          (piece) => new Blob([piece], { type: "text/plain;charset=utf-8" }),
        );
        pageRanges.current = null;
        setSectionLabels(
          pieces.length > 1
            ? pieces.map((_, index) => `Partie ${index + 1}`)
            : [""],
        );
      } else if (file && isPdf(file)) {
        const pdfChunks = await splitPdf(file);
        chunks.current = pdfChunks.map((chunk) => chunk.blob);
        pageRanges.current = pdfChunks.map(({ firstPage, lastPage }) => ({
          first: firstPage,
          last: lastPage,
        }));
        setSectionLabels(
          pdfChunks.map(({ firstPage, lastPage }) =>
            firstPage === lastPage
              ? `Page ${firstPage}`
              : `Pages ${firstPage} à ${lastPage}`,
          ),
        );
      } else if (file) {
        chunks.current = await splitIntoWavChunks(file);
        pageRanges.current = null;
        setSectionLabels(
          chunks.current.map((_, index) => formatTime(index * CHUNK_SECONDS)),
        );
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
      const plain = removeFixedMarks(
        texts.filter((text) => text.trim() !== "").join("\n"),
      );
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
        message:
          "La relecture n'a pas pu être réalisée. Réessayez dans un instant.",
      });
    }
  }

  // Le mot en cours de correction, tel qu'il est écrit dans le texte.
  function editedWord(edit: Editing): string {
    const text = parts[edit.part] ?? "";
    return "n" in edit.target
      ? markAt(text, edit.target.n)
      : text.slice(edit.target.start, edit.target.end);
  }

  // Ouvre la fenêtre de correction pour un mot marqué (numéro n) ou un mot ordinaire (position).
  function startEditing(
    part: number,
    target: Editing["target"],
    value: string,
  ) {
    setEditing({ part, target, value });
    setSuggesting({ step: "idle" });
  }

  // Remplace le mot en cours de correction. Il devient « corrigé » : souligné en vert,
  // et toujours modifiable (avec le mot d'origine proposé dans la liste).
  function confirmWord(word: string) {
    if (!editing || word.trim() === "") return;
    const { part, target } = editing;
    const current = editedWord(editing);
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
      previous.map((text, index) => {
        if (index !== part) return text;
        return "n" in target
          ? fixMark(text, target.n, chosen)
          : replaceRange(text, target.start, target.end, chosen);
      }),
    );
    setEditing(null);
  }

  // Demande à l'IA quelques mots possibles pour le mot en cours de correction,
  // d'après la phrase autour (seulement quand l'utilisateur clique sur le bouton).
  async function askSuggestions() {
    if (!editing) return;
    const word = editedWord(editing);
    const plain = removeMarks(parts[editing.part] ?? "");
    const at = Math.max(0, plain.indexOf(word));
    const context = plain.slice(Math.max(0, at - 300), at + word.length + 300);
    setSuggesting({ step: "loading" });
    try {
      const response = await fetch("/api/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word, context, version: versionRef.current }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSuggesting({ step: "error", message: data.error });
        return;
      }
      const issue: Issue = data.issue;
      setSuggestions((previous) => {
        const known = previous[word];
        return {
          ...previous,
          [word]: {
            word,
            suggestions: [
              ...new Set([...issue.suggestions, ...(known?.suggestions ?? [])]),
            ].slice(0, 6),
            reason: issue.reason || known?.reason || "",
          },
        };
      });
      setSuggesting(
        issue.suggestions.length > 0
          ? { step: "idle" }
          : {
              step: "error",
              message: "Aucune proposition : écrivez votre correction.",
            },
      );
    } catch (error) {
      console.error(error);
      setSuggesting({
        step: "error",
        message:
          "Les propositions n'ont pas pu être obtenues. Écrivez votre correction.",
      });
    }
  }

  // Fenêtre de correction : mots proposés, bouton « Proposer des corrections », saisie libre.
  function correctionPanel(kind: "doubt" | "fixed" | "plain") {
    if (!editing) return null;
    const current = editedWord(editing);
    const known = suggestions[current];
    return (
      <span className="no-print my-1 inline-flex max-w-full flex-col gap-2 rounded-lg border border-stone-300 bg-white p-3 align-middle font-sans text-base shadow-sm">
        {known?.reason && (
          <span dir="ltr" className="text-left text-sm text-stone-600">
            <MixedText text={known.reason} />
          </span>
        )}
        {known && known.suggestions.length > 0 && (
          <span
            dir="ltr"
            className="flex flex-wrap items-center gap-2 text-left text-sm"
          >
            <span className="text-stone-600">Mots proposés :</span>
            {known.suggestions.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => confirmWord(choice)}
                className="font-arabic rounded-lg border border-brand-600 bg-brand-50 px-3 py-1 text-xl text-brand-900 hover:bg-brand-100"
              >
                {choice}
              </button>
            ))}
          </span>
        )}
        <span
          dir="ltr"
          className="flex flex-wrap items-center gap-2 text-left text-sm"
        >
          {suggesting.step === "loading" ? (
            <span className="text-stone-600">Recherche de propositions…</span>
          ) : (
            <button
              type="button"
              onClick={askSuggestions}
              className="rounded border border-gold-400 bg-gold-100 px-3 py-1 text-gold-700 hover:bg-gold-200"
            >
              ✨{" "}
              {known && known.suggestions.length > 0
                ? "Autres propositions"
                : "Proposer des corrections"}
            </button>
          )}
          {suggesting.step === "error" && (
            <span className="text-red-700">{suggesting.message}</span>
          )}
        </span>
        <span dir="ltr" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-stone-600">
            {known && known.suggestions.length > 0
              ? "Ou écrivez :"
              : "Votre correction :"}
          </span>
          <input
            dir="auto"
            autoFocus
            value={editing.value}
            onChange={(event) =>
              setEditing({ ...editing, value: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") confirmWord(editing.value);
              if (event.key === "Escape") setEditing(null);
            }}
            className="font-arabic w-44 rounded border border-stone-400 px-2 py-0.5 text-xl"
          />
          <button
            type="button"
            onClick={() => confirmWord(editing.value)}
            className="rounded bg-brand-700 px-3 py-1 text-white"
          >
            Corriger
          </button>
          {kind === "doubt" && (
            <button
              type="button"
              onClick={() => confirmWord(current)}
              className="rounded border border-stone-300 bg-white px-3 py-1 text-stone-700"
            >
              C&apos;est juste
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="px-2 py-1 text-stone-500"
          >
            Annuler
          </button>
        </span>
      </span>
    );
  }

  // Mot marqué : en rouge (à vérifier) ou souligné en vert (corrigé), cliquable ;
  // ou fenêtre de correction s'il est en cours de correction.
  function renderMark(part: number) {
    return function MarkedWord(
      n: number,
      word: string,
      kind: "doubt" | "fixed",
    ) {
      if (
        editing?.part === part &&
        "n" in editing.target &&
        editing.target.n === n
      ) {
        return correctionPanel(kind);
      }
      return (
        <button
          type="button"
          title={
            kind === "doubt"
              ? "Mot à vérifier : cliquez pour le corriger"
              : "Mot corrigé : cliquez pour le modifier"
          }
          onClick={() => startEditing(part, { n }, markAt(parts[part], n))}
          className={
            kind === "doubt"
              ? "text-red-600 underline decoration-dotted underline-offset-4 hover:bg-red-50"
              : "underline decoration-brand-500 decoration-dotted underline-offset-4 hover:bg-brand-50 print:no-underline"
          }
        >
          {word}
        </button>
      );
    };
  }

  // Mot ordinaire (ni rouge, ni vert) : cliquable aussi, pour corriger une erreur non signalée.
  function renderWord(part: number) {
    return function PlainWord(start: number, end: number, word: string) {
      const target = editing?.target;
      if (
        editing?.part === part &&
        target &&
        "start" in target &&
        target.start === start
      ) {
        return correctionPanel("plain");
      }
      return (
        <span
          role="button"
          tabIndex={-1}
          title="Cliquez pour corriger ce mot"
          onClick={() =>
            startEditing(part, { start, end }, parts[part].slice(start, end))
          }
          className="cursor-pointer rounded hover:bg-gold-100"
        >
          {word}
        </span>
      );
    };
  }

  // Passage coranique : texte officiel sur fond doré avec sa référence ; un clic ouvre une fenêtre
  // pour annuler le remplacement (fausse détection) ou le rétablir.
  function renderQuran(part: number) {
    return function QuranPassage(
      n: number,
      passage: { text: string; on: boolean; reference: string },
    ) {
      const open = openQuran?.part === part && openQuran.n === n;
      return (
        <>
          <button
            type="button"
            title={
              passage.on
                ? `Verset remplacé par le texte officiel : ${passage.reference}. Cliquez pour les détails.`
                : "Remplacement annulé (texte de l'IA). Cliquez pour rétablir le texte officiel."
            }
            onClick={() => setOpenQuran(open ? null : { part, n })}
            className={
              passage.on
                ? "rounded-lg bg-gold-100/70 px-1 ring-1 ring-gold-200 hover:bg-gold-100 print:bg-transparent print:ring-0"
                : "rounded-lg border border-dashed border-stone-300 px-1 hover:bg-stone-50 print:border-0"
            }
          >
            {passage.on ? (
              <>
                {quranBrackets(passage.text, passage.reference)}{" "}
                <bdi
                  dir="ltr"
                  className="font-sans text-sm whitespace-nowrap text-gold-700"
                >
                  <span className="no-print" aria-hidden>
                    📖{" "}
                  </span>
                  ({passage.reference})
                </bdi>
              </>
            ) : (
              passage.text
            )}
          </button>
          {open && (
            <span
              dir="ltr"
              className="no-print my-1 flex max-w-full flex-col gap-2 rounded-lg border border-gold-200 bg-white p-3 text-left font-sans text-base shadow-sm"
            >
              <span className="text-sm text-stone-700">
                {passage.on
                  ? `Verset reconnu et remplacé par le texte officiel du Coran (Tanzil). Référence : ${passage.reference}.`
                  : "Remplacement annulé : c'est le texte de l'IA qui est affiché et téléchargé."}
              </span>
              <span className="flex flex-wrap gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setParts((previous) =>
                      previous.map((text, index) =>
                        index === part ? toggleQuran(text, n) : text,
                      ),
                    );
                    setOpenQuran(null);
                  }}
                  className={
                    passage.on
                      ? "rounded border border-stone-300 bg-white px-3 py-1 text-stone-700"
                      : "rounded bg-brand-700 px-3 py-1 text-white"
                  }
                >
                  {passage.on
                    ? "Annuler le remplacement (remettre le texte de l'IA)"
                    : "Rétablir le texte officiel"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpenQuran(null)}
                  className="px-2 py-1 text-stone-500"
                >
                  Fermer
                </button>
              </span>
            </span>
          )}
        </>
      );
    };
  }

  // Télécharge le même contenu que le PDF au format Word (.docx), modifiable.
  async function handleWordDownload() {
    const baseName =
      textMode || !file ? "texte" : file.name.replace(/\.[^.]+$/, "");
    setWordError("");
    try {
      // La bibliothèque Word n'est chargée qu'au moment du clic, pour garder la page légère.
      const { buildWordFile } = await import("@/lib/word");
      const blob = await buildWordFile({
        fileName: textMode || !file ? "Texte collé" : file.name,
        sections: parts
          .map((text, index) => ({
            time:
              pdfMode && text.includes("— Page")
                ? ""
                : (sectionLabels[index] ?? ""),
            text: shown(text),
          }))
          .filter((section) => section.text.trim() !== ""),
        translation: translation && {
          label: translation.label,
          text: shown(translation.text),
        },
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${baseName} - ${vocalizeOnly ? "harakat" : "transcription"}.docx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error(error);
      setWordError(
        "Le fichier Word n'a pas pu être créé. Réessayez dans un instant.",
      );
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
      setTranslationError(
        "La traduction n'a pas pu être réalisée. Réessayez dans un instant.",
      );
    } finally {
      setTranslating(false);
    }
  }

  // Lecteur audio ou vidéo du fichier choisi. Quand il change de place, il reprend
  // au même moment (et continue de jouer s'il était en lecture).
  // `compact` : plus petit sous la zone de dépôt, pour garder le bouton « Transcrire » visible.
  function renderPlayer(compact = false) {
    return isVideo ? (
      <video
        ref={attachPlayer}
        src={mediaUrl ?? undefined}
        controls
        className={`w-full rounded-xl bg-black ${compact ? "max-h-72" : "max-h-64 lg:max-h-[75vh]"}`}
      />
    ) : (
      <audio
        ref={attachPlayer}
        src={mediaUrl ?? undefined}
        controls
        className="w-full"
      />
    );
  }

  return (
    <div>
      <form
        onSubmit={handleTranscribe}
        className="no-print mx-auto max-w-3xl space-y-4"
      >
        <div className="inline-flex rounded-xl border border-gold-200 bg-paper p-1">
          {(
            [
              ["fichier", "Fichier"],
              ["texte", "Coller un texte"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={busy}
              onClick={() => {
                setSource(value);
                setStatus({ step: "idle" });
              }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                source === value
                  ? "bg-brand-700 text-white"
                  : "text-stone-700 hover:bg-stone-100"
              }`}
            >
              {label}
              {value === "fichier" && (
                <span className="hidden sm:inline"> (audio, vidéo, PDF)</span>
              )}
            </button>
          ))}
        </div>

        {textMode ? (
          <textarea
            dir="rtl"
            lang="ar"
            value={pastedText}
            onChange={(event) => setPastedText(event.target.value)}
            disabled={busy}
            placeholder="الصق النص العربي هنا… (collez ici votre texte arabe)"
            rows={10}
            className="font-arabic block w-full rounded-2xl border-2 border-gold-400 bg-paper px-5 py-4 text-2xl leading-[2.1] text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none"
          />
        ) : (
          <label className="group block cursor-pointer rounded-2xl border-2 border-dashed border-gold-400 bg-paper px-6 py-10 text-center transition hover:border-brand-500 hover:bg-brand-50">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="mx-auto mb-3 h-10 w-10 text-gold-500 transition group-hover:text-brand-600"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 16V4m0 0l-4.5 4.5M12 4l4.5 4.5" />
              <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
            </svg>
            <span
              dir="auto"
              className="block text-lg font-medium text-stone-800"
            >
              {file ? file.name : "Choisir un fichier audio, vidéo ou PDF"}
            </span>
            <span className="mt-1 block text-sm text-stone-500">
              MP3, WAV, M4A, MP4, MOV… pour transcrire ; PDF pour ajouter les
              harakat à un texte
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
        )}

        {showPlayer && !sideBySide && renderPlayer(true)}

        <fieldset className="rounded-2xl border border-gold-200 bg-paper px-4 py-3">
          <legend className="px-1 text-sm font-medium text-stone-700">
            Version
          </legend>
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
                  version === value
                    ? "border-brand-600 bg-brand-50"
                    : "border-stone-200"
                }`}
              >
                <input
                  type="radio"
                  style={{ accentColor: "#145433" }}
                  name="version"
                  checked={version === value}
                  onChange={() => chooseVersion(value)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium text-stone-900">
                    {label}
                  </span>
                  <span className="block text-sm text-stone-600">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={!canStart || busy}
          className="w-full rounded-2xl bg-brand-700 px-6 py-3.5 text-lg font-medium text-white shadow-md shadow-brand-900/20 transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:shadow-none"
        >
          {vocalizeOnly ? "Ajouter les harakat" : "Transcrire"}
        </button>
      </form>

      {/* Avant le texte : lecteur sous la zone de dépôt (dans le formulaire ci-dessus).
          Avec le texte, sur ordinateur : texte à gauche, lecteur à droite (toujours visible).
          Sur téléphone : lecteur au-dessus du texte. */}
      <div
        className={
          sideBySide
            ? "mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-8 print:block"
            : "mx-auto max-w-3xl"
        }
      >
        {sideBySide && (
          <div className="no-print sticky top-0 z-10 -mx-2 bg-white px-2 py-2 lg:order-2 lg:top-4 lg:mx-0 lg:px-0">
            {renderPlayer()}
          </div>
        )}

        <div className="min-w-0 lg:order-1">
          <div className="no-print">
            {status.step === "preparing" && (
              <p className="mt-6 text-stone-700">Préparation du fichier…</p>
            )}
            {status.step === "transcribing" && (
              <p className="mt-6 text-stone-700">
                {status.waiting === "limite" &&
                  `Limite gratuite de Google atteinte : nouvel essai dans ${RETRY_SECONDS} secondes…`}
                {status.waiting === "surcharge" &&
                  `Google est momentanément surchargé : nouvel essai dans ${RETRY_SECONDS} secondes…`}
                {status.waiting === null &&
                  (textMode
                    ? `Ajout des harakat… partie ${status.part} sur ${status.total}`
                    : pdfMode
                      ? `Lecture du PDF… ${sectionLabels[status.part - 1] ?? ""} (partie ${status.part} sur ${status.total})`
                      : `Transcription en cours… partie ${status.part} sur ${status.total}`)}
                {status.waiting !== null && version === "normale" && (
                  <button
                    type="button"
                    onClick={() => chooseVersion("legere")}
                    className="ml-2 rounded-lg border border-stone-300 bg-white px-3 py-1 text-sm text-stone-800 hover:border-brand-500"
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
              <h2 className="text-xl font-semibold text-stone-900">
                {vocalizeOnly ? "Texte avec harakat" : "Transcription"}
              </h2>
              {file && !textMode && (
                <p className="mt-1 text-sm text-stone-500">
                  <bdi>{file.name}</bdi>
                </p>
              )}
              <p className="mt-1 text-sm text-amber-700">
                Texte non relu : il peut contenir des erreurs de transcription
                ou de harakat.
              </p>
              {check.step === "checking" && (
                <p className="no-print mt-3 text-sm text-stone-700">
                  Relecture de l&apos;orthographe et des harakat en cours…
                </p>
              )}
              {check.step === "done" &&
                check.found === 0 &&
                doubtCount === 0 && (
                  <p className="no-print mt-3 text-sm text-brand-700">
                    Relecture terminée : aucun mot signalé (une relecture
                    humaine reste conseillée).
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
                  En rouge : mots dont l&apos;orthographe ou les harakat sont à
                  vérifier.
                </p>
              )}
              {doubtCount > 0 && (
                <p className="no-print mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                  {doubtCount === 1
                    ? "1 mot à vérifier est en rouge"
                    : `${doubtCount} mots à vérifier sont en rouge`}{" "}
                  : cliquez dessus pour choisir un mot proposé ou écrire votre
                  correction. Ils restent en rouge dans le PDF et le Word tant
                  qu&apos;ils ne sont pas vérifiés. Les mots corrigés sont
                  soulignés en vert : cliquez dessus pour les modifier à
                  nouveau.
                </p>
              )}
              {hasQuran && (
                <p className="mt-3 rounded-lg border border-gold-200 bg-gold-100/50 px-4 py-2 text-sm text-stone-800">
                  Les versets du Coran reconnus sont remplacés par le texte
                  officiel (Tanzil), sur fond doré, avec leur référence.
                  <span className="no-print">
                    {" "}
                    Cliquez sur un verset pour annuler le remplacement si ce
                    n&apos;est pas un verset.
                  </span>
                </p>
              )}
              <div className="no-print mt-4 inline-flex rounded-lg border border-stone-300 p-1">
                {[true, false].map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    onClick={() => setWithHarakat(value)}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                      withHarakat === value
                        ? "bg-brand-700 text-white"
                        : "text-stone-700 hover:bg-stone-100"
                    }`}
                  >
                    {value ? "Avec harakat" : "Sans harakat"}
                  </button>
                ))}
              </div>
              <div className="mt-4 space-y-6 rounded-2xl border border-gold-200 bg-paper p-6 text-stone-900 shadow-inner sm:p-8">
                {parts.map((text, index) =>
                  text.trim() === "" ? null : (
                    <div key={index}>
                      {vocalizeOnly ? (
                        // Inutile s'il n'y a qu'une partie, ou si Google a déjà indiqué chaque page.
                        sectionLabels[index] &&
                        !text.includes("— Page") && (
                          <span className="mb-2 inline-block rounded-md bg-stone-100 px-2 py-0.5 text-sm text-stone-700">
                            {sectionLabels[index]}
                          </span>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => playFrom(index * CHUNK_SECONDS)}
                          title="Écouter à partir de ce moment"
                          className="mb-2 rounded-md bg-brand-50 px-2 py-0.5 font-mono text-sm text-brand-800 hover:bg-brand-100"
                        >
                          ▶ {sectionLabels[index]}
                        </button>
                      )}
                      {liteParts[index] && (
                        <span className="no-print ml-2 text-xs text-amber-700">
                          Fait en version légère : vérifiez bien les harakat.
                        </span>
                      )}
                      <Lines
                        text={text}
                        show={shown}
                        renderMark={renderMark(index)}
                        renderQuran={renderQuran(index)}
                        renderWord={renderWord(index)}
                      />
                    </div>
                  ),
                )}
              </div>

              {translation && (
                <section className="mt-8">
                  <h2 className="text-xl font-semibold text-stone-900">
                    Traduction ({translation.label})
                  </h2>
                  <div className="mt-4 rounded-2xl border border-gold-200 bg-paper p-6 text-stone-900 shadow-inner sm:p-8">
                    <Lines text={translation.text} show={shown} />
                  </div>
                </section>
              )}
            </div>
          )}

          {status.step === "done" && transcript && (
            <div className="no-print mt-8 space-y-4">
              <div>
                <p className="font-medium text-stone-900">Traduire en :</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TRANSLATIONS.map(({ code, label }) => (
                    <button
                      key={code}
                      type="button"
                      disabled={translating}
                      onClick={() => handleTranslate(code, label)}
                      className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-stone-800 hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {translating && (
                  <p className="mt-2 text-stone-700">Traduction en cours…</p>
                )}
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
                    className="rounded-2xl bg-brand-700 px-6 py-3 font-medium text-white shadow-md shadow-brand-900/20 transition hover:bg-brand-800"
                  >
                    Télécharger en PDF
                  </button>
                  <button
                    type="button"
                    onClick={handleWordDownload}
                    className="rounded-2xl bg-gold-700 px-6 py-3 font-medium text-white shadow-md shadow-gold-700/20 transition hover:bg-gold-500"
                  >
                    Télécharger en Word
                  </button>
                </div>
                <p className="mt-2 text-sm text-stone-500">
                  PDF : dans la fenêtre qui s&apos;ouvre, choisissez «
                  Enregistrer au format PDF » comme imprimante. Word : le
                  fichier se télécharge directement et peut être modifié.
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
