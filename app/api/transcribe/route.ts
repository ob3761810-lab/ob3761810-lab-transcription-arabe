// Transcrit un extrait audio (WAV envoyé par le navigateur) avec les harakat.
// Rien n'est conservé : l'extrait est transmis à Gemini puis oublié.

import { NextResponse } from "next/server";
import { RateLimitError, transcribeWithHarakat } from "@/lib/gemini";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const audio = await request.arrayBuffer();
    if (audio.byteLength === 0) {
      return NextResponse.json({ error: "Extrait audio vide." }, { status: 400 });
    }
    const text = await transcribeWithHarakat(audio);
    return NextResponse.json({ text });
  } catch (error) {
    if (error instanceof RateLimitError) {
      // Limite gratuite atteinte : le navigateur attend un peu puis réessaie.
      return NextResponse.json({ error: "Limite gratuite atteinte." }, { status: 429 });
    }
    console.error("Erreur pendant la transcription :", error);
    return NextResponse.json(
      { error: "La transcription n'a pas pu être réalisée. Réessayez dans un instant." },
      { status: 500 },
    );
  }
}
