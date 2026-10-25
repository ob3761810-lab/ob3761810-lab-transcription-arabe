// Traduit le texte transcrit en français, en anglais ou en arabe.

import { NextResponse } from "next/server";
import { LANGUAGES, RateLimitError, translate, type Language } from "@/lib/gemini";

export const maxDuration = 300;

export async function POST(request: Request) {
  const { text, language } = (await request.json()) as { text?: string; language?: string };

  if (typeof text !== "string" || text.trim() === "" || !(language && language in LANGUAGES)) {
    return NextResponse.json({ error: "Rien à traduire." }, { status: 400 });
  }

  try {
    const translation = await translate(text, language as Language);
    return NextResponse.json({ text: translation });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: "Limite gratuite atteinte. Réessayez dans une minute." },
        { status: 429 },
      );
    }
    console.error("Erreur pendant la traduction :", error);
    return NextResponse.json(
      { error: "La traduction n'a pas pu être réalisée. Réessayez dans un instant." },
      { status: 500 },
    );
  }
}
