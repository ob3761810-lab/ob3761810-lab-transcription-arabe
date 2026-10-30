// Ajoute les harakat à une liste de textes (paragraphes de sous-titres), un par un, dans le même
// ordre. Le navigateur vérifie ensuite chaque texte (lib/document.ts, `checkVocalized`).

import { NextResponse } from "next/server";
import { BusyError, RateLimitError, toVersion, vocalizeList } from "@/lib/gemini";

export const maxDuration = 300;

export async function POST(request: Request) {
  const { texts, version } = (await request.json()) as { texts?: unknown; version?: string };
  if (!Array.isArray(texts) || texts.length === 0 || texts.some((text) => typeof text !== "string")) {
    return NextResponse.json({ error: "Aucun texte." }, { status: 400 });
  }
  try {
    return NextResponse.json({ texts: await vocalizeList(texts, toVersion(version)) });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: "Limite gratuite atteinte." }, { status: 429 });
    }
    if (error instanceof BusyError) {
      return NextResponse.json({ error: "Google est surchargé." }, { status: 503 });
    }
    console.error("Erreur pendant l'ajout des harakat :", error);
    return NextResponse.json({ error: "Les harakat n'ont pas pu être ajoutées." }, { status: 500 });
  }
}
