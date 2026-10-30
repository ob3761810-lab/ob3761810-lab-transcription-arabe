// Fabrique le fichier Word (.docx) dans le navigateur, avec le même contenu que le PDF.
// L'arabe est écrit de droite à gauche, le français et l'anglais de gauche à droite.

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { isArabic, lineStyle, quranBrackets, splitMarks, splitVerse, toLines } from "@/lib/text";

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

// Morceaux de texte (TextRun) d'une ligne : texte normal, mots en rouge, versets en vert.
function runsOf(text: string, arabic: boolean, bold = false): TextRun[] {
  const style = arabic
    ? {
        rightToLeft: true,
        size: 32,
        sizeComplexScript: 32,
        language: { bidirectional: "ar-SA" },
        bold,
        boldComplexScript: bold,
      }
    : { size: 24, sizeComplexScript: 28, bold, boldComplexScript: bold };
  return splitMarks(text).flatMap((segment) => {
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
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

// Poème (vers qui se suivent) : un seul tableau sans bordure à deux colonnes, de droite à gauche
// (sadr à droite), en gras, sur fond doré clair, chaque hémistiche centré dans sa cellule.
function poem(bodies: string[]): Table {
  const cell = (text: string) =>
    new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: "FAF6EA" },
      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
      margins: { left: 240, right: 240 },
      children: [
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          spacing: { after: 40, line: 400 },
          children: runsOf(text, true, true),
        }),
      ],
    });
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
    rows: bodies.map((body) => {
      const { sadr, ajuz } = splitVerse(body);
      return new TableRow({ children: [cell(sadr), cell(ajuz)] });
    }),
  });
}

// Lignes d'un texte : les vers qui se suivent sont réunis en un seul poème (tableau).
function lines(text: string): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  let verses: string[] = [];
  const endPoem = () => {
    if (verses.length) {
      result.push(poem(verses), new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
    verses = [];
  };
  for (const full of toLines(text)) {
    const { kind, skip } = lineStyle(full);
    if (kind === "verse") {
      verses.push(full.slice(skip));
    } else {
      endPoem();
      result.push(line(full));
    }
  }
  endPoem();
  return result;
}

// Une ligne du texte : paragraphe, titre (« ## »), vers (« @@ »), note (« ^^ »), repère de page,
// ou paragraphe avec repère de temps (« [4:05] »).
function line(full: string): Paragraph {
  const { kind, stamp, skip } = lineStyle(full);
  const text = full.slice(skip);
  const arabic = isArabic(text);
  if (kind === "page") {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 120 },
      children: [new TextRun({ text: text.trim(), font: FONT, size: 16, color: "A8A29E" })],
    });
  }
  const runs = runsOf(text, arabic);
  if (kind === "heading") {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      bidirectional: arabic,
      alignment: AlignmentType.CENTER,
      spacing: { before: 360, after: 160 },
      children: runs,
    });
  }
  if (kind === "note") {
    return new Paragraph({
      bidirectional: arabic,
      alignment: AlignmentType.START,
      spacing: { before: 120, after: 120 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: "D6D3D1", space: 4 } },
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
  const paragraphs: (Paragraph | Table)[] = [
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
    paragraphs.push(...lines(section.text));
  }

  if (translation) {
    paragraphs.push(heading(`Traduction (${translation.label})`));
    paragraphs.push(...lines(translation.text));
  }

  const document = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBlob(document);
}
