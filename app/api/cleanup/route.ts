// Nettoyage automatique : supprime les fichiers oubliés dans le stockage
// (par exemple si l'utilisateur a fermé la page avant la transcription).
// Appelé une fois par jour par Vercel (voir vercel.json).

import { NextResponse } from "next/server";
import { deleteOldFiles } from "@/lib/storage";

export async function GET(request: Request) {
  // Seul Vercel connaît ce secret : personne d'autre ne peut lancer le nettoyage.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 401 });
  }

  const deleted = await deleteOldFiles();
  return NextResponse.json({ deleted });
}
