// Préparation d'un PDF dans le navigateur, avant l'envoi :
// on le découpe en petits PDF de quelques pages, chacun sous la limite d'envoi de Vercel (4,5 Mo).

import { PDFDocument } from "pdf-lib";

const PAGES_PER_CHUNK = 3;
const MAX_CHUNK_BYTES = 3.8 * 1024 * 1024;

export type PdfChunk = { blob: Blob; firstPage: number; lastPage: number };

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

// Erreur levée quand une seule page dépasse la limite d'envoi (scan très lourd).
export class PageTooLargeError extends Error {}

async function extract(source: PDFDocument, first: number, last: number): Promise<Blob> {
  const document = await PDFDocument.create();
  const indices = Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i);
  const pages = await document.copyPages(source, indices);
  pages.forEach((page) => document.addPage(page));
  const bytes = await document.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export async function splitPdf(file: File): Promise<PdfChunk[]> {
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const total = source.getPageCount();
  const chunks: PdfChunk[] = [];

  for (let first = 1; first <= total; first += PAGES_PER_CHUNK) {
    const last = Math.min(first + PAGES_PER_CHUNK - 1, total);
    const blob = await extract(source, first, last);
    if (blob.size <= MAX_CHUNK_BYTES) {
      chunks.push({ blob, firstPage: first, lastPage: last });
      continue;
    }
    // Paquet trop lourd (pages scannées) : on envoie ces pages une par une.
    for (let page = first; page <= last; page++) {
      const single = await extract(source, page, page);
      if (single.size > MAX_CHUNK_BYTES) throw new PageTooLargeError(`page ${page}`);
      chunks.push({ blob: single, firstPage: page, lastPage: page });
    }
  }
  return chunks;
}
