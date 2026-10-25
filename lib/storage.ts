// Stockage temporaire des fichiers déposés (Vercel Blob, en mode privé).
// Les fichiers ne sont jamais publics : on crée un lien de lecture de courte durée
// uniquement pour le service de transcription, puis on les supprime.

import { del, issueSignedToken, list, presignUrl } from "@vercel/blob";

// Tous les fichiers déposés sont rangés dans ce dossier.
export const UPLOAD_FOLDER = "uploads/";

// Durée de validité du lien donné au service de transcription.
const READ_LINK_MINUTES = 30;

// Délai après lequel un fichier oublié est supprimé par le nettoyage automatique.
// Réglable avec la variable FILE_RETENTION_HOURS (24 heures par défaut).
function retentionHours(): number {
  const value = Number(process.env.FILE_RETENTION_HOURS);
  return value > 0 ? value : 24;
}

export function isUploadedFile(pathname: string): boolean {
  return pathname.startsWith(UPLOAD_FOLDER) && !pathname.includes("..");
}

export async function createTemporaryReadUrl(pathname: string): Promise<string> {
  const validUntil = Date.now() + READ_LINK_MINUTES * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    validUntil,
    access: "private",
  });
  return presignedUrl;
}

export async function deleteFile(pathname: string): Promise<void> {
  await del(pathname);
}

// Supprime les fichiers plus anciens que le délai de conservation.
// Renvoie le nombre de fichiers supprimés.
export async function deleteOldFiles(): Promise<number> {
  const limit = Date.now() - retentionHours() * 60 * 60 * 1000;
  let deleted = 0;
  let cursor: string | undefined;

  do {
    const page = await list({ prefix: UPLOAD_FOLDER, cursor });
    const oldFiles = page.blobs
      .filter((blob) => blob.uploadedAt.getTime() < limit)
      .map((blob) => blob.pathname);
    if (oldFiles.length > 0) {
      await del(oldFiles);
      deleted += oldFiles.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return deleted;
}
