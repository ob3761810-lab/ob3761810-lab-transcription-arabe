// Fabrique le fichier Word (.docx) dans le navigateur, avec le même contenu que le PDF.
// L'arabe est écrit de droite à gauche, le français et l'anglais de gauche à droite.

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { isArabic, lineStyle, quranBrackets, splitMarks, toLines } from "@/lib/text";

export type WordContent = {
  title?: string; // titre du document (sous-titres) ; sinon « Transcription »
  fileName: string;
  sections: { time: string; text: string }[];
  translation: { label: string; text: string } | null;
};

// Calibri pour le français et l'anglais, Arial pour l'arabe (présente partout et lisible avec les harakat).
const FONT = { ascii: "Calibri", hAnsi: "Calibri", cs: "Arial" };

// Les mots dont Google n'était pas sûr, et qui n'ont pas été vérifiés, restent en rouge.
const RED = "DC2626";

// Les passages du Coran remplacés par le texte officiel : en vert foncé, suivis de leur référence.
const QURAN_COLOR = "145433";
const REFERENCE_COLOR = "7A5F12";

// Une ligne du texte : paragraphe, intertitre (« ## ») ou paragraphe avec repère de temps (« [4:05] »).
function line(full: string): Paragraph {
  const { heading: isHeading, stamp, skip } = lineStyle(full);
  const text = full.slice(skip);
  const arabic = isArabic(text);
  const style = arabic
    ? {
        rightToLeft: true,
        size: 32,
        sizeComplexScript: 32,
        language: { bidirectional: "ar-SA" },
      }
    : { size: 24, sizeComplexScript: 28 };
  const runs = splitMarks(text).flatMap((segment) => {
    if (segment.kind === "quran" && segment.on) {
      return [
        new TextRun({ text: quranBrackets(segment.text, segment.reference), font: FONT, color: QURAN_COLOR, ...style }),
        new TextRun({
          text: ` (${segment.reference}) `,
          font: FONT,
          color: REFERENCE_COLOR,
          size: 20,
          sizeComplexScript: 20,
        }),
      ];
    }
    return [
      new TextRun({
        text: segment.text,
        font: FONT,
        color: segment.kind === "doubt" ? RED : undefined,
        ...style,
      }),
    ];
  });
  if (isHeading) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      bidirectional: arabic,
      alignment: AlignmentType.START,
      spacing: { before: 360, after: 160 },
      children: runs,
    });
  }
  // Repère de temps : petit, en gris, au début du paragraphe.
  if (stamp) {
    runs.unshift(
      new TextRun({ text: `[${stamp}]  `, font: FONT, size: 18, sizeComplexScript: 18, color: "71717A" }),
    );
  }
  if (arabic) {
    return new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      spacing: { after: 240, line: 400 },
      children: runs,
    });
  }
  return new Paragraph({ spacing: { after: 240, line: 320 }, children: runs });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    bidirectional: isArabic(text),
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, rightToLeft: isArabic(text) })],
  });
}

function note(text: string, color: string): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, font: FONT, size: 20, color })],
  });
}

export async function buildWordFile({
  title,
  fileName,
  sections,
  translation,
}: WordContent): Promise<Blob> {
  const paragraphs: Paragraph[] = [
    heading(title ?? "Transcription"),
    note(fileName, "71717A"),
    note("Texte non relu : il peut contenir des erreurs de transcription ou de harakat.", "B45309"),
    note("En rouge : mots dont l'orthographe ou les harakat sont à vérifier.", RED),
    note(
      "En vert, entre ﴿ ﴾ : versets du Coran remplacés par le texte officiel de Tanzil (tanzil.net), avec leur référence.",
      QURAN_COLOR,
    ),
  ];

  for (const section of sections) {
    if (section.time) paragraphs.push(note(section.time, "047857"));
    paragraphs.push(...toLines(section.text).map(line));
  }

  if (translation) {
    paragraphs.push(heading(`Traduction (${translation.label})`));
    paragraphs.push(...toLines(translation.text).map(line));
  }

  const document = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBlob(document);
}
