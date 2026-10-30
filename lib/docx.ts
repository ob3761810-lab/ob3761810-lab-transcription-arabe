// Lecture d'un fichier Word (.docx) dans le navigateur, sans IA : le texte exact, paragraphe par
// paragraphe (un .docx est une archive ZIP qui contient le texte dans word/document.xml).

import JSZip from "jszip";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

const decode = (text: string) =>
  text.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity]);

// Morceaux utiles d'un paragraphe : texte, tabulation, retour à la ligne.
const PIECE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g;

// Texte du document Word : une ligne par paragraphe. Les tabulations et retours à la ligne sont
// gardés (ils séparent souvent l'horaire du texte dans des sous-titres copiés).
export function docxXmlToText(xml: string): string {
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/g) ?? [];
  return paragraphs
    .map((paragraph) => {
      let text = "";
      for (const match of paragraph.matchAll(PIECE)) {
        if (match[1] !== undefined) text += decode(match[1]);
        else if (match[0].startsWith("<w:tab")) text += "\t";
        else text += "\n";
      }
      return text;
    })
    .join("\n");
}

// Lit un fichier .docx. L'ancien format .doc (Word avant 2007) n'est pas un fichier ZIP :
// l'erreur est signalée à la page, qui demande d'enregistrer le fichier en .docx.
export async function readDocx(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const document = zip.file("word/document.xml");
  if (!document) throw new Error("Pas un document Word");
  return docxXmlToText(await document.async("string"));
}
