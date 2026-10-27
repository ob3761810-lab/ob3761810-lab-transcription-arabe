// Fabrique le fichier Word (.docx) dans le navigateur, avec le même contenu que le PDF.
// L'arabe est écrit de droite à gauche, le français et l'anglais de gauche à droite.

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { isArabic, splitDoubts, toLines } from "@/lib/text";

export type WordContent = {
  fileName: string;
  sections: { time: string; text: string }[];
  translation: { label: string; text: string } | null;
};

// Calibri pour le français et l'anglais, Arial pour l'arabe (présente partout et lisible avec les harakat).
const FONT = { ascii: "Calibri", hAnsi: "Calibri", cs: "Arial" };

// Les mots dont Google n'était pas sûr, et qui n'ont pas été vérifiés, restent en rouge.
const RED = "DC2626";

function line(text: string): Paragraph {
  const arabic = isArabic(text);
  const runs = splitDoubts(text).map(
    (segment) =>
      new TextRun({
        text: segment.text,
        font: FONT,
        color: segment.doubtful ? RED : undefined,
        ...(arabic
          ? {
              rightToLeft: true,
              size: 32,
              sizeComplexScript: 32,
              language: { bidirectional: "ar-SA" },
            }
          : { size: 24, sizeComplexScript: 28 }),
      }),
  );
  if (arabic) {
    return new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      spacing: { after: 160, line: 400 },
      children: runs,
    });
  }
  return new Paragraph({ spacing: { after: 160 }, children: runs });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT })],
  });
}

function note(text: string, color: string): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, font: FONT, size: 20, color })],
  });
}

export async function buildWordFile({ fileName, sections, translation }: WordContent): Promise<Blob> {
  const paragraphs: Paragraph[] = [
    heading("Transcription"),
    note(fileName, "71717A"),
    note("Texte non relu : il peut contenir des erreurs de transcription ou de harakat.", "B45309"),
    note("En rouge : mots dont l'orthographe ou les harakat sont à vérifier.", RED),
  ];

  for (const section of sections) {
    paragraphs.push(note(section.time, "047857"));
    paragraphs.push(...toLines(section.text).map(line));
  }

  if (translation) {
    paragraphs.push(heading(`Traduction (${translation.label})`));
    paragraphs.push(...toLines(translation.text).map(line));
  }

  const document = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBlob(document);
}
