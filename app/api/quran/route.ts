// Remplace les versets du Coran reconnus par le texte officiel (Tanzil), sans IA.

import { NextResponse } from "next/server";
import { replaceQuranInBlocks } from "@/lib/quran";

export async function POST(request: Request) {
  const { text } = (await request.json()) as { text?: string };
  if (typeof text !== "string") {
    return NextResponse.json({ error: "Aucun texte." }, { status: 400 });
  }
  try {
    return NextResponse.json({ text: replaceQuranInBlocks(text) });
  } catch (error) {
    console.error("Erreur pendant la détection des versets :", error);
    return NextResponse.json({ text });
  }
}
