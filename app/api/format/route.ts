// Sous-titres : mise en forme d'un morceau de texte par l'IA (ponctuation, paragraphes,
// intertitres, hésitations retirées). Le navigateur vérifie ensuite que les mots n'ont pas changé.

import { NextResponse } from "next/server";
import { BusyError, formatSubtitles, RateLimitError, toVersion } from "@/lib/gemini";

export const maxDuration = 300;

export async function POST(request: Request) {
  const { text, version } = (await request.json()) as { text?: string; version?: string };
  if (typeof text !== "string" || text.trim() === "" || text.length > 40000) {
    return NextResponse.json({ error: "Texte vide ou trop long." }, { status: 400 });
  }
  try {
    return NextResponse.json({ text: await formatSubtitles(text, toVersion(version)) });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: "Limite gratuite atteinte." }, { status: 429 });
    }
    if (error instanceof BusyError) {
      return NextResponse.json({ error: "Google est surchargé." }, { status: 503 });
    }
    console.error("Erreur pendant la mise en forme :", error);
    return NextResponse.json(
      { error: "La mise en forme n'a pas pu être réalisée." },
      { status: 500 },
    );
  }
}
