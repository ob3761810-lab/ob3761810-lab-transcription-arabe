// Transcrit un extrait audio (WAV envoyé par le navigateur) avec les harakat,
// ou lit quelques pages d'un PDF, ou un morceau de texte collé, et y ajoute les harakat.
// Rien n'est conservé : l'extrait est transmis à Gemini puis oublié.

import { NextResponse } from "next/server";
import {
  BusyError,
  RateLimitError,
  toVersion,
  transcribeWithHarakat,
  vocalizePdf,
  vocalizeText,
} from "@/lib/gemini";
import { replaceQuranPassages } from "@/lib/quran";

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
    const text = type.startsWith("text/plain")
      ? await vocalizeText(new TextDecoder().decode(data), version)
      : type === "application/pdf"
        ? await vocalizePdf(
            data,
            version,
            Number(params.get("first")) || 1,
            Number(params.get("last")) || 1,
          )
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
