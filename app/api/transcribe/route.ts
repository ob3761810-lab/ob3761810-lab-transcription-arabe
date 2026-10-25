// Transcrit un fichier déjà déposé dans le stockage privé, puis le supprime.

import { NextResponse } from "next/server";
import { createTemporaryReadUrl, deleteFile, isUploadedFile } from "@/lib/storage";
import { transcribe } from "@/lib/transcription";

// Une transcription longue peut prendre plusieurs minutes.
export const maxDuration = 300;

export async function POST(request: Request) {
  const { pathname } = (await request.json()) as { pathname?: string };

  if (typeof pathname !== "string" || !isUploadedFile(pathname)) {
    return NextResponse.json({ error: "Fichier introuvable." }, { status: 400 });
  }

  try {
    const fileUrl = await createTemporaryReadUrl(pathname);
    const transcription = await transcribe(fileUrl);
    return NextResponse.json(transcription);
  } catch (error) {
    console.error("Erreur pendant la transcription :", error);
    return NextResponse.json(
      {
        error:
          "La transcription n'a pas pu être réalisée. Vérifiez que le fichier contient bien de l'audio, puis réessayez.",
      },
      { status: 500 },
    );
  } finally {
    // Le fichier est supprimé dans tous les cas, réussite ou échec.
    await deleteFile(pathname).catch((error) =>
      console.error("Le fichier n'a pas pu être supprimé :", pathname, error),
    );
  }
}
