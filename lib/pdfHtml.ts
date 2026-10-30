// Page HTML du PDF téléchargé (fabriqué par le serveur avec Chrome, voir app/api/pdf).
// Même contenu que l'écran et le Word : titres, paragraphes, vers en deux colonnes, notes,
// versets du Coran en vert avec leur référence, mots à vérifier en rouge. Aucun élément d'interface.

import {
  isArabic,
  lineStyle,
  quranBrackets,
  splitMarks,
  splitVerse,
  toLines,
} from "@/lib/text";

export type PdfContent = {
  title: string;
  subtitle: string; // nom du fichier d'origine
  notices: { text: string; tone: "amber" | "red" | "green" }[]; // « Texte non relu… », légendes
  sections: { label: string; text: string }[];
  translation: { label: string; text: string } | null;
};

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Texte d'une ligne : mots à vérifier en rouge, versets en vert avec leur référence.
function inline(text: string): string {
  return splitMarks(text)
    .map((segment) => {
      if (segment.kind === "quran") {
        if (!segment.on) return escape(segment.text);
        return `<span class="quran">${escape(quranBrackets(segment.text, segment.reference))}</span> <span class="ref">(${escape(segment.reference)})</span>`;
      }
      if (segment.kind === "doubt") return `<span class="doubt">${escape(segment.text)}</span>`;
      return escape(segment.text);
    })
    .join("");
}

const dir = (text: string) => (isArabic(text) ? "rtl" : "ltr");

function line(full: string): string {
  const { kind, stamp, skip } = lineStyle(full);
  const body = full.slice(skip);
  if (kind === "page") return `<p class="page">${escape(body.trim())}</p>`;
  if (kind === "verse") {
    const { sadr, ajuz } = splitVerse(body);
    return `<div class="verse" dir="rtl"><p>${inline(sadr)}</p><p>${inline(ajuz)}</p></div>`;
  }
  if (kind === "heading") return `<h2 dir="${dir(body)}">${inline(body)}</h2>`;
  if (kind === "note") return `<p class="note" dir="${dir(body)}">${inline(body)}</p>`;
  const label = stamp ? `<span class="stamp" dir="ltr">${escape(stamp)}</span> ` : "";
  return `<p dir="${dir(body)}">${label}${inline(body)}</p>`;
}

// Les vers qui se suivent forment un poème : un seul encadré, colonnes alignées.
function block(text: string): string {
  const html: string[] = [];
  let poem: string[] = [];
  const endPoem = () => {
    if (poem.length) html.push(`<div class="poem">${poem.join("")}</div>`);
    poem = [];
  };
  for (const full of toLines(text)) {
    if (lineStyle(full).kind === "verse") {
      poem.push(line(full));
    } else {
      endPoem();
      html.push(line(full));
    }
  }
  endPoem();
  return html.join("\n");
}

// `fonts` : règles @font-face (police Amiri intégrée au fichier).
export function buildPdfHtml(content: PdfContent, fonts: string): string {
  const sections = content.sections
    .map(
      (section) =>
        (section.label ? `<p class="section">${escape(section.label)}</p>` : "") + block(section.text),
    )
    .join("\n");
  const translation = content.translation
    ? `<h1 class="translation">Traduction (${escape(content.translation.label)})</h1>${block(content.translation.text)}`
    : "";
  return `<!doctype html>
<html lang="ar">
<head>
<meta charset="utf-8">
<title>${escape(content.title)}</title>
<style>
${fonts}
* { box-sizing: border-box; }
body { margin: 0; font-family: "Amiri", serif; font-size: 14pt; color: #1c1917; }
h1 { margin: 0 0 4pt; text-align: center; font-size: 22pt; color: #145433; }
h1.translation { margin-top: 28pt; break-before: page; }
.subtitle { margin: 0 0 10pt; text-align: center; font-size: 10pt; color: #78716c; }
.notice { margin: 0 0 2pt; font-size: 9pt; color: #b45309; }
.notice.red { color: #dc2626; }
.notice.green { color: #145433; }
.notices { margin-bottom: 16pt; padding-bottom: 8pt; border-bottom: 1px solid #e7e5e4; }
p { margin: 0 0 10pt; line-height: 2; text-align: justify; orphans: 2; widows: 2; }
p[dir="ltr"] { font-size: 12pt; line-height: 1.7; }
h2 { margin: 16pt 0 8pt; text-align: center; font-size: 17pt; color: #145433; break-after: avoid; }
.poem { margin: 12pt auto 14pt; max-width: 15cm; padding: 6pt 16pt; background: #faf6ea; border-right: 3pt solid #c9a227; break-inside: avoid; }
/* Sadr à droite, ʿajuz à gauche, chacun centré dans sa colonne, avec un large blanc au milieu. */
.verse { display: grid; grid-template-columns: 1fr 1fr; column-gap: 48pt; font-weight: 700; font-size: 15pt; break-inside: avoid; }
.verse p { margin: 0; line-height: 2.1; text-align: center; }
.note { border-top: 1px solid #d6d3d1; padding-top: 4pt; font-size: 11pt; color: #57534e; }
.page { margin: 10pt 0 6pt; text-align: center; font-size: 8pt; letter-spacing: 2px; color: #a8a29e; }
.section { margin: 12pt 0 6pt; font-size: 9pt; color: #047857; }
.stamp { font-size: 8pt; color: #78716c; }
.quran { color: #145433; }
.ref { font-size: 9pt; color: #7a5f12; }
.doubt { color: #dc2626; }
</style>
</head>
<body>
<h1 dir="${dir(content.title)}">${escape(content.title)}</h1>
<p class="subtitle" dir="auto">${escape(content.subtitle)}</p>
<div class="notices">${content.notices.map((notice) => `<p class="notice ${notice.tone}">${escape(notice.text)}</p>`).join("")}</div>
${sections}
${translation}
</body>
</html>`;
}
