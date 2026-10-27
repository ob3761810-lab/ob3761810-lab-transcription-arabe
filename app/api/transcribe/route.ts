// Transcrit un extrait audio (WAV envoyé par le navigateur) avec les harakat,
// ou lit quelques pages d'un PDF et y ajoute les harakat.
// Rien n'est conservé : l'extrait est transmis à Gemini puis oublié.

import { NextResponse } from "next/server";
import {
  BusyError,
  RateLimitError,
  toVersion,
  transcribeWithHarakat,
  vocalizePdf,
} from "@/lib/gemini";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const data = await request.arrayBuffer();
    if (data.byteLength === 0) {
      return NextResponse.json({ error: "Extrait vide." }, { status: 400 });
    }
    // Version choisie par l'utilisateur : ?version=normale ou ?version=legere
    const params = new URL(request.url).searchParams;
    const version = toVersion(params.get("version"));
    const text =
      request.headers.get("content-type") === "application/pdf"
        ? await vocalizePdf(
            data,
            version,
            Number(params.get("first")) || 1,
            Number(params.get("last")) || 1,
          )
        : await transcribeWithHarakat(data, version);
    return NextResponse.json({ text, lite: version === "legere" });
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
