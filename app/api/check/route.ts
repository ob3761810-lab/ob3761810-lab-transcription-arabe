// Relecture : repère les mots arabes probablement faux (orthographe, harakat, accord).

import { NextResponse } from "next/server";
import { BusyError, checkText, RateLimitError, toVersion } from "@/lib/gemini";

export const maxDuration = 300;

export async function POST(request: Request) {
  const { text, version } = (await request.json()) as { text?: string; version?: string };
  if (typeof text !== "string" || text.trim() === "") {
    return NextResponse.json({ error: "Rien à relire." }, { status: 400 });
  }

  try {
    return NextResponse.json({ issues: await checkText(text, toVersion(version)) });
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof BusyError) {
      console.error("Gemini saturé pendant la relecture :", error);
      return NextResponse.json(
        { error: "Google est saturé : la relecture n'a pas pu être faite. Réessayez dans une minute." },
        { status: 503 },
      );
    }
    console.error("Erreur pendant la relecture :", error);
    return NextResponse.json(
      { error: "La relecture n'a pas pu être réalisée. Réessayez dans un instant." },
      { status: 500 },
    );
  }
}
