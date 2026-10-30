// Transcrit un extrait audio (WAV envoyé par le navigateur) avec les harakat,
// ou lit quelques pages d'un PDF, ou un morceau de texte collé, et y ajoute les harakat.
// Rien n'est conservé : l'extrait est transmis à Gemini puis oublié.

import { NextResponse } from "next/server";
import { applyVocalized, blockTexts, pagesToText, parseStructure } from "@/lib/document";
import {
  BusyError,
  RateLimitError,
  readPdfStructure,
  toVersion,
  transcribeWithHarakat,
  vocalizeList,
  vocalizeText,
  type Version,
} from "@/lib/gemini";
import { replaceQuranInBlocks, replaceQuranPassages } from "@/lib/quran";

export const maxDuration = 300;

// Les versets du Coran reconnus sont remplacés par le texte officiel (Tanzil).
// En cas de problème, le texte de l'IA est rendu tel quel plutôt que de perdre la transcription.
function withOfficialQuran(text: string): string {
  try {
    return replaceQuranPassages(text);
  } catch (error) {
    console.error(error);
    return text;
  }
}

// Une erreur de Google (limite, surcharge) est transmise telle quelle ; une réponse illisible
// est redemandée une fois.
async function twice<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof BusyError) throw error;
    console.error("Réponse illisible, nouvel essai :", error);
    return task();
  }
}

// PDF : 1. structure des pages (titres, paragraphes, vers, notes), 2. harakat bloc par bloc,
// vérifiées (même nombre de blocs, même ordre, mêmes mots), 3. versets du Coran, bloc par bloc.
// `unvocalized` : nombre de textes laissés sans harakat parce que l'IA avait changé des mots.
async function readPdf(
  pdf: ArrayBuffer,
  version: Version,
  first: number,
  last: number,
): Promise<{ text: string; unvocalized: number }> {
  const pages = parseStructure(
    await twice(() => readPdfStructure(pdf, version, first, last)),
    first,
  );
  let result = { pages, failed: 0 };
  const texts = blockTexts(pages);
  if (texts.length > 0) {
    let vocalized = applyVocalized(pages, await twice(() => vocalizeList(texts, version)));
    if (!vocalized.ok) {
      console.error("Vocalisation : nombre de blocs différent, nouvel essai");
      vocalized = applyVocalized(pages, await vocalizeList(texts, version));
    }
    result = { pages: vocalized.pages, failed: vocalized.failed };
  }
  let text = pagesToText(result.pages);
  try {
    text = replaceQuranInBlocks(text);
  } catch (error) {
    console.error(error);
  }
  return { text, unvocalized: result.failed };
}

export async function POST(request: Request) {
  try {
    const data = await request.arrayBuffer();
    if (data.byteLength === 0) {
      return NextResponse.json({ error: "Extrait vide." }, { status: 400 });
    }
    // Version choisie par l'utilisateur : ?version=normale ou ?version=legere
    const params = new URL(request.url).searchParams;
    const version = toVersion(params.get("version"));
    const type = request.headers.get("content-type") ?? "";
    if (type === "application/pdf") {
      const first = Number(params.get("first")) || 1;
      const last = Number(params.get("last")) || first;
      const { text, unvocalized } = await readPdf(data, version, first, last);
      return NextResponse.json({ text, unvocalized, lite: version === "legere" });
    }
    const text = type.startsWith("text/plain")
      ? await vocalizeText(new TextDecoder().decode(data), version)
      : await transcribeWithHarakat(data, version);
    // ?quran=0 : pas de détection des versets ici (les sous-titres la font à la fin, sur le texte entier).
    const finalText = params.get("quran") === "0" ? text : withOfficialQuran(text);
    return NextResponse.json({ text: finalText, lite: version === "legere" });
  } catch (error) {
    if (error instanceof RateLimitError) {
      // Limite gratuite atteinte : le navigateur attend un peu puis réessaie.
      console.error("Limite gratuite Gemini atteinte :", error);
      return NextResponse.json({ error: "Limite gratuite atteinte." }, { status: 429 });
    }
    if (error instanceof BusyError) {
      // Google est surchargé : le navigateur attend un peu puis réessaie.
      console.error("Gemini surchargé :", error);
      return NextResponse.json({ error: "Service surchargé." }, { status: 503 });
    }
    console.error("Erreur pendant la transcription :", error);
    return NextResponse.json(
      { error: "La transcription n'a pas pu être réalisée. Réessayez dans un instant." },
      { status: 500 },
    );
  }
}
