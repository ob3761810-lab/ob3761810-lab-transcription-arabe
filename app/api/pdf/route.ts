// Fabrique le PDF téléchargé : la page est dessinée par un vrai Chrome sur le serveur
// (arabe parfait, de droite à gauche), sans aucun élément d'interface, avec un titre en tête
// et la pagination en bas. Rien n'est conservé.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";
import { buildPdfHtml, type PdfContent } from "@/lib/pdfHtml";

export const maxDuration = 60;

// Police Amiri intégrée au PDF (licence libre OFL, data/fonts/OFL.txt).
let fonts: string | null = null;
function fontFaces(): string {
  if (fonts) return fonts;
  const face = (file: string, weight: number) =>
    `@font-face { font-family: "Amiri"; font-weight: ${weight}; src: url(data:font/ttf;base64,${readFileSync(
      join(process.cwd(), "data", "fonts", file),
    ).toString("base64")}) format("truetype"); }`;
  fonts = face("Amiri-Regular.ttf", 400) + "\n" + face("Amiri-Bold.ttf", 700);
  return fonts;
}

// Chrome est lancé une fois, puis réutilisé tant que le serveur reste éveillé.
// En local, CHROMIUM_PATH peut désigner un Chrome déjà installé.
let browser: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browser) {
    const local = process.env.CHROMIUM_PATH;
    browser = puppeteer
      .launch({
        args: local
          ? ["--no-sandbox"]
          : await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
        executablePath: local ?? (await chromium.executablePath()),
        headless: "shell",
      })
      .catch((error) => {
        browser = null;
        throw error;
      });
  }
  const running = await browser;
  if (!running.connected) {
    browser = null;
    return getBrowser();
  }
  return running;
}

const FOOTER = `<div style="width:100%;text-align:center;font-size:9px;color:#78716c;font-family:sans-serif">
<span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

export async function POST(request: Request) {
  let content: PdfContent;
  try {
    content = (await request.json()) as PdfContent;
    if (!content || typeof content.title !== "string" || !Array.isArray(content.sections)) {
      throw new Error("Contenu invalide");
    }
  } catch {
    return NextResponse.json({ error: "Contenu du PDF invalide." }, { status: 400 });
  }

  try {
    const page = await (await getBrowser()).newPage();
    try {
      await page.setContent(buildPdfHtml(content, fontFaces()), { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: FOOTER,
        margin: { top: "18mm", bottom: "20mm", left: "18mm", right: "18mm" },
      });
      return new Response(Buffer.from(pdf), {
        headers: { "content-type": "application/pdf", "cache-control": "no-store" },
      });
    } finally {
      await page.close();
    }
  } catch (error) {
    console.error("Erreur pendant la création du PDF :", error);
    return NextResponse.json(
      { error: "Le PDF n'a pas pu être créé. Réessayez dans un instant." },
      { status: 500 },
    );
  }
}
