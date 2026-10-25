// Autorise le navigateur à envoyer un fichier directement vers le stockage privé.
// Le fichier ne passe pas par notre serveur (Vercel refuse les fichiers de plus de 4,5 Mo).

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { isUploadedFile } from "@/lib/storage";

const MAX_FILE_SIZE_MB = 1000;

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!isUploadedFile(pathname)) {
          throw new Error(`Chemin refusé : ${pathname}`);
        }
        return {
          allowedContentTypes: ["audio/*", "video/*"],
          maximumSizeInBytes: MAX_FILE_SIZE_MB * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Erreur lors de la préparation de l'envoi :", error);
    return NextResponse.json(
      { error: "L'envoi du fichier n'a pas pu être préparé. Réessayez dans un instant." },
      { status: 400 },
    );
  }
}
