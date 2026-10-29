// Propositions de correction pour un mot que l'utilisateur a choisi dans le texte.

import { NextResponse } from "next/server";
import {
  BusyError,
  RateLimitError,
  suggestWord,
  toVersion,
} from "@/lib/gemini";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { word, context, version } = (await request.json()) as {
    word?: string;
    context?: string;
    version?: string;
  };
  if (typeof word !== "string" || word.trim() === "" || word.length > 100) {
    return NextResponse.json(
      { error: "Aucun mot à corriger." },
      { status: 400 },
    );
  }

  try {
    const sentence =
      typeof context === "string" ? context.slice(0, 1000) : word;
    return NextResponse.json({
      issue: await suggestWord(word.trim(), sentence, toVersion(version)),
    });
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof BusyError) {
      console.error("Gemini saturé pendant les propositions :", error);
      return NextResponse.json(
        {
          error:
            "Google est saturé : réessayez dans une minute, ou écrivez votre correction.",
        },
        { status: 503 },
      );
    }
    console.error("Erreur pendant les propositions :", error);
    return NextResponse.json(
      {
        error:
          "Les propositions n'ont pas pu être obtenues. Écrivez votre correction.",
      },
      { status: 500 },
    );
  }
}
